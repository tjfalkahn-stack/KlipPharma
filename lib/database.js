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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free';
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

export async function deleteDatabaseProject(projectId, userId) {
  if (!pool || !projectId || !userId || userId === "local-owner") return;
  await pool.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
}

export async function createUser(email, password) {
  requireDatabase();
  const id = crypto.randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  try {
    const result = await pool.query(
      "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, plan_tier, created_at",
      [id, normalizedEmail, passwordHash],
    );
    return publicUser(result.rows[0]);
  } catch (error) {
    if (error?.code === "23505") throw new AuthError("An account with that email already exists.", 409);
    throw error;
  }
}

export async function authenticateUser(email, password) {
  requireDatabase();
  const normalizedEmail = normalizeEmail(email);
  const result = await pool.query("SELECT id, email, password_hash, plan_tier, created_at FROM users WHERE email = $1", [normalizedEmail]);
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
    `SELECT users.id, users.email, users.plan_tier, users.created_at
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
    createdAt: user.created_at,
  };
}

function normalizePlanTier(value) {
  const plan = String(value || "free").trim().toLowerCase();
  return new Set(["paid", "pro", "creator", "studio", "business"]).has(plan) ? plan : "free";
}
