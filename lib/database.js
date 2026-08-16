import crypto from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(crypto.scrypt);
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const requestedAuthMode = String(process.env.AUTH_MODE || (databaseUrl ? "required" : "off")).toLowerCase();

export const authMode = requestedAuthMode === "required" ? "required" : "off";
export const databaseConfigured = Boolean(databaseUrl);

const pool = databaseConfigured
  ? new pg.Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_SIZE || 10),
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  })
  : null;

attachPostgresPoolErrorHandler(pool);

export function attachPostgresPoolErrorHandler(targetPool) {
  if (!targetPool) return;
  targetPool.on("error", handlePostgresPoolError);
}

function handlePostgresPoolError(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "unknown";
  console.error(`Unexpected PostgreSQL pool error: ${code}`);
}

export async function initializeDatabase() {
  if (authMode === "required" && !pool) {
    throw new Error("AUTH_MODE=required needs DATABASE_URL. Add a PostgreSQL connection string before starting KlipPharma.");
  }
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan_tier TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      stripe_price_id TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      subscription_current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      batch_id UUID,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS projects_user_id_updated_at_idx ON projects(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS billing_agreements (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agreement_type TEXT NOT NULL,
      subscription_id TEXT,
      statement TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS billing_agreements_user_id_idx ON billing_agreements(user_id, accepted_at DESC);
    CREATE TABLE IF NOT EXISTS workspaces (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx ON workspace_members(workspace_id, created_at);
    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id UUID PRIMARY KEY,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
      invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx
      ON workspace_invitations(workspace_id, status, created_at DESC);
    CREATE TABLE IF NOT EXISTS social_connections (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
      provider_user_id TEXT,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      scopes TEXT[] NOT NULL DEFAULT '{}',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_expires_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS social_connections_provider_user_idx
      ON social_connections(provider, provider_user_id);
  `);
  await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
}

export async function loadDatabaseProjects() {
  if (!pool) return [];
  const result = await pool.query("SELECT data FROM projects ORDER BY updated_at DESC LIMIT 1000");
  return result.rows.map((row) => row.data).filter((project) => project?.id && project?.userId);
}

export async function saveDatabaseProject(project) {
  if (!pool || !project?.id || !project?.userId || project.userId === "local-owner") return;
  await pool.query(
    `INSERT INTO projects (id, user_id, batch_id, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       batch_id = EXCLUDED.batch_id,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [project.id, project.userId, project.batchId || project.id, JSON.stringify(project), project.createdAt || new Date().toISOString()],
  );
}

export async function claimDatabaseProjectProcessingLease(projectId, userId, leaseOwner, leaseSeconds = 15 * 60) {
  if (!pool || !projectId || !userId || userId === "local-owner") return true;
  const result = await pool.query(
    `UPDATE projects
     SET processing_lease_owner = $3,
         processing_lease_expires_at = NOW() + ($4::int * INTERVAL '1 second'),
         processing_claimed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND (processing_lease_expires_at IS NULL OR processing_lease_expires_at < NOW() OR processing_lease_owner = $3)
       AND COALESCE(data ->> 'status', '') IN ('queued', 'processing')
     RETURNING id`,
    [projectId, userId, leaseOwner, Math.max(60, Number(leaseSeconds) || 900)],
  );
  return Boolean(result.rowCount);
}

export async function releaseDatabaseProjectProcessingLease(projectId, userId, leaseOwner, finalStatus = null) {
  if (!pool || !projectId || !userId || userId === "local-owner") return;
  await pool.query(
    `UPDATE projects
     SET processing_lease_owner = NULL,
         processing_lease_expires_at = NULL,
         processing_completed_at = CASE WHEN $4::text IN ('ready', 'failed') THEN NOW() ELSE processing_completed_at END,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND processing_lease_owner = $3`,
    [projectId, userId, leaseOwner, finalStatus],
  );
}

export async function listKlipdoseDatabaseProjectDebug() {
  if (!pool) return { configured: false, projects: [] };
  const result = await pool.query(
    `SELECT
       id,
       user_id,
       data ->> 'status' AS status,
       data ->> 'integrationSource' AS integration_source,
       data ->> 'idempotencyKey' AS idempotency_key,
       data ->> 'archivedAt' AS archived_at,
       data ->> 'createdAt' AS created_at,
       updated_at
     FROM projects
     WHERE data ->> 'integrationSource' = 'klipdose'
     ORDER BY updated_at DESC
     LIMIT 50`,
  );
  return { configured: true, projects: result.rows };
}

export async function deleteDatabaseProject(projectId, userId) {
  if (!pool || !projectId || !userId || userId === "local-owner") return;
  await pool.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
}

export async function saveDatabaseUploadSession(session) {
  if (!pool || !session?.id || !session?.userId || session.userId === "local-owner") return;
  await pool.query(
    `INSERT INTO upload_sessions (id, user_id, workspace_id, batch_id, idempotency_key, data, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       data = EXCLUDED.data,
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [
      session.id,
      session.userId,
      session.workspaceId || null,
      session.batchId,
      session.idempotencyKey || null,
      JSON.stringify(session),
      session.status || "preparing",
      session.createdAt || new Date().toISOString(),
    ],
  );
}

export async function loadDatabaseUploadSessions() {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT data FROM upload_sessions
     WHERE status IN ('preparing', 'uploading', 'paused', 'processing', 'failed')
     ORDER BY updated_at DESC LIMIT 200`,
  );
  return result.rows.map((row) => row.data).filter((session) => session?.id && session?.userId);
}

export async function loadDatabaseUploadSession(sessionId) {
  if (!pool || !sessionId) return null;
  const result = await pool.query("SELECT data FROM upload_sessions WHERE id = $1", [sessionId]);
  return result.rows[0]?.data || null;
}

export async function assertUploadSessionSchemaReady() {
  if (!pool) return true;
  try {
    await pool.query("SELECT id, user_id, workspace_id, batch_id, idempotency_key, status, data, expires_at, created_at, updated_at FROM upload_sessions LIMIT 0");
    await pool.query("SELECT processing_lease_owner, processing_lease_expires_at, processing_claimed_at, processing_completed_at FROM projects LIMIT 0");
    return true;
  } catch (error) {
    throw new AuthError("Upload persistence is not migrated. Apply migrations/202608160001_upload_sessions.sql before enabling production uploads.", 503);
  }
}

export async function deleteDatabaseUploadSession(sessionId, userId) {
  if (!pool || !sessionId || !userId || userId === "local-owner") return;
  await pool.query("DELETE FROM upload_sessions WHERE id = $1 AND user_id = $2", [sessionId, userId]);
}

export async function getSocialConnection(userId, provider) {
  if (!pool || !userId || userId === "local-owner") return null;
  const result = await pool.query(
    `SELECT user_id, provider, workspace_id, provider_user_id, profile, scopes,
       access_token, refresh_token, access_token_expires_at, refresh_token_expires_at,
       connected_at, updated_at
     FROM social_connections WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return result.rows[0] ? socialConnection(rowToSocialConnection(result.rows[0])) : null;
}

export async function upsertSocialConnection({
  userId,
  provider,
  workspaceId = null,
  providerUserId = null,
  profile = {},
  scopes = [],
  accessToken,
  refreshToken = null,
  accessTokenExpiresAt = null,
  refreshTokenExpiresAt = null,
}) {
  requireDatabase();
  const safeScopes = [...new Set((Array.isArray(scopes) ? scopes : String(scopes || "").split(","))
    .map((scope) => String(scope || "").trim())
    .filter(Boolean))];
  const result = await pool.query(
    `INSERT INTO social_connections
       (user_id, provider, workspace_id, provider_user_id, profile, scopes, access_token,
        refresh_token, access_token_expires_at, refresh_token_expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       provider_user_id = EXCLUDED.provider_user_id,
       profile = EXCLUDED.profile,
       scopes = EXCLUDED.scopes,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, social_connections.refresh_token),
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       refresh_token_expires_at = COALESCE(EXCLUDED.refresh_token_expires_at, social_connections.refresh_token_expires_at),
       updated_at = NOW()
     RETURNING user_id, provider, workspace_id, provider_user_id, profile, scopes,
       access_token, refresh_token, access_token_expires_at, refresh_token_expires_at,
       connected_at, updated_at`,
    [userId, provider, workspaceId, providerUserId, JSON.stringify(profile || {}), safeScopes, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt],
  );
  return socialConnection(rowToSocialConnection(result.rows[0]));
}

export async function deleteSocialConnection(userId, provider) {
  if (!pool || !userId || userId === "local-owner") return false;
  const result = await pool.query(
    "DELETE FROM social_connections WHERE user_id = $1 AND provider = $2",
    [userId, provider],
  );
  return Boolean(result.rowCount);
}

export async function createUser(email, password) {
  requireDatabase();
  const id = crypto.randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  try {
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, plan_tier, stripe_customer_id, stripe_subscription_id, stripe_price_id,
         subscription_status, subscription_current_period_end, cancel_at_period_end, created_at`,
      [id, normalizedEmail, passwordHash],
    );
    const user = publicUser(result.rows[0]);
    await ensureWorkspaceForUser(user.id, user.email);
    return user;
  } catch (error) {
    if (error?.code === "23505") throw new AuthError("An account with that email already exists.", 409);
    throw error;
  }
}

export async function authenticateUser(email, password) {
  requireDatabase();
  const normalizedEmail = normalizeEmail(email);
  const result = await pool.query(
    `SELECT id, email, password_hash, plan_tier, stripe_customer_id, stripe_subscription_id, stripe_price_id,
       subscription_status, subscription_current_period_end, cancel_at_period_end, created_at
     FROM users WHERE email = $1`,
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AuthError("Email or password is incorrect.", 401);
  }
  return publicUser(user);
}

export async function createSession(userId) {
  requireDatabase();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const days = Math.min(90, Math.max(1, Number(process.env.SESSION_DAYS || 30)));
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash, userId, expiresAt],
  );
  return { token, expiresAt };
}

export async function findSessionUser(token) {
  if (!pool || !token) return null;
  const result = await pool.query(
    `SELECT users.id, users.email, users.plan_tier, users.stripe_customer_id,
       users.stripe_subscription_id, users.stripe_price_id, users.subscription_status,
       users.subscription_current_period_end, users.cancel_at_period_end, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
    [hashToken(token)],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

export async function deleteSession(token) {
  if (!pool || !token) return;
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function findUserById(userId) {
  if (!pool || !userId || userId === "local-owner") return null;
  const result = await pool.query(
    `SELECT id, email, plan_tier, stripe_customer_id, stripe_subscription_id, stripe_price_id,
       subscription_status, subscription_current_period_end, cancel_at_period_end, created_at
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

export async function setStripeCustomerId(userId, customerId) {
  requireDatabase();
  const result = await pool.query(
    `UPDATE users SET stripe_customer_id = $2 WHERE id = $1
     RETURNING id, email, plan_tier, stripe_customer_id, stripe_subscription_id, stripe_price_id,
       subscription_status, subscription_current_period_end, cancel_at_period_end, created_at`,
    [userId, customerId],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

export async function syncStripeSubscription({
  userId = null,
  customerId,
  subscriptionId,
  priceId = null,
  planTier = "free",
  status = "inactive",
  currentPeriodEnd = null,
  cancelAtPeriodEnd = false,
}) {
  requireDatabase();
  const paid = new Set(["active", "trialing"]).has(String(status || "").toLowerCase());
  const values = [
    userId,
    customerId,
    subscriptionId,
    priceId,
    String(status || "inactive").toLowerCase(),
    currentPeriodEnd,
    Boolean(cancelAtPeriodEnd),
    paid ? normalizePlanTier(planTier) : "free",
  ];
  const result = await pool.query(
    `UPDATE users SET
       stripe_customer_id = COALESCE($2, stripe_customer_id),
       stripe_subscription_id = $3,
       stripe_price_id = $4,
       subscription_status = $5,
       subscription_current_period_end = $6,
       cancel_at_period_end = $7,
       plan_tier = $8
     WHERE ($1::uuid IS NOT NULL AND id = $1) OR ($2::text IS NOT NULL AND stripe_customer_id = $2)
     RETURNING id, email, plan_tier, stripe_customer_id, stripe_subscription_id, stripe_price_id,
       subscription_status, subscription_current_period_end, cancel_at_period_end, created_at`,
    values,
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

export async function beginStripeWebhookEvent(eventId, eventType) {
  requireDatabase();
  const result = await pool.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type)
     VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [eventId, eventType],
  );
  return Boolean(result.rowCount);
}

export async function releaseStripeWebhookEvent(eventId) {
  if (!pool || !eventId) return;
  await pool.query("DELETE FROM stripe_webhook_events WHERE event_id = $1", [eventId]);
}

export async function recordBillingAgreement({
  userId,
  agreementType,
  subscriptionId = null,
  statement,
}) {
  requireDatabase();
  await pool.query(
    `INSERT INTO billing_agreements (user_id, agreement_type, subscription_id, statement)
     VALUES ($1, $2, $3, $4)`,
    [userId, agreementType, subscriptionId, statement],
  );
}

export async function getWorkspaceContext(userId) {
  if (!pool || !userId || userId === "local-owner") return null;
  const workspace = await ensureWorkspaceForUser(userId);
  if (!workspace) return null;
  const members = await pool.query(
    `SELECT wm.user_id, wm.role, u.email, u.created_at
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, wm.created_at`,
    [workspace.id],
  );
  const owner = await findUserById(workspace.ownerUserId);
  const current = members.rows.find((member) => member.user_id === userId);
  const businessActive = owner?.planTier === "business"
    && new Set(["active", "trialing"]).has(String(owner.subscriptionStatus || "").toLowerCase());
  return {
    id: workspace.id,
    name: workspace.name,
    ownerUserId: workspace.ownerUserId,
    role: current?.role || "viewer",
    memberIds: members.rows.map((member) => member.user_id),
    memberCount: members.rowCount,
    seatLimit: 5,
    businessActive,
    owner,
    members: members.rows.map((member) => ({
      userId: member.user_id,
      email: member.email,
      role: member.role,
      createdAt: member.created_at,
    })),
  };
}

export async function listWorkspaceInvitations(workspaceId) {
  if (!pool || !workspaceId) return [];
  const result = await pool.query(
    `SELECT id, email, role, status, expires_at, created_at
     FROM workspace_invitations
     WHERE workspace_id = $1 AND status = 'pending' AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
  }));
}

export async function createWorkspaceInvitation({ workspaceId, email, role, invitedBy }) {
  requireDatabase();
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new AuthError("Enter a valid teammate email address.", 400);
  }
  const safeRole = normalizeWorkspaceRole(role);
  const existing = await pool.query(
    `SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1 AND u.email = $2`,
    [workspaceId, normalizedEmail],
  );
  if (existing.rowCount) throw new AuthError("That person is already in this workspace.", 409);
  await pool.query(
    `UPDATE workspace_invitations SET status = 'revoked'
     WHERE workspace_id = $1 AND email = $2 AND status = 'pending'`,
    [workspaceId, normalizedEmail],
  );
  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const result = await pool.query(
    `INSERT INTO workspace_invitations
       (id, workspace_id, email, role, invited_by, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, role, expires_at, created_at`,
    [id, workspaceId, normalizedEmail, safeRole, invitedBy, hashToken(token), expiresAt],
  );
  return {
    id: result.rows[0].id,
    email: result.rows[0].email,
    role: result.rows[0].role,
    expiresAt: result.rows[0].expires_at,
    createdAt: result.rows[0].created_at,
    token,
  };
}

export async function acceptWorkspaceInvitation(userId, token) {
  requireDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT wi.*, u.email AS user_email
       FROM workspace_invitations wi
       JOIN users u ON u.id = $2
       WHERE wi.token_hash = $1 AND wi.status = 'pending' AND wi.expires_at > NOW()
       FOR UPDATE`,
      [hashToken(token), userId],
    );
    const invite = result.rows[0];
    if (!invite) throw new AuthError("This team invitation is invalid or has expired.", 400);
    if (invite.email !== invite.user_email) {
      throw new AuthError("Sign in with the email address that received this invitation.", 403);
    }
    const existing = await client.query("SELECT workspace_id FROM workspace_members WHERE user_id = $1", [userId]);
    if (existing.rowCount && existing.rows[0].workspace_id !== invite.workspace_id) {
      const owned = await client.query(
        `SELECT w.id, u.plan_tier, u.subscription_status,
          (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = w.id) AS member_count
         FROM workspaces w JOIN users u ON u.id = w.owner_user_id WHERE w.owner_user_id = $1`,
        [userId],
      );
      const currentWorkspace = owned.rows[0];
      if (currentWorkspace
        && (currentWorkspace.member_count > 1
          || (currentWorkspace.plan_tier === "business"
            && new Set(["active", "trialing"]).has(currentWorkspace.subscription_status)))) {
        throw new AuthError("Business workspace owners must remove their team or cancel Business before joining another workspace.", 409);
      }
      if (currentWorkspace) {
        await client.query("DELETE FROM workspaces WHERE id = $1", [currentWorkspace.id]);
      } else {
        await client.query("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
      }
    }
    const seatCount = await client.query("SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id = $1", [invite.workspace_id]);
    if (seatCount.rows[0].count >= 5) throw new AuthError("This Business workspace has reached its five-seat limit.", 409);
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invite.workspace_id, userId, invite.role],
    );
    await client.query("UPDATE workspace_invitations SET status = 'accepted' WHERE id = $1", [invite.id]);
    await client.query("COMMIT");
    return { workspaceId: invite.workspace_id, role: invite.role };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateWorkspaceMemberRole(workspaceId, userId, role) {
  requireDatabase();
  const safeRole = normalizeWorkspaceRole(role);
  const result = await pool.query(
    `UPDATE workspace_members SET role = $3
     WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'
     RETURNING user_id, role`,
    [workspaceId, userId, safeRole],
  );
  if (!result.rowCount) throw new AuthError("That team member could not be updated.", 404);
  return { userId: result.rows[0].user_id, role: result.rows[0].role };
}

export async function removeWorkspaceMember(workspaceId, userId) {
  requireDatabase();
  const result = await pool.query(
    "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING user_id",
    [workspaceId, userId],
  );
  if (!result.rowCount) throw new AuthError("That team member could not be removed.", 404);
}

export async function revokeWorkspaceInvitation(workspaceId, invitationId) {
  requireDatabase();
  const result = await pool.query(
    `UPDATE workspace_invitations SET status = 'revoked'
     WHERE workspace_id = $1 AND id = $2 AND status = 'pending' RETURNING id`,
    [workspaceId, invitationId],
  );
  if (!result.rowCount) throw new AuthError("That invitation could not be revoked.", 404);
}

export function validateCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new AuthError("Enter a valid email address.", 400);
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw new AuthError("Use a password with at least 10 characters.", 400);
  }
  return { email: normalizedEmail, password };
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireDatabase() {
  if (!pool) throw new AuthError("Account storage is not configured.", 503);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltText, hashText] = String(encoded).split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(hashText, "base64url");
    const derived = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    }));
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    planTier: normalizePlanTier(user.plan_tier),
    stripeCustomerId: user.stripe_customer_id || null,
    stripeSubscriptionId: user.stripe_subscription_id || null,
    stripePriceId: user.stripe_price_id || null,
    subscriptionStatus: user.subscription_status || "inactive",
    subscriptionCurrentPeriodEnd: user.subscription_current_period_end || null,
    cancelAtPeriodEnd: Boolean(user.cancel_at_period_end),
    createdAt: user.created_at,
  };
}

function rowToSocialConnection(row) {
  return {
    userId: row.user_id,
    provider: row.provider,
    workspaceId: row.workspace_id || null,
    providerUserId: row.provider_user_id || null,
    profile: row.profile || {},
    scopes: row.scopes || [],
    accessToken: row.access_token,
    refreshToken: row.refresh_token || null,
    accessTokenExpiresAt: row.access_token_expires_at || null,
    refreshTokenExpiresAt: row.refresh_token_expires_at || null,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

function socialConnection(connection) {
  return connection;
}

function normalizePlanTier(value) {
  const plan = String(value || "free").trim().toLowerCase();
  return new Set(["paid", "pro", "creator", "studio", "business"]).has(plan) ? plan : "free";
}

async function ensureWorkspaceForUser(userId, email = null) {
  if (!pool || !userId) return null;
  const existing = await pool.query(
    `SELECT w.id, w.name, w.owner_user_id
     FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1`,
    [userId],
  );
  if (existing.rowCount) {
    return {
      id: existing.rows[0].id,
      name: existing.rows[0].name,
      ownerUserId: existing.rows[0].owner_user_id,
    };
  }
  const userEmail = email || (await pool.query("SELECT email FROM users WHERE id = $1", [userId])).rows[0]?.email;
  if (!userEmail) return null;
  const workspaceId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO workspaces (id, name, owner_user_id)
       VALUES ($1, $2, $3) ON CONFLICT (owner_user_id) DO NOTHING`,
      [workspaceId, `${String(userEmail).split("@")[0]}'s workspace`, userId],
    );
    const workspace = await client.query("SELECT id, name, owner_user_id FROM workspaces WHERE owner_user_id = $1", [userId]);
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT (user_id) DO NOTHING`,
      [workspace.rows[0].id, userId],
    );
    await client.query("COMMIT");
    return {
      id: workspace.rows[0].id,
      name: workspace.rows[0].name,
      ownerUserId: workspace.rows[0].owner_user_id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeWorkspaceRole(value) {
  const role = String(value || "editor").trim().toLowerCase();
  return new Set(["admin", "editor", "viewer"]).has(role) ? role : "editor";
}
