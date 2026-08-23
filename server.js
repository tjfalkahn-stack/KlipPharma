import express from "express";
import multer from "multer";
import OpenAI from "openai";
import Stripe from "stripe";
import ffmpegPath from "ffmpeg-static";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AuthError,
  authMode,
  assertUploadSessionSchemaReady,
  authenticateUser,
  beginStripeWebhookEvent,
  claimDatabaseProjectProcessingLease,
  createSession,
  createUser,
  createWorkspaceInvitation,
  databaseConfigured,
  deleteDatabaseProject,
  deleteSocialConnection,
  deleteSession,
  acceptWorkspaceInvitation,
  findUserById,
  findSessionUser,
  getSocialConnection,
  getWorkspaceContext,
  initializeDatabase,
  listWorkspaceInvitations,
  listKlipdoseDatabaseProjectDebug,
  loadDatabaseProjects,
  loadDatabaseUploadSession,
  loadDatabaseUploadSessions,
  recordBillingAgreement,
  removeWorkspaceMember,
  releaseDatabaseProjectProcessingLease,
  releaseStripeWebhookEvent,
  revokeWorkspaceInvitation,
  saveDatabaseProject,
  saveDatabaseUploadSession,
  setStripeCustomerId,
  upsertSocialConnection,
  syncStripeSubscription,
  updateWorkspaceMemberRole,
  validateCredentials,
} from "./lib/database.js";
import { isArchivedKlipdoseProject, isKlipdoseProject, klipdoseIncomingStats, klipdoseProjectForClient, visibleKlipdoseProjects } from "./lib/incoming-klipdose.js";
import { applyAuthorizedSourceAttachment, authorizedSourceAttachmentPatch } from "./lib/klipdose-attachment.js";
import { klipdoseOwnerConfigForRequest } from "./lib/klipdose-owner-config.js";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartPartUpload,
  createMultipartUpload,
  deleteObject,
  downloadObject,
  isObjectStorageAuthorizationError,
  objectStorageConfigured,
  verifyObject,
} from "./lib/object-storage.js";
import {
  attachMultipartUpload,
  createUploadSession,
  findUploadFile,
  markUploadFileCompleted,
  recordUploadPart,
  refreshSessionStatus,
  setUploadFileStatus,
  uploadSessionForClient,
  canAccessUploadSession as canAccessUploadSessionRecord,
} from "./lib/upload-sessions.js";
import {
  applyKlipdoseHandoffState,
  klipdoseApiKeyFromEnv,
  klipdoseCallbackPayload,
  klipdoseCallbackSecret,
  parseKlipdoseHandoffPayload,
  recordKlipdoseCallbackAttempt,
  shouldRetryKlipdoseCallback,
  signKlipdoseCallbackBody,
  validateKlipdoseApiToken,
} from "./lib/klipdose-handoff.js";
import { normalizeYouTubeSource, sanitizeYouTubeTitle } from "./lib/youtube.js";
import {
  assertSafePublicUrl,
  classifyKickImportError,
  detectSourcePlatform,
  extractM3u8Url,
  isRetryableSourceStatus,
  platformBadgeForSource,
} from "./lib/source-platform.js";
import {
  YOUTUBE_AUTH_REQUIRED_MESSAGE,
  createYouTubeCookiesOption,
  isYouTubeAuthRequiredError,
  youtubeImportFailurePatch,
} from "./lib/youtube-cookies.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = process.env.STORAGE_ROOT ? path.resolve(process.env.STORAGE_ROOT) : path.join(__dirname, "storage");
const uploadDir = path.join(storageRoot, "uploads");
const exportDir = path.join(storageRoot, "exports");
const projectsDir = path.join(storageRoot, "projects");
const uploadSessionsDir = path.join(storageRoot, "upload-sessions");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });
fs.mkdirSync(projectsDir, { recursive: true });
fs.mkdirSync(uploadSessionsDir, { recursive: true });

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const stripeCreatorMonthlyPriceId = String(
  process.env.STRIPE_CREATOR_MONTHLY_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID || "",
).trim();
const stripeCreatorYearlyPriceId = String(process.env.STRIPE_CREATOR_YEARLY_PRICE_ID || "").trim();
const stripeProMonthlyPriceId = String(process.env.STRIPE_PRO_MONTHLY_PRICE_ID || "").trim();
const stripeProYearlyPriceId = String(process.env.STRIPE_PRO_YEARLY_PRICE_ID || "").trim();
const stripeBusinessMonthlyPriceId = String(process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID || "").trim();
const stripeBusinessYearlyPriceId = String(process.env.STRIPE_BUSINESS_YEARLY_PRICE_ID || "").trim();
const stripeProUpgradeCouponId = String(process.env.STRIPE_PRO_UPGRADE_COUPON_ID || "").trim();
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const billingConfigured = Boolean(stripe && stripeWebhookSecret && stripeCreatorMonthlyPriceId);
const appBaseUrl = String(process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3100}`)
  .trim().replace(/\/+$/, "");
const jobs = new Map();
const uploadSessions = new Map();
const previewTasks = new Map();
const batchMontageTasks = new Map();
const processingQueue = [];
const authAttempts = new Map();
const oauthStates = new Map();
const localSocialConnections = new Map();
const integrationAttempts = new Map();
const maxConcurrentProjects = 2;
const processingLeaseOwner = `${os.hostname()}-${process.pid}-${crypto.randomUUID()}`;
const uploadLimits = {
  maxFiles: Number(process.env.UPLOAD_MAX_FILES || 10),
  maxFileBytes: Number(process.env.UPLOAD_MAX_FILE_BYTES || 1024 * 1024 * 1024),
  maxBatchBytes: Number(process.env.UPLOAD_MAX_BATCH_BYTES || 2 * 1024 * 1024 * 1024),
  partSize: Number(process.env.UPLOAD_PART_SIZE_BYTES || 8 * 1024 * 1024),
  mimePrefixes: String(process.env.UPLOAD_ALLOWED_MIME_PREFIXES || "video/,audio/")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
};
const uploadSessionTtlMs = Math.max(24 * 60 * 60 * 1000, Number(process.env.UPLOAD_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000));
const defaultTikTokScopes = "user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish";
const defaultYouTubeScopes = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload";
const productionAppOrigin = "https://app.klippharma.com";
const proFeaturesOpen = !new Set(["false", "0", "off", "no"])
  .has(String(process.env.PRO_FEATURES_OPEN ?? "true").trim().toLowerCase());
const creatorModes = {
  auto: {
    label: "Smart Detect",
    prompt: "Choose the strongest self-contained moments for the stated audience and platform. Favor a clear hook, enough context, a satisfying payoff, and clean sentence boundaries. Aim for a useful mix of insights, emotion, tension, and entertainment.",
  },
  artist: {
    label: "Artist / Music",
    prompt: "Edit like a music-content specialist. Do not penalize repeated lyrics. Prioritize quotable lyrical phrases, memorable chorus or verse sections visible in the transcript, clean vocal entrances, complete musical thoughts, crowd or host reactions, and spoken artist-story moments. Never cut in the middle of a lyric or phrase. Prefer 12-45 second discovery clips, but allow up to 90 seconds when the complete performance moment needs it. Vary strategies across lyric moment, performance moment, artist story, and reaction when the source supports them.",
  },
  podcast: {
    label: "Podcast / Interview",
    prompt: "Edit like a top podcast producer. Preserve the question when the answer cannot stand alone, keep speaker turns intelligible, and prioritize strong opinions, useful insights, tension, humor, emotional reveals, and clean punchlines. Avoid clips that begin with an unexplained pronoun or response. Prefer 25-90 second clips with a complete setup and payoff. Vary strategies across insight, debate, story, objection, and reaction when supported.",
  },
  monologue: {
    label: "Monologue / Talking Head",
    prompt: "Edit like a short-form talking-head specialist. Remove greetings and slow preamble from the selection, lead with the sharpest claim or promise, and keep one clear idea per clip. Prioritize cold opens, teachable points, contrarian takes, emotional admissions, and direct calls to action. Prefer 15-60 second clips with a fast hook and a complete final sentence. Vary strategies across lesson, hot take, story, and CTA when supported.",
  },
};
const supportedLanguages = {
  auto: { label: "Auto detect", code: null },
  en: { label: "English", code: "en" },
  es: { label: "Spanish", code: "es" },
  fr: { label: "French", code: "fr" },
  pt: { label: "Portuguese", code: "pt" },
  de: { label: "German", code: "de" },
  it: { label: "Italian", code: "it" },
  ja: { label: "Japanese", code: "ja" },
  ko: { label: "Korean", code: "ko" },
  zh: { label: "Chinese", code: "zh" },
  ar: { label: "Arabic", code: "ar" },
  hi: { label: "Hindi", code: "hi" },
};
const supportedDubVoices = new Set(["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]);
let activeProjects = 0;

const klipdoseProjectSchema = z.object({
  klipdoseCreatorId: z.string().min(1),
  platform: z.string().min(1),
  sourceContentId: z.string().min(1),
  sourceUrl: z.string().url(),
  creatorName: z.string().min(1),
  title: z.string().min(1),
  thumbnailUrl: z.string().url().nullable().optional(),
  opportunityScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  evidence: z.record(z.unknown()).default({}),
  recommendedAction: z.string().min(1),
  requestedStartTimestamp: z.number().nullable().optional(),
  requestedEndTimestamp: z.number().nullable().optional(),
  captionDraft: z.string().nullable().optional(),
  hashtags: z.array(z.string()).nullable().optional(),
  language: z.string().default("en"),
  callbackUrl: z.string().url().nullable().optional(),
  idempotencyKey: z.string().min(8),
});

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const supportedExtension = new Set([".mov", ".mp4", ".m4v", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mpeg", ".mpg"])
      .has(path.extname(file.originalname).toLowerCase());
    cb(null, file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/") || supportedExtension);
  },
});

const overlayImageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `overlay-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const supportedExtension = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])
      .has(path.extname(file.originalname).toLowerCase());
    cb(null, file.mimetype.startsWith("image/") && supportedExtension);
  },
});

app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !stripeWebhookSecret) return res.status(503).send("Stripe billing is not configured.");
  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (error) {
    console.warn("Rejected Stripe webhook:", error.message);
    return res.status(400).send("Invalid webhook signature.");
  }

  let claimed = false;
  try {
    claimed = await beginStripeWebhookEvent(event.id, event.type);
    if (!claimed) return res.json({ received: true, duplicate: true });
    await handleStripeEvent(event);
    return res.json({ received: true });
  } catch (error) {
    if (claimed) await releaseStripeWebhookEvent(event.id).catch(() => {});
    console.error("Stripe webhook error:", error);
    return res.status(500).send("Webhook processing failed.");
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function timingSafeSecretEqual(provided, expected) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(String(expected));
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireKlipdoseIntegration(req, res, next) {
  const configured = klipdoseApiKeyFromEnv(process.env);
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : String(req.headers["x-api-key"] || "");
  if (!configured) {
    return res.status(503).json({
      error: "KlipPharma handoff API is not configured.",
      code: "KLIPPHARMA_API_KEY_REQUIRED",
    });
  }
  if (!validateKlipdoseApiToken(token, process.env)) return res.status(401).json({ error: "Unauthorized.", code: "UNAUTHORIZED" });
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = integrationAttempts.get(ip) ?? { count: 0, resetAt: now + 60_000 };
  if (bucket.resetAt < now) Object.assign(bucket, { count: 0, resetAt: now + 60_000 });
  bucket.count += 1;
  integrationAttempts.set(ip, bucket);
  if (bucket.count > 30) return res.status(429).json({ error: "Too many integration requests." });
  return next();
}

function existingKlipdoseProject(idempotencyKey) {
  return [...jobs.values()].find((job) => job.integrationSource === "klipdose" && job.idempotencyKey === idempotencyKey);
}


function parseKlipdoseProjectPayload(body = {}) {
  return parseKlipdoseHandoffPayload(body);
}

async function createKlipdoseProject(input) {
  const ownerId = process.env.KLIPDOSE_PROJECT_OWNER_ID || (authMode === "off" ? "local-owner" : "");
  if (!ownerId) throw new Error("KLIPDOSE_PROJECT_OWNER_ID is required before production Klipdose handoffs can create visible projects.");
  const source = detectSourcePlatform(input.sourceUrl);
  const youtubeSource = source.sourceType === "youtube" ? normalizeYouTubeSource(source.canonicalUrl) : null;
  const id = crypto.randomUUID();
  const job = {
    id,
    userId: ownerId,
    workspaceId: null,
    batchId: id,
    batchPosition: 1,
    batchSize: 1,
    status: "new",
    progress: 0,
    phase: "new",
    stage: `Received from Klipdose · ${platformBadgeForSource(source.sourcePlatform)} source`,
    originalName: sanitizeYouTubeTitle(input.title),
    creatorName: input.creatorName,
    thumbnailUrl: input.thumbnailUrl || null,
    filePath: null,
    creatorIdentity: input.creatorIdentity || {},
    platformIdentity: input.platformIdentity || {},
    sourceMetadata: input.sourceMetadata || {},
    viralScore: input.viralScore,
    objectKey: null,
    mimeType: "video/mp4",
    sourceProvider: source.sourcePlatform,
    sourcePlatform: source.sourcePlatform,
    sourceType: source.sourceType,
    sourceVideoId: youtubeSource?.videoId || source.kickVideoId || null,
    sourceUrl: source.canonicalUrl,
    sourceReady: false,
    integrationSource: "klipdose",
    klipdoseCreatorId: input.klipdoseCreatorId,
    sourceContentId: input.sourceContentId,
    idempotencyKey: input.idempotencyKey,
    callbackUrl: input.callbackUrl,
    requestedStartTimestamp: input.requestedStartTimestamp ?? null,
    requestedEndTimestamp: input.requestedEndTimestamp ?? null,
    captionDraft: input.captionDraft ?? null,
    proposedCaptions: input.proposedCaptions || [],
    hashtags: input.hashtags || [],
    language: input.language,
    opportunityScore: input.opportunityScore,
    confidence: input.confidence,
    klipdoseRecommendation: input.recommendation || input.recommendedAction,
    recommendedAction: input.recommendedAction,
    klipdoseProposedClips: input.clips || [],
    evidence: input.evidence,
    klipdoseReceivedAt: new Date().toISOString(),
    processingMode: "ai",
    sourceLanguage: normalizeSourceLanguage(input.language),
    translationLanguage: normalizeTranslationLanguage("original"),
    audioTranslation: "none",
    dubVoice: normalizeDubVoice("alloy"),
    contentType: normalizeCreatorMode("auto"),
    clipLength: normalizeClipLength("smart"),
    createMontage: false,
    watermarkText: "",
    watermarkPosition: "bottom-right",
    planTier: "business",
    requestedOutputCount: 3,
    customOutputCountEnabled: true,
    klipPharmaWatermarkRequired: false,
    audience: "Klipdose creator opportunity",
    goal: input.recommendation || input.recommendedAction,
    platform: "TikTok / Reels / Shorts",
    createdAt: new Date().toISOString(),
  };
  applyKlipdoseHandoffState(job, "received", { idempotencyKey: input.idempotencyKey });
  jobs.set(id, job);
  await persistJob(job, { requireDatabase: authMode === "required" });
  return job;
}

app.post("/api/integrations/klipdose/projects", requireKlipdoseIntegration, async (req, res) => {
  const parsed = parseKlipdoseProjectPayload(req.body);
  if (!parsed.ok) return res.status(400).json({ error: "Invalid Klipdose project payload.", code: "INVALID_KLIPDOSE_HANDOFF", issues: parsed.issues });
  try {
    const duplicate = existingKlipdoseProject(parsed.project.idempotencyKey);
    const project = duplicate ?? await createKlipdoseProject(parsed.project);
    if (duplicate) await persistJob(project, { requireDatabase: authMode === "required" });
    if (!duplicate) enqueueKlipdoseCallback(project, "received");
    console.log("Klipdose handoff accepted", {
      projectId: project.id,
      duplicate: Boolean(duplicate),
      sourceContentId: parsed.project.sourceContentId,
      ownerId: project.userId,
      databasePersistenceRequired: authMode === "required",
    });
    return res.status(duplicate ? 200 : 202).json({
      success: true,
      projectId: project.id,
      status: duplicate ? "DUPLICATE" : "ACCEPTED",
      idempotencyKey: parsed.project.idempotencyKey,
    });
  } catch (error) {
    console.error("Klipdose handoff rejected before persistence:", { message: error.message });
    return res.status(500).json({ error: error.message || "Klipdose project could not be created.", code: "KLIPDOSE_PERSISTENCE_FAILED" });
  }
});

app.use(attachUser);
app.use("/exports", requireUser, authorizeExport, express.static(exportDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "KlipPharma", aiConfigured: Boolean(process.env.OPENAI_API_KEY), ffmpeg: true, authMode, uploadMode: objectStorageConfigured ? "direct" : "local", proFeaturesOpen, billingConfigured });
});

app.get("/api/auth/session", (req, res) => {
  res.json({ required: authMode === "required", authenticated: Boolean(req.user), user: userForClient(req.user) });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  if (authMode !== "required") return res.status(409).json({ error: "Accounts are disabled in local mode." });
  try {
    const credentials = validateCredentials(req.body.email, req.body.password);
    const user = await createUser(credentials.email, credentials.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session);
    res.status(201).json({ user: userForClient(user) });
  } catch (error) {
    authFailure(res, error);
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  if (authMode !== "required") return res.status(409).json({ error: "Accounts are disabled in local mode." });
  try {
    const credentials = validateCredentials(req.body.email, req.body.password);
    const user = await authenticateUser(credentials.email, credentials.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session);
    res.json({ user: userForClient(user) });
  } catch (error) {
    authFailure(res, error);
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = readCookie(req, "klippharma_session");
  await deleteSession(token);
  res.clearCookie("klippharma_session", sessionCookieOptions());
  res.json({ ok: true });
});

app.get("/api/billing/status", requireUser, async (req, res) => {
  const user = await billingAccountForRequest(req);
  res.json({
    configured: billingConfigured,
    catalog: billingCatalogForClient(),
    subscription: subscriptionForClient(user),
    canManageBilling: req.user.id === "local-owner" || req.team?.role === "owner",
  });
});

app.post("/api/billing/checkout", requireUser, async (req, res) => {
  try {
    requireStripeBilling();
    if (req.user.id === "local-owner") return res.status(409).json({ error: "Stripe Checkout is available on the live account-based app." });
    if (req.team?.role !== "owner") return res.status(403).json({ error: "Only the Business workspace owner can manage centralized billing." });
    const selectedPlan = billingPlanByKey(req.body?.planKey || "creator_monthly");
    if (!selectedPlan?.priceId) return res.status(409).json({ error: "That subscription option has not been configured in Stripe yet." });
    if (req.body?.recurringAuthorizationAccepted !== true && req.body?.monthlyAuthorizationAccepted !== true) {
      return res.status(400).json({ error: "Accept the recurring-charge authorization before continuing." });
    }
    let user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "Account not found." });
    if (new Set(["active", "trialing"]).has(user.subscriptionStatus)) {
      return res.status(409).json({ error: "This account already has an active subscription. Use the upgrade option or billing portal." });
    }
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { klippharmaUserId: user.id },
      });
      user = await setStripeCustomerId(user.id, customer.id);
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId,
      client_reference_id: user.id,
      line_items: [{ price: selectedPlan.priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${appBaseUrl}/?billing=success`,
      cancel_url: `${appBaseUrl}/?billing=cancelled`,
      subscription_data: { metadata: { klippharmaUserId: user.id, klippharmaPlanKey: selectedPlan.key } },
      metadata: { klippharmaUserId: user.id, klippharmaPlanKey: selectedPlan.key },
    });
    await recordBillingAgreement({
      userId: user.id,
      agreementType: `${selectedPlan.interval}_subscription_authorization`,
      statement: `I authorize KlipPharma to charge ${selectedPlan.priceLabel} automatically every ${selectedPlan.interval} until I cancel.`,
    });
    res.json({ url: session.url });
  } catch (error) {
    billingFailure(res, error);
  }
});

app.post("/api/billing/upgrade", requireUser, async (req, res) => {
  try {
    requireStripeBilling();
    if (req.team?.role !== "owner") return res.status(403).json({ error: "Only the workspace owner can change the subscription." });
    const selectedPlan = billingPlanByKey(req.body?.planKey || "pro_monthly");
    if (!selectedPlan || !new Set(["pro", "business"]).has(selectedPlan.tier) || !selectedPlan.priceId) {
      return res.status(409).json({ error: "That upgrade option has not been configured in Stripe yet." });
    }
    if (req.body?.recurringAuthorizationAccepted !== true) {
      return res.status(400).json({ error: "Accept the recurring-charge authorization before upgrading." });
    }
    const user = await findUserById(req.user.id);
    const currentPlan = billingPlanByPriceId(user?.stripePriceId);
    if (!user?.stripeSubscriptionId || !new Set(["active", "trialing"]).has(user.subscriptionStatus)) {
      return res.status(409).json({ error: "Start a subscription before using the upgrade flow." });
    }
    const ranks = { creator: 1, pro: 2, business: 3 };
    if (!currentPlan || ranks[selectedPlan.tier] <= ranks[currentPlan.tier]) {
      return res.status(409).json({ error: "Choose a higher subscription tier to upgrade." });
    }
    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const item = subscription.items?.data?.[0];
    if (!item) return res.status(409).json({ error: "Stripe could not find the current subscription item." });
    const itemUpdate = { id: item.id, price: selectedPlan.priceId };
    const creatorToProMonthly = currentPlan.tier === "creator"
      && selectedPlan.tier === "pro"
      && selectedPlan.interval === "month";
    if (creatorToProMonthly) {
      if (!stripeProUpgradeCouponId) {
        return res.status(409).json({
          error: "The 15% first-month Pro upgrade offer has not been configured in Stripe yet.",
        });
      }
      itemUpdate.discounts = [{ coupon: stripeProUpgradeCouponId }];
    }
    const updatedSubscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [itemUpdate],
      proration_behavior: "none",
      cancel_at_period_end: false,
      metadata: { ...subscription.metadata, klippharmaUserId: user.id, klippharmaPlanKey: selectedPlan.key },
    });
    await recordBillingAgreement({
      userId: user.id,
      agreementType: `${currentPlan.tier}_to_${selectedPlan.tier}_upgrade`,
      subscriptionId: user.stripeSubscriptionId,
      statement: creatorToProMonthly
        ? `I authorize an upgrade to ${selectedPlan.priceLabel}. The configured 15% one-time coupon applies to the first Pro monthly renewal.`
        : `I authorize an upgrade to the recurring ${selectedPlan.priceLabel} ${selectedPlan.name} plan.`,
    });
    const updated = await syncSubscriptionRecord(updatedSubscription, user.id);
    res.json({ subscription: subscriptionForClient(updated) });
  } catch (error) {
    billingFailure(res, error);
  }
});

app.post("/api/billing/portal", requireUser, async (req, res) => {
  try {
    requireStripeBilling();
    if (req.team?.role !== "owner") return res.status(403).json({ error: "Only the Business workspace owner can open centralized billing." });
    const user = await billingAccountForRequest(req);
    if (!user?.stripeCustomerId) return res.status(409).json({ error: "Start a subscription before opening billing management." });
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appBaseUrl}/`,
    });
    res.json({ url: session.url });
  } catch (error) {
    billingFailure(res, error);
  }
});

app.post("/api/billing/cancel", requireUser, async (req, res) => {
  try {
    requireStripeBilling();
    if (req.team?.role !== "owner") return res.status(403).json({ error: "Only the Business workspace owner can cancel centralized billing." });
    if (req.body?.agreementAccepted !== true) {
      return res.status(400).json({ error: "Confirm the cancellation agreement before continuing." });
    }
    const user = await findUserById(req.user.id);
    if (!user?.stripeSubscriptionId) return res.status(409).json({ error: "No active subscription was found." });
    const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await recordBillingAgreement({
      userId: user.id,
      agreementType: "cancel_recurring_renewal",
      subscriptionId: user.stripeSubscriptionId,
      statement: "I understand my plan remains active through the current paid period, then access ends and future recurring charges stop.",
    });
    const updated = await syncSubscriptionRecord(subscription, user.id);
    res.json({ subscription: subscriptionForClient(updated) });
  } catch (error) {
    billingFailure(res, error);
  }
});

app.post("/api/billing/resume", requireUser, async (req, res) => {
  try {
    requireStripeBilling();
    if (req.team?.role !== "owner") return res.status(403).json({ error: "Only the Business workspace owner can resume centralized billing." });
    const user = await findUserById(req.user.id);
    if (!user?.stripeSubscriptionId || !user.cancelAtPeriodEnd) {
      return res.status(409).json({ error: "No scheduled cancellation was found." });
    }
    const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    const updated = await syncSubscriptionRecord(subscription, user.id);
    res.json({ subscription: subscriptionForClient(updated) });
  } catch (error) {
    billingFailure(res, error);
  }
});


function klipdoseConnectionForClient() {
  const configured = Boolean(String(process.env.KLIPDOSE_SHARED_API_KEY || "").trim());
  const url = String(process.env.KLIPDOSE_APP_URL || process.env.KLIPDOSE_URL || "").trim();
  return {
    configured,
    openUrl: configured && /^https?:\/\//i.test(url) ? url : null,
    ownerConfigured: Boolean(process.env.KLIPDOSE_PROJECT_OWNER_ID || authMode === "off"),
  };
}

app.get("/api/account/dashboard", requireUser, async (req, res) => {
  const billingUser = await billingAccountForRequest(req);
  const profileUser = req.user.id === "local-owner" ? req.user : await findUserById(req.user.id);
  if (req.team?.businessActive) profileUser.planTier = "business";
  const projects = [...jobs.values()]
    .filter((job) => canAccessJob(req, job))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50)
    .map((job) => ({
      id: job.id,
      batchId: job.batchId || job.id,
      originalName: job.originalName,
      status: job.status,
      clipCount: job.clips?.length || 0,
      createdAt: job.createdAt,
    }));
  const incomingKlipdose = visibleKlipdoseProjects([...jobs.values()], (job) => canAccessJob(req, job))
    .map(klipdoseProjectForClient);
  console.log("Klipdose incoming dashboard query", {
    userId: req.user.id,
    configuredOwnerId: process.env.KLIPDOSE_PROJECT_OWNER_ID || null,
    returned: incomingKlipdose.length,
    totalKlipdoseProjects: [...jobs.values()].filter(isKlipdoseProject).length,
  });
  res.json({
    user: userForClient(profileUser),
    subscription: subscriptionForClient(billingUser),
    workspace: req.team ? workspaceForClient(req.team) : null,
    stats: {
      uploads: projects.length,
      clips: projects.reduce((sum, project) => sum + Number(project.clipCount || 0), 0),
      completed: projects.filter((project) => project.status === "ready").length,
      klipdose: klipdoseIncomingStats([...jobs.values()].filter((job) => canAccessJob(req, job))),
    },
    projects,
    incomingKlipdose,
  });
});

app.get("/api/account/klipdose-owner-id", requireUser, (req, res) => {
  res.json({
    ...klipdoseOwnerConfigForRequest(req),
    envName: "KLIPDOSE_PROJECT_OWNER_ID",
  });
});

app.get("/api/incoming/klipdose", requireUser, (req, res) => {
  const includeArchived = req.query.archived === "true";
  const projects = visibleKlipdoseProjects([...jobs.values()], (job) => canAccessJob(req, job), { includeArchived })
    .map(klipdoseProjectForClient);
  console.log("Klipdose incoming API query", {
    userId: req.user.id,
    includeArchived,
    returned: projects.length,
    totalKlipdoseProjects: [...jobs.values()].filter(isKlipdoseProject).length,
  });
  res.json({ projects, stats: klipdoseIncomingStats([...jobs.values()].filter((job) => canAccessJob(req, job))), connection: klipdoseConnectionForClient() });
});

app.get("/api/debug/klipdose-incoming", requireUser, async (req, res) => {
  const configuredOwnerId = process.env.KLIPDOSE_PROJECT_OWNER_ID || null;
  const mayInspectAll = req.user.id === configuredOwnerId || req.user.id === "local-owner";
  const klipdoseJobs = [...jobs.values()].filter(isKlipdoseProject);
  const visibleActive = visibleKlipdoseProjects(klipdoseJobs, (job) => canAccessJob(req, job));
  const database = await listKlipdoseDatabaseProjectDebug().catch((error) => ({ configured: true, error: error.message, projects: [] }));
  const inspectableJobs = mayInspectAll ? klipdoseJobs : klipdoseJobs.filter((job) => canAccessJob(req, job));
  res.json({
    requestUserId: req.user.id,
    configuredOwnerId,
    team: req.team ? { id: req.team.id, ownerUserId: req.team.ownerUserId, businessActive: req.team.businessActive, memberIds: req.team.memberIds } : null,
    counts: {
      totalKlipdoseJobs: klipdoseJobs.length,
      visibleActive: visibleActive.length,
      archived: klipdoseJobs.filter(isArchivedKlipdoseProject).length,
      databaseKlipdoseProjects: database.projects.length,
    },
    database,
    incomingQueryResult: visibleActive.map(klipdoseProjectForClient),
    inspectedJobs: inspectableJobs.map((job) => ({
      id: job.id,
      userId: mayInspectAll ? job.userId : undefined,
      status: job.status,
      integrationSource: job.integrationSource,
      sourceBadge: klipdoseProjectForClient(job).sourceBadge,
      archived: isArchivedKlipdoseProject(job),
      canAccess: canAccessJob(req, job),
      idempotencyKey: job.idempotencyKey,
      createdAt: job.createdAt,
    })),
  });
});

app.post("/api/incoming/klipdose/:id/start", requireUser, requireWorkspaceEditor, (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job || !isKlipdoseProject(job)) return res.status(404).json({ error: "Incoming Klipdose project not found." });
  if (isArchivedKlipdoseProject(job)) return res.status(409).json({ error: "Restore this incoming project before processing it." });
  if (job.status === "ready") return res.json({ project: klipdoseProjectForClient(job), alreadyReady: true });
  if (job.status === "processing" || job.status === "queued" || job.status === "importing") return res.json({ project: klipdoseProjectForClient(job), alreadyProcessing: true });
  if (!job.sourceUrl) return res.status(400).json({ error: "This Klipdose project is missing its source URL." });
  if (!isRetryableSourceStatus(job.status) && job.status === "link_only") {
    return res.status(409).json({ error: "This source is link-only. Upload an authorized MP4 or MOV to process it." });
  }
  Object.assign(job, {
    status: "importing",
    progress: 3,
    phase: "import",
    stage: "Starting Klipdose source import",
    error: null,
    archivedAt: null,
    dismissedAt: null,
  });
  applyKlipdoseHandoffState(job, "importing", { action: "accepted" });
  persistJob(job);
  enqueueKlipdoseCallback(job, "importing");
  importProjectSource(job)
    .catch((error) => {
      console.error("Klipdose incoming import failed:", safeSourceImportLog(job, error));
      removeYouTubeWorkingFiles(job.id);
      applySourceImportFailure(job, error, "Klipdose source import failed");
      applyKlipdoseHandoffState(job, "failed", { error: job.error, code: error?.code || null });
      persistJob(job);
      enqueueKlipdoseCallback(job, "failed", { error: job.error });
    });
  res.status(202).json({ project: klipdoseProjectForClient(job) });
});

app.post("/api/incoming/klipdose/:id/source", requireUser, requireWorkspaceEditor, upload.single("source"), async (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job || !isKlipdoseProject(job)) {
    removeLocalFile(req.file?.path, uploadDir);
    return res.status(404).json({ error: "Incoming Klipdose project not found." });
  }
  if (!req.file) return res.status(400).json({ error: "Upload an authorized MP4 or MOV source." });
  const extension = path.extname(req.file.originalname).toLowerCase();
  if (!new Set([".mp4", ".mov", ".m4v"]).has(extension)) {
    removeLocalFile(req.file.path, uploadDir);
    return res.status(400).json({ error: "Authorized source must be an MP4, MOV, or M4V file." });
  }
  const destination = path.join(uploadDir, `${job.id}${extension}`);
  removeLocalFile(destination, uploadDir);
  fs.renameSync(req.file.path, destination);
  applyAuthorizedSourceAttachment(job, authorizedSourceAttachmentPatch({ filePath: destination, mimeType: mimeTypeFor(destination) }));
  try {
    await validateKlipdoseImportedMedia(job, destination);
  } catch (error) {
    removeLocalFile(destination, uploadDir);
    removeYouTubeWorkingFiles(job.id);
    applyKlipdoseMediaValidationFailure(job, error);
    persistJob(job);
    enqueueKlipdoseCallback(job, "failed", { error: job.error });
    return res.status(422).json({ error: error.message || "Authorized source could not be validated.", code: error.code || "MEDIA_VALIDATION_FAILED" });
  }
  applyKlipdoseHandoffState(job, "importing", { action: "authorized_source_uploaded" });
  persistJob(job);
  enqueueProject(job);
  enqueueKlipdoseCallback(job, "importing");
  res.status(202).json({ project: klipdoseProjectForClient(job) });
});

app.patch("/api/incoming/klipdose/:id", requireUser, requireWorkspaceEditor, (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job || !isKlipdoseProject(job)) return res.status(404).json({ error: "Incoming Klipdose project not found." });
  const action = String(req.body?.action || "").toLowerCase();
  if (action === "archive" || action === "dismiss") {
    job.archivedAt = new Date().toISOString();
    job.dismissedAt = job.archivedAt;
  } else if (action === "reject") {
    const reason = String(req.body?.reason || "Rejected in KlipPharma").trim().slice(0, 240);
    Object.assign(job, {
      status: "rejected",
      progress: Math.min(100, Math.max(0, Number(job.progress || 0))),
      phase: "rejected",
      stage: "Rejected in KlipPharma",
      error: reason,
      archivedAt: new Date().toISOString(),
      dismissedAt: new Date().toISOString(),
    });
    applyKlipdoseHandoffState(job, "rejected", { reason });
    enqueueKlipdoseCallback(job, "rejected", { error: reason });
  } else if (action === "restore") {
    delete job.archivedAt;
    delete job.dismissedAt;
    if (job.status === "rejected") {
      job.status = "new";
      job.phase = "new";
      job.stage = "Restored for review";
      delete job.error;
    }
  } else {
    return res.status(400).json({ error: "Choose archive, dismiss, reject, or restore." });
  }
  persistJob(job);
  res.json({ project: klipdoseProjectForClient(job) });
});

app.get("/api/team", requireUser, async (req, res) => {
  if (!req.team?.businessActive) return res.status(403).json({ error: "A Business subscription is required for team workspaces." });
  const invitations = await listWorkspaceInvitations(req.team.id);
  res.json({ workspace: workspaceForClient(req.team), invitations });
});

app.post("/api/team/invitations", requireUser, async (req, res) => {
  try {
    requireTeamAdmin(req);
    const invitations = await listWorkspaceInvitations(req.team.id);
    if (req.team.memberCount + invitations.length >= req.team.seatLimit) {
      return res.status(409).json({ error: "All five Business seats are assigned or reserved by pending invitations." });
    }
    const invite = await createWorkspaceInvitation({
      workspaceId: req.team.id,
      email: req.body?.email,
      role: req.body?.role,
      invitedBy: req.user.id,
    });
    res.status(201).json({
      invitation: { ...invite, inviteUrl: `${appBaseUrl}/?invite=${encodeURIComponent(invite.token)}` },
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not create that invitation." });
  }
});

app.post("/api/team/invitations/accept", requireUser, async (req, res) => {
  try {
    await acceptWorkspaceInvitation(req.user.id, String(req.body?.token || ""));
    req.team = await getWorkspaceContext(req.user.id);
    res.json({ workspace: workspaceForClient(req.team) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not accept that invitation." });
  }
});

app.delete("/api/team/invitations/:id", requireUser, async (req, res) => {
  try {
    requireTeamAdmin(req);
    await revokeWorkspaceInvitation(req.team.id, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not revoke that invitation." });
  }
});

app.patch("/api/team/members/:userId", requireUser, async (req, res) => {
  try {
    requireTeamAdmin(req);
    const member = await updateWorkspaceMemberRole(req.team.id, req.params.userId, req.body?.role);
    res.json({ member });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not update that member." });
  }
});

app.delete("/api/team/members/:userId", requireUser, async (req, res) => {
  try {
    requireTeamAdmin(req);
    await removeWorkspaceMember(req.team.id, req.params.userId);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not remove that member." });
  }
});

app.get("/api/integrations/status", requireUser, async (req, res) => {
  const tiktok = await getTikTokConnectionForRequest(req);
  const youtube = await getYouTubeConnectionForRequest(req);
  res.json({
    tiktok: tiktokConnectionForClient(tiktok),
    youtube: youtubeConnectionForClient(youtube),
  });
});

app.get("/api/integrations/youtube/oauth/start", requireUser, (req, res) => {
  try {
    const config = requireYouTubeConfig(req);
    const returnOrigin = integrationReturnOrigin(req);
    const state = crypto.randomBytes(32).toString("base64url");
    oauthStates.set(state, {
      provider: "youtube",
      userId: req.user.id,
      workspaceId: req.team?.id || null,
      returnTo: safeReturnTo(req.query.returnTo),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    res.cookie("klippharma_youtube_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: returnOrigin.startsWith("https://"),
      maxAge: 10 * 60 * 1000,
      path: "/",
    });
    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", normalizeYouTubeScopes(process.env.YOUTUBE_SCOPES || defaultYouTubeScopes).join(" "));
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("include_granted_scopes", "true");
    authorizeUrl.searchParams.set("prompt", "consent");
    authorizeUrl.searchParams.set("state", state);
    res.redirect(authorizeUrl.toString());
  } catch (error) {
    res.status(error.status || 503).send(error.message || "YouTube OAuth is not configured.");
  }
});

app.get("/api/integrations/youtube/oauth/callback", requireUser, async (req, res) => {
  const state = String(req.query.state || "");
  const cookieState = readCookie(req, "klippharma_youtube_oauth_state");
  const stored = oauthStates.get(state);
  oauthStates.delete(state);
  res.clearCookie("klippharma_youtube_oauth_state", { path: "/" });
  const redirectBase = stored?.returnTo || "/?settings=integrations";
  try {
    if (!state || !cookieState || state !== cookieState || !stored || stored.provider !== "youtube" || stored.expiresAt < Date.now() || stored.userId !== req.user.id) {
      throw new AuthError("YouTube authorization expired. Start the connection again.", 400);
    }
    if (req.query.error) throw new AuthError(String(req.query.error_description || req.query.error), 400);
    const code = String(req.query.code || "");
    if (!code) throw new AuthError("Google did not return an authorization code.", 400);
    const token = await exchangeYouTubeCode(code, req);
    const scopes = normalizeYouTubeScopes(token.scope || process.env.YOUTUBE_SCOPES || defaultYouTubeScopes);
    const channel = await fetchYouTubeChannel(token.access_token);
    await saveYouTubeConnectionForRequest(req, {
      providerUserId: channel.id || null,
      profile: channel,
      scopes,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      accessTokenExpiresAt: secondsFromNow(token.expires_in),
      refreshTokenExpiresAt: null,
    });
    const done = new URL(redirectBase, integrationReturnOrigin(req));
    done.searchParams.set("youtube", "connected");
    res.redirect(done.toString());
  } catch (error) {
    const failed = new URL(redirectBase, integrationReturnOrigin(req));
    failed.searchParams.set("youtube", "error");
    failed.searchParams.set("message", error.message || "YouTube authorization failed.");
    res.redirect(failed.toString());
  }
});

app.delete("/api/integrations/youtube", requireUser, async (req, res) => {
  const connection = await getYouTubeConnectionForRequest(req);
  if (connection?.accessToken) await revokeGoogleToken(connection.accessToken).catch(() => {});
  await deleteYouTubeConnectionForRequest(req);
  res.json({ ok: true });
});

app.post("/api/integrations/youtube/refresh", requireUser, async (req, res) => {
  try {
    const connection = await requireYouTubeConnection(req, "https://www.googleapis.com/auth/youtube.readonly");
    const refreshed = await ensureYouTubeAccessToken(req, connection);
    const profile = await fetchYouTubeChannel(refreshed.accessToken);
    const saved = await saveYouTubeConnectionForRequest(req, {
      providerUserId: profile.id || refreshed.providerUserId || null,
      profile,
      scopes: normalizeYouTubeScopes(refreshed.scopes),
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || null,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: null,
    });
    res.json({ youtube: youtubeConnectionForClient(saved) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not refresh YouTube channel." });
  }
});

app.get("/api/integrations/youtube/videos", requireUser, async (req, res) => {
  try {
    const connection = await requireYouTubeConnection(req, "https://www.googleapis.com/auth/youtube.readonly");
    const refreshed = await ensureYouTubeAccessToken(req, connection);
    res.json(await fetchRecentYouTubeVideos(refreshed.accessToken, refreshed.profile?.uploadsPlaylistId));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not load recent YouTube videos." });
  }
});

app.post("/api/integrations/youtube/publish", requireUser, requireWorkspaceEditor, async (req, res) => {
  try {
    const connection = await requireYouTubeConnection(req, "https://www.googleapis.com/auth/youtube.upload");
    const refreshed = await ensureYouTubeAccessToken(req, connection);
    const target = resolveTikTokPublishTarget(req);
    const publish = await submitYouTubeVideo({
      accessToken: refreshed.accessToken,
      target,
      metadata: req.body || {},
    });
    res.status(202).json(publish);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "YouTube upload could not start." });
  }
});

app.post("/api/integrations/youtube/publish/status", requireUser, async (req, res) => {
  try {
    const connection = await requireYouTubeConnection(req, "https://www.googleapis.com/auth/youtube.readonly");
    const refreshed = await ensureYouTubeAccessToken(req, connection);
    const videoId = String(req.body?.videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) return res.status(400).json({ error: "YouTube video id is required." });
    res.json(await fetchYouTubeVideoStatus(refreshed.accessToken, videoId));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not check YouTube status." });
  }
});

app.get("/api/integrations/tiktok/oauth/start", requireUser, (req, res) => {
  try {
    const config = requireTikTokConfig(req);
    const returnOrigin = tiktokReturnOrigin(req);
    const state = crypto.randomBytes(32).toString("base64url");
    const returnTo = safeReturnTo(req.query.returnTo);
    oauthStates.set(state, {
      userId: req.user.id,
      workspaceId: req.team?.id || null,
      returnTo,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    res.cookie("klippharma_tiktok_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: returnOrigin.startsWith("https://"),
      maxAge: 10 * 60 * 1000,
      path: "/",
    });
    const scope = normalizeTikTokScopes(process.env.TIKTOK_SCOPES || defaultTikTokScopes);
    const authorizeUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authorizeUrl.searchParams.set("client_key", config.clientKey);
    authorizeUrl.searchParams.set("scope", scope.join(","));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("state", state);
    res.redirect(authorizeUrl.toString());
  } catch (error) {
    res.status(error.status || 503).send(error.message || "TikTok Login Kit is not configured.");
  }
});

app.get("/api/integrations/tiktok/oauth/callback", requireUser, async (req, res) => {
  const state = String(req.query.state || "");
  const cookieState = readCookie(req, "klippharma_tiktok_oauth_state");
  const stored = oauthStates.get(state);
  oauthStates.delete(state);
  res.clearCookie("klippharma_tiktok_oauth_state", { path: "/" });
  const redirectBase = stored?.returnTo || "/?settings=integrations";
  try {
    if (!state || !cookieState || state !== cookieState || !stored || stored.expiresAt < Date.now() || stored.userId !== req.user.id) {
      throw new AuthError("TikTok authorization expired. Start the connection again.", 400);
    }
    if (req.query.error) throw new AuthError(String(req.query.error_description || req.query.error), 400);
    const code = String(req.query.code || "");
    if (!code) throw new AuthError("TikTok did not return an authorization code.", 400);
    const token = await exchangeTikTokCode(code, req);
    const scopes = normalizeTikTokScopes(token.scope || "");
    const profile = await fetchTikTokUserProfile(token.access_token, scopes).catch((error) => ({
      error: error.message || "Profile could not be loaded yet.",
    }));
    await saveTikTokConnectionForRequest(req, {
      providerUserId: profile.open_id || token.open_id || null,
      profile,
      scopes,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      accessTokenExpiresAt: secondsFromNow(token.expires_in),
      refreshTokenExpiresAt: secondsFromNow(token.refresh_expires_in),
    });
    const done = new URL(redirectBase, tiktokReturnOrigin(req));
    done.searchParams.set("tiktok", "connected");
    res.redirect(done.toString());
  } catch (error) {
    const failed = new URL(redirectBase, tiktokReturnOrigin(req));
    failed.searchParams.set("tiktok", "error");
    failed.searchParams.set("message", error.message || "TikTok authorization failed.");
    res.redirect(failed.toString());
  }
});

app.delete("/api/integrations/tiktok", requireUser, async (req, res) => {
  const connection = await getTikTokConnectionForRequest(req);
  if (connection?.accessToken) await revokeTikTokToken(connection.accessToken).catch(() => {});
  await deleteTikTokConnectionForRequest(req);
  res.json({ ok: true });
});

app.post("/api/integrations/tiktok/refresh", requireUser, async (req, res) => {
  try {
    const connection = await requireTikTokConnection(req, "user.info.basic");
    const scopes = normalizeTikTokScopes(connection.scopes);
    const profile = await fetchTikTokUserProfile(connection.accessToken, scopes);
    const saved = await saveTikTokConnectionForRequest(req, {
      providerUserId: profile.open_id || connection.providerUserId || null,
      profile,
      scopes,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken || null,
      accessTokenExpiresAt: connection.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: connection.refreshTokenExpiresAt || null,
    });
    res.json({ tiktok: tiktokConnectionForClient(saved) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not refresh TikTok profile." });
  }
});

app.get("/api/integrations/tiktok/videos", requireUser, async (req, res) => {
  try {
    const connection = await requireTikTokConnection(req, "video.list");
    res.json(await fetchTikTokVideos(connection.accessToken));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not load recent TikTok videos." });
  }
});

app.get("/api/integrations/tiktok/creator-info", requireUser, async (req, res) => {
  try {
    const connection = await requireTikTokConnection(req, "video.publish");
    const creator = await tiktokApi("/v2/post/publish/creator_info/query/", {
      method: "POST",
      token: connection.accessToken,
    });
    res.json({ creator: creator.data || null });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not load TikTok creator settings." });
  }
});

app.post("/api/integrations/tiktok/publish", requireUser, requireWorkspaceEditor, async (req, res) => {
  try {
    const target = resolveTikTokPublishTarget(req);
    const mode = normalizeTikTokPostMode(req.body?.mode);
    const requiredScope = mode === "direct" ? "video.publish" : "video.upload";
    const connection = await requireTikTokConnection(req, requiredScope);
    const publish = await submitTikTokVideo({
      accessToken: connection.accessToken,
      target,
      mode,
      postInfo: req.body || {},
    });
    res.status(202).json(publish);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "TikTok upload could not start." });
  }
});

app.post("/api/integrations/tiktok/publish/status", requireUser, async (req, res) => {
  try {
    const connection = await requireTikTokConnection(req);
    const publishId = String(req.body?.publishId || "").trim();
    if (!publishId || publishId.length > 128) return res.status(400).json({ error: "TikTok publish id is required." });
    const status = await tiktokApi("/v2/post/publish/status/fetch/", {
      method: "POST",
      token: connection.accessToken,
      body: { publish_id: publishId },
    });
    res.json({ publishId, status: status.data || null });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Could not check TikTok status." });
  }
});

app.use("/api/uploads", requireUser);
app.use("/api/projects", requireUser);
app.use("/api/batches", requireUser);
app.use("/api/youtube", requireUser);
app.use(["/api/uploads", "/api/projects", "/api/batches", "/api/youtube"], requireWorkspaceEditor);

app.post("/api/uploads/presign", async (req, res) => {
  res.status(410).json({ error: "Direct whole-file upload URLs are disabled. Use resumable upload sessions." });
});

app.get("/api/uploads/sessions", (req, res) => {
  const sessions = [...uploadSessions.values()]
    .filter((session) => canAccessUploadSession(req, session))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 20)
    .map(uploadSessionForClient);
  res.json({ sessions });
});

app.post("/api/uploads/sessions", async (req, res) => {
  if (!objectStorageConfigured) return res.status(409).json({ error: "Resumable cloud uploads are not enabled on this installation." });
  try {
    await ensureProductionUploadPersistence();
    const session = createUploadSession({
      userId: req.user.id,
      workspaceId: req.team?.id || null,
      files: req.body.files,
      settings: req.body.settings || {},
      fileOptions: req.body.fileOptions || [],
      partSize: uploadLimits.partSize,
      limits: uploadLimits,
    });
    for (const file of session.files) {
      attachMultipartUpload(file, await createMultipartUpload(req.user.id, file, { batchId: session.batchId, fileId: file.id }));
    }
    refreshSessionStatus(session);
    uploadSessions.set(session.id, session);
    await persistUploadSession(session, { requireDatabase: true });
    res.status(201).json({ session: uploadSessionForClient(session) });
  } catch (error) {
    if (isObjectStorageAuthorizationError(error)) {
      console.error("Cloud upload authorization failed. Replace the configured R2 access token.");
      return res.status(503).json({
        error: "Cloud uploads are temporarily unavailable.",
        code: "CLOUD_UPLOAD_UNAVAILABLE",
      });
    }
    res.status(400).json({ error: error.message || "Could not create an upload session." });
  }
});

app.get("/api/uploads/sessions/:sessionId", async (req, res) => {
  const session = await ownedUploadSession(req, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Upload session not found." });
  res.json({ session: uploadSessionForClient(session) });
});

app.post("/api/uploads/sessions/:sessionId/files/:fileId/parts/:partNumber", async (req, res) => {
  const session = await ownedUploadSession(req, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Upload session not found." });
  try {
    const file = findUploadFile(session, req.params.fileId);
    if (file.status === "cancelled") return res.status(409).json({ error: "This upload was cancelled." });
    if (file.status === "paused") return res.status(409).json({ error: "This upload is paused." });
    const partNumber = Number(req.params.partNumber);
    const upload = await createMultipartPartUpload(req.user.id, {
      objectKey: file.objectKey,
      uploadId: file.uploadId,
      partNumber,
    });
    setUploadFileStatus(session, file.id, "uploading");
    await persistUploadSession(session, { requireDatabase: true });
    res.json({ ...upload, partNumber });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not prepare that upload part." });
  }
});

app.patch("/api/uploads/sessions/:sessionId/files/:fileId/parts/:partNumber", async (req, res) => {
  const session = await ownedUploadSession(req, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Upload session not found." });
  try {
    const file = recordUploadPart(session, req.params.fileId, {
      partNumber: req.params.partNumber,
      etag: req.body.etag,
      size: req.body.size,
    });
    await persistUploadSession(session, { requireDatabase: true });
    res.json({ file: uploadSessionForClient({ ...session, files: [file] }).files[0], session: uploadSessionForClient(session) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not record that uploaded part." });
  }
});

app.post("/api/uploads/sessions/:sessionId/files/:fileId/complete", async (req, res) => {
  const session = await ownedUploadSession(req, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Upload session not found." });
  try {
    const file = findUploadFile(session, req.params.fileId);
    if (file.projectId && jobs.has(file.projectId)) {
      return res.status(202).json({ id: file.projectId, batchId: session.batchId, session: uploadSessionForClient(session), alreadyQueued: true });
    }
    if (!file.completedParts?.length || file.completedParts.length !== file.totalParts) {
      return res.status(409).json({ error: "Finish uploading every file part before processing starts." });
    }
    if (file.status === "finalizing") return res.status(409).json({ error: "This upload is already being finalized." });
    setUploadFileStatus(session, file.id, "finalizing", { error: null });
    await persistUploadSession(session, { requireDatabase: true });
    await completeMultipartUpload(req.user.id, {
      objectKey: file.objectKey,
      uploadId: file.uploadId,
      parts: file.completedParts,
    });
    const stored = await verifyObject(req.user.id, file.objectKey);
    if (!stored.size || stored.size > uploadLimits.maxFileBytes) throw new Error("The uploaded source could not be verified.");
    if (!isSupportedStoredMedia(file, stored)) throw new Error("The uploaded source type is not supported.");
    const result = createProjectFromUploadSessionFile(req, session, file, stored);
    markUploadFileCompleted(session, file.id, { projectId: result.id });
    await persistUploadSession(session, { requireDatabase: true });
    res.status(202).json({ ...result, session: uploadSessionForClient(session) });
  } catch (error) {
    try {
      setUploadFileStatus(session, req.params.fileId, "failed", { error: error.message || "Upload finalization failed." });
      await persistUploadSession(session, { requireDatabase: true });
    } catch {}
    res.status(400).json({ error: error.message || "Could not finalize that upload." });
  }
});

app.post("/api/uploads/sessions/:sessionId/files/:fileId/:action", async (req, res) => {
  const session = await ownedUploadSession(req, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Upload session not found." });
  const action = String(req.params.action || "");
  try {
    const file = findUploadFile(session, req.params.fileId);
    if (action === "pause") setUploadFileStatus(session, file.id, "paused");
    else if (action === "resume" || action === "retry") setUploadFileStatus(session, file.id, file.uploadedBytes ? "uploading" : "ready_to_upload", { error: null });
    else if (action === "cancel") {
      await abortMultipartUpload(req.user.id, { objectKey: file.objectKey, uploadId: file.uploadId });
      setUploadFileStatus(session, file.id, "cancelled");
    } else {
      return res.status(404).json({ error: "Upload action not found." });
    }
    await persistUploadSession(session, { requireDatabase: true });
    res.json({ session: uploadSessionForClient(session) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not update that upload." });
  }
});

app.get("/api/projects", (req, res) => {
  const projects = [...jobs.values()]
    .filter((job) => canAccessJob(req, job))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50)
    .map((job) => ({
      id: job.id,
      batchId: job.batchId || job.id,
      batchPosition: job.batchPosition || 1,
      batchSize: job.batchSize || 1,
      originalName: job.originalName,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      clipCount: job.clips?.length || 0,
      createdAt: job.createdAt,
      error: job.error,
    }));
  res.json({ projects });
});

app.delete("/api/batches/:batchId", async (req, res) => {
  const group = [...jobs.values()].filter((job) => (
    canAccessJob(req, job) && String(job.batchId || job.id) === String(req.params.batchId)
  ));
  if (!group.length) return res.status(404).json({ error: "Batch not found." });
  if (group.some(jobIsBusy)) return res.status(409).json({ error: "Wait for processing or rendering to finish before deleting this batch." });
  try {
    await Promise.all(group.map((job) => deleteJobPermanently(job)));
    res.json({ ok: true, deleted: group.length });
  } catch (error) {
    console.error("Batch deletion failed:", error);
    res.status(500).json({ error: "KlipPharma could not completely delete that batch. Try again." });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job) return res.status(404).json({ error: "Project not found." });
  if (jobIsBusy(job)) return res.status(409).json({ error: "Wait for processing or rendering to finish before deleting this video." });
  const batchId = job.batchId || job.id;
  const survivors = [...jobs.values()].filter((item) => (
    canAccessJob(req, item) && item.id !== job.id && String(item.batchId || item.id) === String(batchId)
  ));
  try {
    await deleteJobPermanently(job);
    if (survivors.length) {
      removeBatchMontageFiles(batchId);
      survivors.forEach((item, index) => {
        if (item.montage) {
          removeStoredMontageAudio(item);
          delete item.montage;
        }
        item.batchPosition = index + 1;
        item.batchSize = survivors.length;
        persistJob(item);
      });
    }
    res.json({ ok: true, remaining: survivors.map((item) => item.id) });
  } catch (error) {
    console.error("Project deletion failed:", error);
    res.status(500).json({ error: "KlipPharma could not completely delete that video. Try again." });
  }
});

app.post("/api/projects", upload.any(), (req, res) => {
  const files = Array.isArray(req.files) ? req.files.slice(0, 10) : [];
  if (!files.length) return res.status(400).json({ error: "Choose at least one video or audio file." });
  let fileOptions = [];
  try {
    fileOptions = JSON.parse(req.body.fileOptions || "[]");
  } catch {
    fileOptions = [];
  }

  const result = createProjectBatch(req, files, fileOptions);
  res.status(202).json(result);
});

app.post("/api/youtube/import", (req, res) => {
  if (req.body.ownershipConfirmed !== true) {
    return res.status(400).json({ error: "Confirm that you own this video or have permission to download and edit it." });
  }

  let source;
  try {
    source = normalizeYouTubeSource(req.body.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const activeImport = [...jobs.values()].some((job) => (
    canAccessJob(req, job) && job.sourceProvider === "youtube" && (job.status === "queued" || job.status === "processing")
  ));
  if (activeImport) return res.status(409).json({ error: "Finish the current YouTube import before starting another one." });

  const id = crypto.randomUUID();
  const job = {
    id,
    userId: req.user.id,
    workspaceId: req.team?.id || null,
    batchId: id,
    batchPosition: 1,
    batchSize: 1,
    status: "processing",
    progress: 3,
    phase: "import",
    stage: "Connecting to your YouTube source",
    originalName: "YouTube video · preparing",
    filePath: null,
    objectKey: null,
    mimeType: "video/mp4",
    sourceProvider: "youtube",
    sourceVideoId: source.videoId,
    sourceReady: false,
    ownershipConfirmedAt: new Date().toISOString(),
    processingMode: req.body.transcribe === false ? "manual" : "ai",
    sourceLanguage: normalizeSourceLanguage(req.body.sourceLanguage),
    translationLanguage: normalizeTranslationLanguage(req.body.translationLanguage),
    audioTranslation: normalizeAudioTranslation(req.body.audioTranslation, req.body.translationLanguage),
    dubVoice: normalizeDubVoice(req.body.dubVoice),
    contentType: normalizeCreatorMode(req.body.contentType),
    clipLength: normalizeClipLength(req.body.clipLength),
    createMontage: false,
    watermarkText: normalizeWatermarkText(req.body.watermarkText),
    watermarkPosition: normalizeOverlayPosition(req.body.watermarkPosition),
    planTier: normalizePlanTier(req.user.planTier),
    requestedOutputCount: normalizeRequestedOutputCount(req.body.outputCount, req.user.planTier),
    customOutputCountEnabled: hasProBatchOutput(req.user.planTier),
    klipPharmaWatermarkRequired: !hasPaidPlan(req.user.planTier),
    audience: req.body.audience || "General audience",
    goal: req.body.goal || "High-retention social clips",
    platform: req.body.platform || "Instagram Reels",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  persistJob(job);

  importYouTubeSource(job, source.canonicalUrl)
    .catch((error) => {
      console.error("YouTube import failed:", safeYouTubeImportLog(job, error));
      removeYouTubeWorkingFiles(job.id);
      applyYouTubeImportFailure(job, error, "YouTube import failed");
      persistJob(job);
    });

  return res.status(202).json({ id, batchId: id, ids: [id], sourceProvider: "youtube" });
});

app.post("/api/projects/cloud", async (req, res) => {
  res.status(410).json({ error: "Legacy cloud project handoff is disabled. Use resumable upload sessions." });
});

function createProjectFromUploadSessionFile(req, session, file, stored) {
  if (file.projectId && jobs.has(file.projectId)) {
    return { id: file.projectId, batchId: session.batchId, ids: [file.projectId], alreadyQueued: true };
  }
  const id = crypto.randomUUID();
  const body = session.settings || {};
  const job = {
    id,
    userId: req.user.id,
    workspaceId: req.team?.id || session.workspaceId || null,
    batchId: session.batchId,
    batchPosition: Number(file.index || 0) + 1,
    batchSize: session.files.length,
    uploadSessionId: session.id,
    uploadFileId: file.id,
    status: "queued",
    progress: 2,
    phase: "queued",
    stage: "Queued for processing — safe to leave",
    originalName: file.name,
    filePath: path.join(uploadDir, path.basename(file.objectKey)),
    objectKey: file.objectKey,
    mimeType: stored.type || file.type,
    processingMode: file.transcribe === false ? "manual" : "ai",
    sourceLanguage: normalizeSourceLanguage(body.sourceLanguage),
    translationLanguage: normalizeTranslationLanguage(body.translationLanguage),
    audioTranslation: normalizeAudioTranslation(body.audioTranslation, body.translationLanguage),
    dubVoice: normalizeDubVoice(body.dubVoice),
    contentType: normalizeCreatorMode(body.contentType),
    clipLength: normalizeClipLength(body.clipLength),
    createMontage: body.createMontage === true || body.createMontage === "true",
    montageLength: normalizeMontageLength(body.montageLength),
    montageStyle: normalizeMontageStyle(body.montageStyle),
    watermarkText: normalizeWatermarkText(body.watermarkText),
    watermarkPosition: normalizeOverlayPosition(body.watermarkPosition),
    planTier: normalizePlanTier(req.user.planTier),
    requestedOutputCount: normalizeRequestedOutputCount(body.outputCount, req.user.planTier),
    customOutputCountEnabled: hasProBatchOutput(req.user.planTier),
    klipPharmaWatermarkRequired: !hasPaidPlan(req.user.planTier),
    audience: body.audience || "General audience",
    goal: body.goal || "High-retention social clips",
    platform: body.platform || "Instagram Reels",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  persistJob(job);
  const existingMontageOwner = [...jobs.values()].find((item) => item.batchId === session.batchId && item.montage);
  if (!existingMontageOwner && job.createMontage) {
    job.montage = {
      status: "waiting",
      targetDuration: job.montageLength,
      style: job.montageStyle,
      sourceCount: session.files.length,
      captionsEnabled: session.files.some((item) => item.transcribe !== false),
      captionStyle: "bold",
      captionPosition: "bottom",
      sourceVolume: 100,
      addedAudioVolume: 35,
      audioStart: 0,
      audioLoop: true,
      audioFadeIn: 1,
      audioFadeOut: 1,
      autoDuck: true,
      revision: 1,
      translationLanguage: job.translationLanguage,
      audioTranslation: job.audioTranslation,
      dubVoice: job.dubVoice,
    };
    persistJob(job);
  }
  enqueueProject(job);
  return { id, batchId: session.batchId, ids: [id], projects: [{ id, originalName: job.originalName, processingMode: job.processingMode }] };
}

function createProjectBatch(req, files, fileOptions = []) {

  const batchId = crypto.randomUUID();
  const created = files.map((file, index) => {
    const id = crypto.randomUUID();
    const job = {
      id,
      userId: req.user.id,
      workspaceId: req.team?.id || null,
      batchId,
      batchPosition: index + 1,
      batchSize: files.length,
      status: "queued",
      progress: 2,
      phase: "queued",
      stage: "Waiting for the processor",
      originalName: file.originalname,
      filePath: file.path,
      objectKey: file.objectKey || null,
      mimeType: file.mimetype,
      processingMode: fileOptions[index]?.transcribe === false ? "manual" : "ai",
      sourceLanguage: normalizeSourceLanguage(req.body.sourceLanguage),
      translationLanguage: normalizeTranslationLanguage(req.body.translationLanguage),
      audioTranslation: normalizeAudioTranslation(req.body.audioTranslation, req.body.translationLanguage),
      dubVoice: normalizeDubVoice(req.body.dubVoice),
      contentType: normalizeCreatorMode(req.body.contentType),
      clipLength: normalizeClipLength(req.body.clipLength),
      createMontage: req.body.createMontage === true || req.body.createMontage === "true",
      montageLength: normalizeMontageLength(req.body.montageLength),
      montageStyle: normalizeMontageStyle(req.body.montageStyle),
      watermarkText: normalizeWatermarkText(req.body.watermarkText),
      watermarkPosition: normalizeOverlayPosition(req.body.watermarkPosition),
      planTier: normalizePlanTier(req.user.planTier),
      requestedOutputCount: normalizeRequestedOutputCount(req.body.outputCount, req.user.planTier),
      customOutputCountEnabled: hasProBatchOutput(req.user.planTier),
      klipPharmaWatermarkRequired: !hasPaidPlan(req.user.planTier),
      audience: req.body.audience || "General audience",
      goal: req.body.goal || "High-retention social clips",
      platform: req.body.platform || "Instagram Reels",
      createdAt: new Date().toISOString(),
    };
    jobs.set(id, job);
    persistJob(job);
    return { id, originalName: job.originalName, processingMode: job.processingMode };
  });

  if (created.length && jobs.get(created[0].id)?.createMontage) {
    const owner = jobs.get(created[0].id);
    owner.montage = {
      status: "waiting",
      targetDuration: owner.montageLength,
      style: owner.montageStyle,
      sourceCount: files.length,
      captionsEnabled: created.some((item) => item.processingMode === "ai"),
      captionStyle: "bold",
      captionPosition: "bottom",
      sourceVolume: 100,
      addedAudioVolume: 35,
      audioStart: 0,
      audioLoop: true,
      audioFadeIn: 1,
      audioFadeOut: 1,
      autoDuck: true,
      revision: 1,
      translationLanguage: owner.translationLanguage,
      audioTranslation: owner.audioTranslation,
      dubVoice: owner.dubVoice,
    };
    persistJob(owner);
  }
  created.forEach((item) => enqueueProject(jobs.get(item.id)));

  return { batchId, ids: created.map((item) => item.id), projects: created, id: created[0].id };
}

function enqueueProject(job) {
  processingQueue.push(job);
  runNextProjects();
}

function runNextProjects() {
  while (activeProjects < maxConcurrentProjects && processingQueue.length) {
    const job = processingQueue.shift();
    activeProjects += 1;
    processClaimedProject(job)
      .catch((error) => {
        console.error(error);
        Object.assign(job, {
          status: "failed",
          progress: Math.min(95, Math.max(2, Number(job.progress || 2))),
          phase: "failed",
          stage: "Processing failed",
          error: friendlyError(error),
          failedAt: new Date().toISOString(),
        });
        if (isKlipdoseProject(job)) {
          applyKlipdoseHandoffState(job, "failed", { error: job.error });
          enqueueKlipdoseCallback(job, "failed", { error: job.error });
        }
        persistJob(job);
      })
      .finally(() => {
        activeProjects -= 1;
        finalizeBatchOutputCount(job.batchId);
        maybeStartBatchMontage(job.batchId);
        runNextProjects();
      });
  }
}

async function processClaimedProject(job) {
  const claimed = await claimDatabaseProjectProcessingLease(job.id, job.userId, processingLeaseOwner);
  if (!claimed) {
    job.stage = "Processing claimed by another worker";
    return;
  }
  try {
    await processProject(job);
  } finally {
    await releaseDatabaseProjectProcessingLease(job.id, job.userId, processingLeaseOwner, job.status);
  }
}

app.get("/api/projects/:id", (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job) return res.status(404).json({ error: "Project not found." });
  const safe = {
    ...job,
    montage: job.montage ? { ...job.montage } : undefined,
    clips: (job.clips || []).map((clip) => {
      const safeClip = { ...clip };
      if (clip.memeImagePath && fs.existsSync(clip.memeImagePath)) {
        safeClip.memeImageUrl = `/api/projects/${job.id}/clips/${clip.id}/overlay-image`;
      }
      if (clip.audioPath && fs.existsSync(clip.audioPath)) {
        safeClip.audioUrl = `/api/projects/${job.id}/clips/${clip.id}/audio`;
        safeClip.audioName = clip.audioName || "Added sound";
      }
      delete safeClip.memeImagePath;
      delete safeClip.memeImageMime;
      delete safeClip.memeImageName;
      delete safeClip.audioPath;
      delete safeClip.audioMime;
      return safeClip;
    }),
  };
  safe.queuePosition = job.status === "queued"
    ? Math.max(0, processingQueue.findIndex((item) => item.id === job.id) + 1)
    : 0;
  safe.planTier = normalizePlanTier(req.user.planTier);
  safe.klipPharmaWatermarkRequired = !hasPaidPlan(req.user.planTier);
  if (job.filePath && !isAudioOnly(job.filePath)) safe.sourceUrl = `/api/projects/${job.id}/source`;
  if (safe.montage && job.montageAudioPath && fs.existsSync(job.montageAudioPath)) {
    safe.montage.audioName = job.montageAudioName || "Added sound";
    safe.montage.audioUrl = `/api/projects/${job.id}/montage/audio`;
  }
  delete safe.filePath;
  delete safe.objectKey;
  delete safe.userId;
  delete safe.audioPath;
  delete safe.montageAudioPath;
  delete safe.montageAudioName;
  delete safe.montageAudioMime;
  res.json(safe);
});

app.get("/api/projects/:id/source", async (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job) return res.status(404).json({ error: "The original source file is no longer available." });
  try {
    await ensureLocalSource(job);
    res.type(job.mimeType || mimeTypeFor(job.filePath));
    res.sendFile(job.filePath);
  } catch (error) {
    res.status(404).json({ error: error.message || "The original source file is no longer available." });
  }
});

app.get("/api/projects/:id/montage/audio", (req, res) => {
  const owner = ownedJob(req, req.params.id);
  if (!owner?.montageAudioPath || !fs.existsSync(owner.montageAudioPath)) return res.status(404).json({ error: "Added sound not found." });
  res.type(owner.montageAudioMime || mimeTypeFor(owner.montageAudioPath));
  res.sendFile(owner.montageAudioPath);
});

app.post("/api/projects/:id/montage/audio", upload.single("audio"), (req, res) => {
  const owner = ownedJob(req, req.params.id);
  if (!owner?.montage) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Auto-Mix not found." });
  }
  if (!req.file) return res.status(400).json({ error: "Choose an MP3, WAV, M4A, AAC, or OGG audio file." });
  const extension = path.extname(req.file.originalname).toLowerCase();
  const supported = req.file.mimetype.startsWith("audio/") || new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]).has(extension);
  if (!supported) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Choose an MP3, WAV, M4A, AAC, OGG, or FLAC audio file." });
  }
  removeStoredMontageAudio(owner);
  owner.montageAudioPath = req.file.path;
  owner.montageAudioName = String(req.file.originalname || "Added sound").slice(0, 180);
  owner.montageAudioMime = req.file.mimetype;
  persistJob(owner);
  res.json({
    audioName: owner.montageAudioName,
    audioUrl: `/api/projects/${owner.id}/montage/audio?v=${Date.now()}`,
  });
});

app.delete("/api/projects/:id/montage/audio", (req, res) => {
  const owner = ownedJob(req, req.params.id);
  if (!owner?.montage) return res.status(404).json({ error: "Auto-Mix not found." });
  removeStoredMontageAudio(owner);
  persistJob(owner);
  res.json({ ok: true });
});

app.delete("/api/projects/:id/montage/export", (req, res) => {
  const owner = ownedJob(req, req.params.id);
  if (!owner?.montage) return res.status(404).json({ error: "Auto-Mix not found." });
  if (owner.montage.status === "rendering") return res.status(409).json({ error: "Wait for the current Auto-Mix render to finish." });
  removeBatchMontageFiles(owner.batchId || owner.id);
  owner.montage.status = "deleted";
  owner.montage.progress = 100;
  owner.montage.error = "The Auto-Mix MP4 was deleted.";
  delete owner.montage.downloadUrl;
  persistJob(owner);
  res.json({ ok: true });
});

app.post("/api/projects/:id/preview", async (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job) return res.status(404).json({ error: "Project not found." });
  if (isAudioOnly(job.filePath)) return res.status(400).json({ error: "This is an audio-only project, so there is no video preview." });
  try {
    await ensureLocalSource(job);
  } catch (error) {
    return res.status(404).json({ error: error.message || "The original source file is no longer available. Upload it again to rebuild the preview." });
  }
  const ready = await generatePreview(job);
  if (!ready) return res.status(422).json({ error: job.previewError || "KlipPharma could not build a browser preview for this file." });
  res.json({ previewUrl: job.previewUrl, previewHasAudio: job.previewHasAudio !== false });
});

app.post("/api/projects/:id/montage/render", (req, res) => {
  const owner = ownedJob(req, req.params.id);
  if (!owner?.montage) return res.status(404).json({ error: "Auto-Mix not found." });
  if (batchMontageTasks.has(owner.batchId) || owner.montage.status === "rendering") {
    return res.status(409).json({ error: "Wait for the current Auto-Mix render to finish." });
  }
  const group = [...jobs.values()]
    .filter((job) => job.batchId === owner.batchId && canAccessJob(req, job))
    .sort((a, b) => Number(a.batchPosition || 0) - Number(b.batchPosition || 0));
  let segments;
  try {
    segments = hydrateMontageSegments(group, req.body.segments);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (typeof req.body.captionsEnabled === "boolean") owner.montage.captionsEnabled = req.body.captionsEnabled;
  if (new Set(["bold", "clean", "karaoke", "minimal"]).has(req.body.captionStyle)) owner.montage.captionStyle = req.body.captionStyle;
  if (new Set(["bottom", "middle", "top"]).has(req.body.captionPosition)) owner.montage.captionPosition = req.body.captionPosition;
  if (typeof req.body.watermarkText === "string") owner.watermarkText = normalizeWatermarkText(req.body.watermarkText);
  if (req.body.watermarkPosition) owner.watermarkPosition = normalizeOverlayPosition(req.body.watermarkPosition);
  owner.planTier = normalizePlanTier(req.user.planTier);
  owner.klipPharmaWatermarkRequired = !hasPaidPlan(req.user.planTier);
  owner.montage.sourceVolume = normalizeMixerPercent(req.body.sourceVolume, owner.montage.sourceVolume ?? 100);
  owner.montage.addedAudioVolume = normalizeMixerPercent(req.body.addedAudioVolume, owner.montage.addedAudioVolume ?? 35);
  owner.montage.audioStart = normalizeAudioSeconds(req.body.audioStart, owner.montage.audioStart ?? 0, 90);
  owner.montage.audioFadeIn = normalizeAudioSeconds(req.body.audioFadeIn, owner.montage.audioFadeIn ?? 1, 10);
  owner.montage.audioFadeOut = normalizeAudioSeconds(req.body.audioFadeOut, owner.montage.audioFadeOut ?? 1, 10);
  if (typeof req.body.audioLoop === "boolean") owner.montage.audioLoop = req.body.audioLoop;
  if (typeof req.body.autoDuck === "boolean") owner.montage.autoDuck = req.body.autoDuck;
  owner.montage.status = "rendering";
  owner.montage.progress = 2;
  owner.montage.revision = Number(owner.montage.revision || 1) + 1;
  delete owner.montage.error;
  delete owner.montage.downloadUrl;
  persistJob(owner);

  const task = renderBatchMontage(group, owner, segments, req.user.planTier)
    .catch((error) => {
      console.error("Auto-Mix rebuild failed:", error);
      owner.montage.status = "failed";
      owner.montage.progress = 100;
      owner.montage.error = friendlyError(error);
      persistJob(owner);
    })
    .finally(() => batchMontageTasks.delete(owner.batchId));
  batchMontageTasks.set(owner.batchId, task);
  res.status(202).json({ status: "rendering", revision: owner.montage.revision });
});

app.patch("/api/projects/:id/clips/:clipId", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) return res.status(404).json({ error: "Clip not found." });
  if (clip.renderStatus === "rendering") return res.status(409).json({ error: "Wait for the current render to finish before changing the cut." });

  const start = Number(req.body.start);
  const end = Number(req.body.end);
  const mediaDuration = Number(job.duration || job.segments?.at(-1)?.end || 0);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return res.status(400).json({ error: "Start and end times are required." });
  if (start < 0 || end > mediaDuration + 0.05 || end <= start) return res.status(400).json({ error: "Choose a valid section inside the source video." });
  if (end - start > 90.05) return res.status(400).json({ error: "A klip can be no longer than 90 seconds." });
  if (end - start < 1) return res.status(400).json({ error: "A klip must be at least 1 second long." });

  clip.start = Math.round(start * 100) / 100;
  clip.end = Math.round(end * 100) / 100;
  if (typeof req.body.captionsEnabled === "boolean") clip.captionsEnabled = req.body.captionsEnabled;
  if (typeof req.body.captionText === "string") clip.captionText = req.body.captionText.trim().slice(0, 5000);
  if (new Set(["bold", "clean", "karaoke", "minimal"]).has(req.body.captionStyle)) clip.captionStyle = req.body.captionStyle;
  if (new Set(["bottom", "middle", "top"]).has(req.body.captionPosition)) clip.captionPosition = req.body.captionPosition;
  if (typeof req.body.watermarkText === "string") clip.watermarkText = normalizeWatermarkText(req.body.watermarkText);
  if (req.body.watermarkPosition) clip.watermarkPosition = normalizeOverlayPosition(req.body.watermarkPosition);
  clip.focusX = normalizeFocusX(req.body.focusX, clip.focusX ?? 50);
  clip.sourceVolume = normalizeMixerPercent(req.body.sourceVolume, clip.sourceVolume ?? (job.audioTranslation === "dubbed" ? 16 : 100));
  clip.addedAudioVolume = normalizeMixerPercent(req.body.addedAudioVolume, clip.addedAudioVolume ?? 35);
  clip.audioStart = normalizeAudioSeconds(req.body.audioStart, clip.audioStart ?? 0, 90);
  clip.audioFadeIn = normalizeAudioSeconds(req.body.audioFadeIn, clip.audioFadeIn ?? 1, 10);
  clip.audioFadeOut = normalizeAudioSeconds(req.body.audioFadeOut, clip.audioFadeOut ?? 1, 10);
  if (typeof req.body.audioLoop === "boolean") clip.audioLoop = req.body.audioLoop;
  if (typeof req.body.autoDuck === "boolean") clip.autoDuck = req.body.autoDuck;
  clip.translationLanguage = normalizeTranslationLanguage(req.body.translationLanguage || clip.translationLanguage || job.translationLanguage);
  clip.audioTranslation = normalizeAudioTranslation(req.body.audioTranslation ?? clip.audioTranslation ?? job.audioTranslation, clip.translationLanguage);
  clip.dubVoice = normalizeDubVoice(req.body.dubVoice || clip.dubVoice || job.dubVoice);
  if (hasCreativeAccess(req.user.planTier)) {
    if (typeof req.body.memeEnabled === "boolean") clip.memeEnabled = req.body.memeEnabled;
    if (typeof req.body.memeHeadline === "string") clip.memeHeadline = normalizeMemeHeadline(req.body.memeHeadline);
    clip.memeTemplate = normalizeMemeTemplate(req.body.memeTemplate || clip.memeTemplate);
    clip.memePosition = normalizeMemePosition(req.body.memePosition || clip.memePosition);
    clip.memeFontSize = normalizeMemeFontSize(req.body.memeFontSize || clip.memeFontSize);
    clip.memeTextColor = normalizeMemeTextColor(req.body.memeTextColor || clip.memeTextColor);
    clip.memeBoxColor = normalizeMemeBoxColor(req.body.memeBoxColor || clip.memeBoxColor);
    clip.memeBackground = normalizeMemeBackground(req.body.memeBackground || clip.memeBackground);
    const selectedDuration = clip.end - clip.start;
    clip.memeStart = normalizeAudioSeconds(req.body.memeStart, clip.memeStart ?? 0, selectedDuration);
    clip.memeEnd = normalizeAudioSeconds(req.body.memeEnd, clip.memeEnd ?? selectedDuration, selectedDuration);
    if (clip.memeEnd <= clip.memeStart) clip.memeEnd = Math.min(selectedDuration, clip.memeStart + 0.5);
  } else {
    clip.memeEnabled = false;
  }
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  const safeClip = { ...clip };
  if (clip.memeImagePath && fs.existsSync(clip.memeImagePath)) {
    safeClip.memeImageUrl = `/api/projects/${job.id}/clips/${clip.id}/overlay-image`;
  }
  if (clip.audioPath && fs.existsSync(clip.audioPath)) {
    safeClip.audioUrl = `/api/projects/${job.id}/clips/${clip.id}/audio`;
    safeClip.audioName = clip.audioName || "Added sound";
  }
  delete safeClip.memeImagePath;
  delete safeClip.memeImageMime;
  delete safeClip.memeImageName;
  delete safeClip.audioPath;
  delete safeClip.audioMime;
  res.json({ clip: safeClip });
});

app.get("/api/projects/:id/clips/:clipId/audio", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!clip?.audioPath || !fs.existsSync(clip.audioPath)) return res.status(404).json({ error: "Added sound not found." });
  res.type(clip.audioMime || mimeTypeFor(clip.audioPath));
  res.sendFile(clip.audioPath);
});

app.post("/api/projects/:id/clips/:clipId/audio", upload.single("audio"), (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) {
    removeLocalFile(req.file?.path, uploadDir);
    return res.status(404).json({ error: "Klip not found." });
  }
  const extension = path.extname(req.file?.originalname || "").toLowerCase();
  if (!req.file || !new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]).has(extension)) {
    removeLocalFile(req.file?.path, uploadDir);
    return res.status(400).json({ error: "Choose an MP3, WAV, M4A, AAC, OGG, or FLAC audio file." });
  }
  removeStoredClipAudio(clip);
  clip.audioPath = req.file.path;
  clip.audioName = String(req.file.originalname || "Added sound").slice(0, 180);
  clip.audioMime = req.file.mimetype;
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  res.status(201).json({
    audioName: clip.audioName,
    audioUrl: `/api/projects/${job.id}/clips/${clip.id}/audio`,
  });
});

app.delete("/api/projects/:id/clips/:clipId/audio", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) return res.status(404).json({ error: "Klip not found." });
  removeStoredClipAudio(clip);
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  res.json({ ok: true });
});

app.get("/api/projects/:id/clips/:clipId/overlay-image", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!clip?.memeImagePath || !fs.existsSync(clip.memeImagePath)) return res.status(404).json({ error: "Overlay image not found." });
  res.type(clip.memeImageMime || mimeTypeFor(clip.memeImagePath));
  res.sendFile(clip.memeImagePath);
});

app.post("/api/projects/:id/clips/:clipId/overlay-image", overlayImageUpload.single("image"), (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) {
    removeLocalFile(req.file?.path, uploadDir);
    return res.status(404).json({ error: "Klip not found." });
  }
  if (!hasCreativeAccess(req.user.planTier)) {
    removeLocalFile(req.file?.path, uploadDir);
    return res.status(403).json({ error: "Meme & Overlay Studio is available on the Pro plan." });
  }
  if (!req.file) return res.status(400).json({ error: "Choose a PNG, JPG, WebP, or GIF image." });
  removeLocalFile(clip.memeImagePath, uploadDir);
  clip.memeImagePath = req.file.path;
  clip.memeImageMime = req.file.mimetype;
  clip.memeImageName = String(req.file.originalname || "Overlay image").slice(0, 180);
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  res.status(201).json({
    memeImageUrl: `/api/projects/${job.id}/clips/${clip.id}/overlay-image`,
    memeImageName: clip.memeImageName,
  });
});

app.delete("/api/projects/:id/clips/:clipId/overlay-image", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) return res.status(404).json({ error: "Klip not found." });
  removeLocalFile(clip.memeImagePath, uploadDir);
  delete clip.memeImagePath;
  delete clip.memeImageMime;
  delete clip.memeImageName;
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  res.json({ ok: true });
});

app.post("/api/projects/:id/clips/:clipId/render", async (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) return res.status(404).json({ error: "Clip not found." });
  if (clip.renderStatus === "rendering") return res.status(202).json({ status: "rendering" });
  job.planTier = normalizePlanTier(req.user.planTier);
  job.klipPharmaWatermarkRequired = !hasPaidPlan(req.user.planTier);
  clip.renderStatus = "rendering";
  persistJob(job);
  res.status(202).json({ status: "rendering" });
  renderClip(job, clip, req.user.planTier).catch((error) => {
    console.error(error);
    clip.renderStatus = "failed";
    clip.renderError = friendlyError(error);
    persistJob(job);
  });
});

app.delete("/api/projects/:id/clips/:clipId/export", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!job || !clip) return res.status(404).json({ error: "Klip not found." });
  if (clip.renderStatus === "rendering") return res.status(409).json({ error: "Wait for the current render to finish." });
  removeLocalFile(path.join(exportDir, `${job.id}-${clip.id}.mp4`), exportDir);
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  res.json({ ok: true });
});

app.post("/api/projects/:id/clips/:clipId/feedback", (req, res) => {
  const job = ownedJob(req, req.params.id);
  const clip = job?.clips?.find((item) => item.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: "Clip not found." });
  const allowed = new Set(["good", "almost", "bad", "wrong-topic"]);
  if (!allowed.has(req.body.rating)) return res.status(400).json({ error: "Invalid feedback." });
  clip.feedback = req.body.rating;
  persistJob(job);
  res.json({ ok: true });
});

async function importYouTubeSource(job, canonicalUrl) {
  const outputTemplate = path.join(uploadDir, `${job.id}.%(ext)s`);
  const cookies = createYouTubeCookiesOption();
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--max-filesize", "1024M",
    "--match-filter", "duration <= 14400 & !is_live",
    "--format", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]",
    "--merge-output-format", "mp4",
    "--remux-video", "mp4",
    "--ffmpeg-location", ffmpegPath || "ffmpeg",
    "--output", outputTemplate,
    "--print", "after_move:%(title)s",
    "--print", "after_move:%(filepath)s",
    ...cookies.args,
    canonicalUrl,
  ];
  let result;
  try {
    result = await runYouTubeDownloadWithFallback(args, job);
  } catch (error) {
    if (isYouTubeAuthRequiredError(error)) {
      error.code = "YOUTUBE_SOURCE_AUTH_REQUIRED";
      error.userMessage = YOUTUBE_AUTH_REQUIRED_MESSAGE;
    }
    throw error;
  } finally {
    cookies.cleanup();
  }
  const candidates = fs.readdirSync(uploadDir)
    .filter((name) => name.startsWith(`${job.id}.`) && !name.endsWith(".part") && !name.endsWith(".ytdl"))
    .map((name) => path.join(uploadDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile());
  const downloaded = candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!downloaded) throw new Error("yt-dlp completed without producing a video file.");
  const size = fs.statSync(downloaded).size;
  if (!size || size > 1024 * 1024 * 1024) throw new Error("The imported video must be smaller than 1 GB.");

  if (isKlipdoseProject(job)) await validateKlipdoseImportedMedia(job, downloaded);
  const printed = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = sanitizeYouTubeTitle(printed.find((line) => !path.isAbsolute(line)) || "YouTube video");
  job.filePath = downloaded;
  job.mimeType = mimeTypeFor(downloaded);
  job.originalName = `${title}${path.extname(downloaded).toLowerCase() || ".mp4"}`;
  job.sourceReady = true;
  Object.assign(job, { status: "queued", progress: 48, phase: "queued", stage: "Source MP4 ready · waiting for the klip processor" });
  persistJob(job);
  enqueueProject(job);
}

async function importProjectSource(job) {
  ensureSourceClassification(job);
  if (job.sourceType === "external_link") {
    Object.assign(job, {
      status: "link_only",
      phase: "link_only",
      stage: "External source link saved",
      error: null,
      progress: 3,
      sourceReady: false,
    });
    persistJob(job);
    return;
  }
  if (job.sourceType === "youtube") return importYouTubeSource(job, normalizeYouTubeSource(job.sourceUrl).canonicalUrl);
  if (job.sourceType === "kick_live") {
    const error = new Error("Kick stream is currently live and no completed VOD exists yet.");
    error.code = "KICK_AWAITING_VOD";
    throw error;
  }
  if (job.sourceType === "kick_vod") return importKickVodSource(job);
  if (job.sourceType === "direct_media") return importDirectMediaSource(job);
  Object.assign(job, {
    status: "link_only",
    phase: "link_only",
    stage: "Source link saved",
    error: null,
    progress: 3,
    sourceReady: false,
  });
  persistJob(job);
}

function ensureSourceClassification(job) {
  if (!job?.sourceUrl || (job.sourcePlatform && job.sourceType)) return job;
  const detected = detectSourcePlatform(job.sourceUrl);
  job.sourcePlatform = detected.sourcePlatform;
  job.sourceType = detected.sourceType;
  job.sourceProvider = detected.sourcePlatform;
  job.sourceVideoId = job.sourceVideoId || detected.kickVideoId || null;
  return job;
}

async function importKickVodSource(job) {
  job.stage = "Resolving Kick VOD playback";
  job.progress = 8;
  persistJob(job);
  const manifestUrl = await resolveKickManifestUrl(job.sourceUrl);
  if (!manifestUrl) {
    const error = new Error("Kick VOD playback manifest is unavailable or expired.");
    error.code = "SOURCE_UNAVAILABLE";
    throw error;
  }
  return importM3u8Source(job, manifestUrl, "Kick VOD");
}

async function importDirectMediaSource(job) {
  const url = await assertSafePublicUrl(job.sourceUrl);
  const contentType = await safeHeadContentType(url.toString());
  const pathname = url.pathname.toLowerCase();
  const isM3u8 = pathname.endsWith(".m3u8") || /mpegurl|m3u8/i.test(contentType);
  const isDirectVideo = /\.(mp4|mov)$/i.test(pathname) || /video\/(mp4|quicktime)|application\/octet-stream/i.test(contentType);
  if (!isM3u8 && !isDirectVideo) throw new Error("That direct URL does not look like an MP4, MOV, or M3U8 media source.");
  return isM3u8
    ? importM3u8Source(job, url.toString(), "Direct M3U8")
    : importDirectVideoUrl(job, url.toString(), "Direct media");
}

async function importM3u8Source(job, manifestUrl, label) {
  await assertSafePublicUrl(manifestUrl);
  const outputPath = path.join(uploadDir, `${job.id}.mp4`);
  const args = [
    "-y",
    "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
    "-rw_timeout", "20000000",
    "-i", manifestUrl,
    "-t", "14400",
    "-c", "copy",
    "-bsf:a", "aac_adtstoasc",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runImportWithRetries(() => runFfmpegImport(args, job, `Downloading ${label}`), job, label);
  completeImportedSource(job, outputPath, `${label} ready · waiting for the klip processor`);
}

async function importDirectVideoUrl(job, mediaUrl, label) {
  await assertSafePublicUrl(mediaUrl);
  const outputPath = path.join(uploadDir, `${job.id}.mp4`);
  const args = [
    "-y",
    "-rw_timeout", "20000000",
    "-i", mediaUrl,
    "-t", "14400",
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "copy",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runImportWithRetries(() => runFfmpegImport(args, job, `Downloading ${label}`), job, label);
  completeImportedSource(job, outputPath, `${label} ready · waiting for the klip processor`);
}

function completeImportedSource(job, filePath, stage) {
  if (!fs.existsSync(filePath)) throw new Error("The source import completed without producing a video file.");
  const size = fs.statSync(filePath).size;
  if (!size || size > 1024 * 1024 * 1024) throw new Error("The imported video must be smaller than 1 GB.");
  job.filePath = filePath;
  job.mimeType = mimeTypeFor(filePath);
  job.originalName = job.originalName || path.basename(filePath);
  job.sourceReady = true;
  Object.assign(job, { status: "queued", progress: 48, phase: "queued", stage, error: null });
  if (isKlipdoseProject(job)) {
    validateKlipdoseImportedMedia(job, filePath)
      .then(() => {
        persistJob(job);
        enqueueProject(job);
      })
      .catch((error) => {
        removeLocalFile(filePath, uploadDir);
        applyKlipdoseMediaValidationFailure(job, error);
        persistJob(job);
        enqueueKlipdoseCallback(job, "failed", { error: job.error });
      });
    return;
  }
  persistJob(job);
  enqueueProject(job);
}


async function validateKlipdoseImportedMedia(job, filePath) {
  const command = ffmpegPath || "ffmpeg";
  const [duration, hasVideo, hasAudio] = await Promise.all([
    probeDuration(command, filePath).catch(() => 0),
    probeHasVideo(command, filePath),
    probeHasAudio(command, filePath),
  ]);
  if (!duration || !hasVideo || !hasAudio) {
    const error = new Error("Imported Klipdose media must contain a playable video stream and usable audio.");
    error.code = "MEDIA_VALIDATION_FAILED";
    throw error;
  }
  job.duration = Math.max(Number(job.duration || 0), Number(duration) || 0);
  return true;
}

function applyKlipdoseMediaValidationFailure(job, error) {
  Object.assign(job, {
    status: "failed",
    progress: Math.min(95, Math.max(3, Number(job.progress || 3))),
    phase: "failed",
    stage: "Klipdose media validation failed",
    error: error.message || "Imported Klipdose media must contain a playable video stream and usable audio.",
    sourceReady: false,
    failedAt: new Date().toISOString(),
  });
  applyKlipdoseHandoffState(job, "failed", { error: job.error, code: error.code || "MEDIA_VALIDATION_FAILED" });
}

function enqueueKlipdoseCallback(job, state, extra = {}) {
  if (!job?.callbackUrl) return;
  void deliverKlipdoseCallback(job, state, extra, 1);
}

async function deliverKlipdoseCallback(job, state, extra = {}, attempt = 1) {
  const payload = klipdoseCallbackPayload(job, state, extra);
  const bodyText = JSON.stringify(payload);
  const signature = signKlipdoseCallbackBody(bodyText, klipdoseCallbackSecret(process.env));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let shouldRetry = false;
  try {
    const response = await fetch(job.callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "KlipPharma-Klipdose-Callback/1.0",
        ...(signature ? { "x-klippharma-signature": signature } : {}),
      },
      body: bodyText,
      signal: controller.signal,
    });
    shouldRetry = shouldRetryKlipdoseCallback(response.status);
    recordKlipdoseCallbackAttempt(job, {
      state,
      attempt,
      statusCode: response.status,
      delivered: response.ok,
      final: response.ok || !shouldRetry || attempt >= 5,
    });
    persistJob(job);
  } catch (error) {
    shouldRetry = attempt < 5;
    recordKlipdoseCallbackAttempt(job, {
      state,
      attempt,
      delivered: false,
      final: attempt >= 5,
      error: error?.name === "AbortError" ? "Callback request timed out." : "Callback request failed.",
    });
    persistJob(job);
  } finally {
    clearTimeout(timeout);
  }
  if (shouldRetry && attempt < 5) {
    setTimeout(() => deliverKlipdoseCallback(job, state, extra, attempt + 1), Math.min(30000, 1000 * (2 ** attempt)));
  }
}

function runFfmpegImport(args, job, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let saved = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error(`${label} timed out.`);
      error.code = "SOURCE_UNAVAILABLE";
      reject(error);
    }, 10 * 60 * 1000);
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-12000);
      if (saved) return;
      saved = true;
      job.status = "importing";
      job.phase = "import";
      job.stage = label;
      job.progress = Math.max(10, Number(job.progress || 10));
      persistJob(job);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const error = new Error(`ffmpeg exited ${code}: ${stderr}`);
      if (/404|403|not found|expired|invalid data|server returned/i.test(stderr)) error.code = "SOURCE_UNAVAILABLE";
      reject(error);
    });
  });
}

async function runImportWithRetries(task, job, label, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) {
        job.stage = `Retrying ${label} import · attempt ${attempt}`;
        job.progress = Math.max(10, Number(job.progress || 10));
        persistJob(job);
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
      return await task();
    } catch (error) {
      lastError = error;
      if (error?.code === "SOURCE_UNAVAILABLE") break;
    }
  }
  throw lastError;
}

async function resolveKickManifestUrl(sourceUrl) {
  await assertSafePublicUrl(sourceUrl);
  const detected = detectSourcePlatform(sourceUrl);
  const candidates = [
    detected.kickVideoId ? `https://kick.com/api/v1/video/${encodeURIComponent(detected.kickVideoId)}` : null,
    detected.kickVideoId ? `https://kick.com/api/v2/video/${encodeURIComponent(detected.kickVideoId)}` : null,
    sourceUrl,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const response = await safeFetch(candidate, { headers: { Accept: "application/json,text/html,*/*" } });
      const text = await response.text();
      const manifest = extractM3u8Url(text);
      if (manifest) return manifest;
    } catch {
      // Try the next public Kick shape.
    }
  }
  return null;
}

async function safeHeadContentType(sourceUrl) {
  const response = await safeFetch(sourceUrl, { method: "HEAD" });
  const type = response.headers.get("content-type") || "";
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 1024 * 1024 * 1024) throw new Error("The source file must be smaller than 1 GB.");
  return type;
}

async function safeFetch(sourceUrl, options = {}, redirects = 0) {
  await assertSafePublicUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(sourceUrl, { ...options, redirect: "manual", signal: controller.signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 3) throw new Error("Too many source redirects.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Source redirect was missing a location.");
      const redirected = new URL(location, sourceUrl).toString();
      await assertSafePublicUrl(redirected);
      return safeFetch(redirected, options, redirects + 1);
    }
    if (!response.ok) {
      const error = new Error(`Source request failed with HTTP ${response.status}.`);
      if (response.status === 404 || response.status === 410 || response.status === 403) error.code = "SOURCE_UNAVAILABLE";
      throw error;
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function runYouTubeDownload(command, args, job) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let lastSavedProgress = 0;
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-12000); });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr = (stderr + text).slice(-12000);
      const match = text.match(/\[download\]\s+([\d.]+)%/);
      if (!match) return;
      const percent = Math.max(0, Math.min(100, Number(match[1]) || 0));
      const progress = 5 + Math.round(percent * 0.4);
      if (progress < lastSavedProgress + 3) return;
      lastSavedProgress = progress;
      job.progress = progress;
      job.phase = "import";
      job.stage = `Downloading your source MP4 · ${Math.round(percent)}%`;
      persistJob(job);
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`yt-dlp exited ${code}: ${stderr}`)));
  });
}

async function runYouTubeDownloadWithFallback(args, job) {
  const configuredPath = String(process.env.YT_DLP_PATH || "").trim();
  const candidates = [
    ...(configuredPath ? [{ command: configuredPath, prefix: [] }] : []),
    { command: "yt-dlp", prefix: [] },
    { command: "python3", prefix: ["-m", "yt_dlp"] },
    { command: "python", prefix: ["-m", "yt_dlp"] },
  ];
  const attempted = new Set();

  for (const candidate of candidates) {
    const signature = `${candidate.command}\0${candidate.prefix.join("\0")}`;
    if (attempted.has(signature)) continue;
    attempted.add(signature);
    try {
      return await runYouTubeDownload(candidate.command, [...candidate.prefix, ...args], job);
    } catch (error) {
      const message = String(error?.message || "");
      const unavailable = error?.code === "ENOENT" || /No module named (?:yt_dlp|'yt_dlp')/i.test(message);
      if (!unavailable) throw error;
    }
  }

  const error = new Error("No yt-dlp executable or Python yt_dlp module is available.");
  error.code = "YOUTUBE_IMPORTER_MISSING";
  throw error;
}

function removeYouTubeWorkingFiles(jobId) {
  for (const name of fs.readdirSync(uploadDir)) {
    if (name.startsWith(`${jobId}.`)) removeLocalFile(path.join(uploadDir, name), uploadDir);
  }
}

function applyYouTubeImportFailure(job, error, fallbackStage) {
  const patch = youtubeImportFailurePatch(error, fallbackStage);
  Object.assign(job, {
    ...patch,
    progress: Math.min(95, Math.max(3, Number(job.progress || 3))),
    error: patch.error || friendlyYouTubeError(error),
    failedAt: new Date().toISOString(),
  });
}

function applySourceImportFailure(job, error, fallbackStage) {
  const kickPatch = job.sourcePlatform === "kick" ? classifyKickImportError(error) : null;
  const rawYouTubePatch = job.sourceType === "youtube" ? youtubeImportFailurePatch(error, fallbackStage) : null;
  const youtubePatch = rawYouTubePatch?.status === "source_auth_required"
    ? rawYouTubePatch
    : rawYouTubePatch
      ? {
          status: "link_only",
          phase: "link_only",
          stage: "YouTube source link saved",
          error: "YouTube could not be imported directly. The source link is still saved; upload an authorized source file to process it.",
        }
      : null;
  const unavailablePatch = error?.code === "SOURCE_UNAVAILABLE"
    ? {
        status: "source_unavailable",
        phase: "source_unavailable",
        stage: "Source media unavailable",
        error: "The source media is unavailable or expired. The original source link is still saved.",
      }
    : null;
  const patch = kickPatch || youtubePatch || unavailablePatch || {
    status: job.sourceType === "youtube" ? "link_only" : "failed",
    phase: job.sourceType === "youtube" ? "link_only" : "failed",
    stage: job.sourceType === "youtube" ? "YouTube source link saved" : fallbackStage,
    error: job.sourceType === "youtube"
      ? "YouTube could not be imported directly. The source link is still saved; upload an authorized source file to process it."
      : null,
  };
  Object.assign(job, {
    ...patch,
    progress: Math.min(95, Math.max(3, Number(job.progress || 3))),
    error: patch.error || friendlyYouTubeError(error),
    sourceReady: false,
    failedAt: new Date().toISOString(),
  });
}

function safeYouTubeImportLog(job, error) {
  const message = String(error?.userMessage || error?.message || "");
  return {
    projectId: job?.id,
    code: error?.code || "YOUTUBE_IMPORT_FAILED",
    status: error?.code === "YOUTUBE_SOURCE_AUTH_REQUIRED" || isYouTubeAuthRequiredError(error) ? "source_auth_required" : "failed",
    message: message
      .replace(/--cookies\s+\S+/gi, "--cookies [redacted]")
      .replace(/--cookies-from-browser\s+\S+/gi, "--cookies-from-browser [redacted]")
      .slice(0, 500),
  };
}

function safeSourceImportLog(job, error) {
  const details = safeYouTubeImportLog(job, error);
  return {
    ...details,
    sourcePlatform: job?.sourcePlatform || job?.sourceProvider || null,
    sourceType: job?.sourceType || null,
  };
}

function friendlyYouTubeError(error) {
  if (error?.userMessage) return error.userMessage;
  const message = String(error?.message || "");
  if (error?.code === "YOUTUBE_SOURCE_AUTH_REQUIRED" || isYouTubeAuthRequiredError(error)) {
    return YOUTUBE_AUTH_REQUIRED_MESSAGE;
  }
  if (error?.code === "ENOENT" || error?.code === "YOUTUBE_IMPORTER_MISSING") {
    return "The YouTube importer is not installed on this server yet.";
  }
  if (/private video|members-only|age.?restricted|sign in|cookies|not available|unavailable/i.test(message)) {
    return "YouTube would not release this source. Private, protected, age-restricted, or account-only videos must be downloaded from YouTube Studio first.";
  }
  if (/larger than|filesize|max-filesize|duration|live/i.test(message)) {
    return "This source is too large, longer than four hours, or is a live stream. Use a finished video under 1 GB.";
  }
  return "KlipPharma could not import that YouTube video. Confirm it is your public or unlisted upload, or download it from YouTube Studio first.";
}

async function ensureLocalSource(job) {
  if (job.filePath && fs.existsSync(job.filePath) && fs.statSync(job.filePath).size > 0) return job.filePath;
  if (!job.objectKey) throw new Error("The original source file is no longer available. Upload it again to continue.");
  job.stage = "Retrieving your private source from cloud storage";
  persistJob(job);
  await downloadObject(job.objectKey, job.filePath);
  return job.filePath;
}

async function processProject(job) {
  await ensureLocalSource(job);
  const command = ffmpegPath || "ffmpeg";
  let manualMode = job.processingMode === "manual";
  const sourceHasAudio = manualMode ? true : await probeHasAudio(command, job.filePath);
  if (!manualMode && !sourceHasAudio) {
    // Camera-roll exports, screen recordings, and generated visuals can legally
    // contain video only. There is nothing to transcribe, so keep the source
    // usable and open it in the visual/manual editor instead of failing FFmpeg.
    manualMode = true;
    job.processingMode = "manual";
    job.silentSource = true;
  }
  Object.assign(job, {
    status: "processing",
    progress: 10,
    phase: manualMode ? "prepare" : "audio",
    stage: job.silentSource
      ? "No audio track detected · preparing the visual editor"
      : manualMode ? "Preparing your manual editor" : "Extracting clear audio from your video",
  });
  persistJob(job);
  const audioPath = path.join(uploadDir, `${job.id}-audio.mp3`);
  const audioOnly = isAudioOnly(job.filePath);
  const previewTask = audioOnly ? Promise.resolve(false) : generatePreview(job);
  const durationTask = probeDuration(command, job.filePath).catch(() => 0);
  const audioTask = manualMode
    ? Promise.resolve()
    : run(command, [
      "-y", "-i", job.filePath, "-vn", "-ac", "1", "-ar", "16000",
      "-b:a", "48k", audioPath,
    ]);
  const [, , mediaDuration] = await Promise.all([audioTask, previewTask, durationTask]);
  job.duration = Math.max(1, Number(mediaDuration) || 1);
  job.progress = 24;
  job.phase = "prepare";
  job.stage = job.silentSource ? "Silent source preview ready" : manualMode ? "Source preview ready" : "Audio and preview prepared";
  persistJob(job);

  if (manualMode) {
    job.transcript = "";
    job.segments = [];
    job.clips = [{
      id: "clip-1",
      rank: 1,
      manual: true,
      start: 0,
      end: Math.min(90, job.duration),
      title: "Manual Cut",
      hook: "Preview the source and choose the exact moment you want.",
      caption: "",
      whyChosen: job.silentSource
        ? "This source has no audio track, so there is nothing to transcribe. Use the visual editor to set the cut, add music or sounds, and create your klip."
        : "AI transcription is off for this video. Use the start and end controls to create your own klip without transcription charges.",
      scores: {},
      overallScore: null,
      captionsEnabled: false,
      captionText: "",
      captionStyle: "bold",
      captionPosition: "bottom",
      watermarkText: job.watermarkText || "",
      watermarkPosition: job.watermarkPosition || "top-right",
      focusX: 50,
      sourceVolume: job.audioTranslation === "dubbed" ? 16 : 100,
      addedAudioVolume: 35,
      audioStart: 0,
      audioFadeIn: 1,
      audioFadeOut: 1,
      audioLoop: true,
      autoDuck: true,
      translationLanguage: job.translationLanguage,
      audioTranslation: job.audioTranslation,
      dubVoice: job.dubVoice,
      renderStatus: "idle",
      feedback: null,
    }];
    Object.assign(job, {
      status: "ready",
      progress: 100,
      phase: "ready",
      stage: job.silentSource ? "Visual editor ready · add audio when you want" : "Manual editor ready",
    });
    if (isKlipdoseProject(job)) {
      applyKlipdoseHandoffState(job, "ready", { clipCount: job.clips.length });
      enqueueKlipdoseCallback(job, "ready", { clipCount: job.clips.length });
    }
    persistJob(job);
    return;
  }

  job.audioPath = audioPath;
  job.progress = 28;
  job.phase = "transcribe";
  job.stage = "Transcribing every word and timestamp";
  persistJob(job);
  const transcription = await transcribeAudio(job, audioPath);
  job.progress = 55;
  job.detectedLanguage = normalizeDetectedLanguage(transcription.language || job.sourceLanguage);
  job.originalTranscript = transcription.text;
  job.originalSegments = normalizeSegments(transcription);
  job.transcript = job.originalTranscript;
  job.segments = job.originalSegments;
  if (job.translationLanguage !== "original") {
    job.progress = 64;
    job.phase = "translate";
    job.stage = `Translating captions into ${languageLabel(job.translationLanguage)}`;
    persistJob(job);
    job.segments = await translateSegments(job.originalSegments, job.translationLanguage, job);
    job.transcript = job.segments.map((segment) => segment.text).join(" ").trim();
  }
  job.progress = 82;
  job.phase = "select";
  job.stage = `Selecting the strongest ${job.requestedOutputCount || 8} klips`;
  persistJob(job);
  job.duration = Math.max(job.duration, Math.ceil(job.segments.at(-1)?.end || 0));
  const clips = await chooseClips(job);
  job.clips = clips.map((clip, index) => ({
    ...clip,
    id: `clip-${index + 1}`,
    rank: index + 1,
    captionsEnabled: true,
    captionStyle: "bold",
    captionPosition: "bottom",
    watermarkText: job.watermarkText || "",
    watermarkPosition: job.watermarkPosition || "top-right",
    focusX: 50,
    sourceVolume: job.audioTranslation === "dubbed" ? 16 : 100,
    addedAudioVolume: 35,
    audioStart: 0,
    audioFadeIn: 1,
    audioFadeOut: 1,
    audioLoop: true,
    autoDuck: true,
    translationLanguage: job.translationLanguage,
    audioTranslation: job.audioTranslation,
    dubVoice: job.dubVoice,
    renderStatus: "idle",
    feedback: null,
  }));
  Object.assign(job, { status: "ready", progress: 100, phase: "ready", stage: `${job.clips.length} dope clips found` });
  if (isKlipdoseProject(job)) {
    applyKlipdoseHandoffState(job, "ready", { clipCount: job.clips.length });
    enqueueKlipdoseCallback(job, "ready", { clipCount: job.clips.length });
  }
  persistJob(job);
}

async function transcribeAudio(job, audioPath) {
  const maxDirectBytes = 24 * 1024 * 1024;
  const files = [];
  if (fs.statSync(audioPath).size <= maxDirectBytes) {
    files.push({ path: audioPath, offset: 0 });
  } else {
    const chunkPattern = path.join(uploadDir, `${job.id}-audio-%03d.mp3`);
    await run(ffmpegPath || "ffmpeg", [
      "-y", "-i", audioPath, "-f", "segment", "-segment_time", "1800",
      "-reset_timestamps", "1", "-c", "copy", chunkPattern,
    ]);
    const chunkNames = fs.readdirSync(uploadDir)
      .filter((name) => name.startsWith(`${job.id}-audio-`) && name.endsWith(".mp3"))
      .sort();
    chunkNames.forEach((name, index) => files.push({ path: path.join(uploadDir, name), offset: index * 1800 }));
  }

  const combined = { text: "", segments: [], language: job.sourceLanguage === "auto" ? "" : job.sourceLanguage };
  for (let index = 0; index < files.length; index += 1) {
    job.stage = files.length > 1
      ? `Transcribing section ${index + 1} of ${files.length}`
      : "Transcribing every word and timestamp";
    job.progress = 28 + Math.round(((index + 1) / files.length) * 24);
    job.phase = "transcribe";
    persistJob(job);
    const request = {
      file: fs.createReadStream(files[index].path),
      model: process.env.AI_TRANSCRIPTION_MODEL || "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    };
    if (job.sourceLanguage !== "auto") request.language = job.sourceLanguage;
    const part = await openai.audio.transcriptions.create(request);
    if (!combined.language && part.language) combined.language = String(part.language).toLowerCase();
    combined.text = `${combined.text} ${part.text || ""}`.trim();
    for (const segment of part.segments || []) {
      combined.segments.push({
        ...segment,
        start: Number(segment.start) + files[index].offset,
        end: Number(segment.end) + files[index].offset,
      });
    }
  }
  return combined;
}

async function translateSegments(segments, targetLanguage, job = null) {
  const translated = [];
  const targetLabel = languageLabel(targetLanguage);
  for (let offset = 0; offset < segments.length; offset += 60) {
    const chunk = segments.slice(offset, offset + 60);
    if (job) {
      const completed = Math.ceil(offset / 60);
      const total = Math.max(1, Math.ceil(segments.length / 60));
      job.progress = 64 + Math.round((completed / total) * 14);
      job.phase = "translate";
      job.stage = `Translating caption group ${completed + 1} of ${total} into ${targetLabel}`;
      persistJob(job);
    }
    const response = await openai.chat.completions.create({
      model: process.env.AI_TEXT_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a professional subtitle translator. Translate spoken-video captions into ${targetLabel}. Preserve meaning, names, tone, slang, and sentence fragments. Do not add commentary. Return strict JSON with a translations array containing index and text.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            targetLanguage: targetLabel,
            captions: chunk.map((segment, index) => ({ index, text: segment.text })),
          }),
        },
      ],
    });
    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    const byIndex = new Map((parsed.translations || []).map((item) => [Number(item.index), String(item.text || "").trim()]));
    chunk.forEach((segment, index) => translated.push({
      ...segment,
      text: byIndex.get(index) || segment.text,
      originalText: segment.text,
    }));
  }
  return translated;
}

function normalizeSegments(transcription) {
  if (Array.isArray(transcription.segments) && transcription.segments.length) {
    return transcription.segments.map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text).trim() }));
  }
  return [{ start: 0, end: 45, text: transcription.text }];
}

async function chooseClips(job) {
  const transcript = job.segments.map((s) => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text}`).join("\n");
  const creatorMode = creatorModes[job.contentType] || creatorModes.auto;
  const requestedLength = Number(job.clipLength);
  const generationMaximum = Number.isFinite(requestedLength) ? requestedLength : 90;
  const requestedOutputCount = Math.min(10, Math.max(1, Number(job.requestedOutputCount) || 8));
  const lengthRule = Number.isFinite(requestedLength)
    ? `The batch recipe requires every initial AI cut to be no longer than ${requestedLength} seconds. Aim for a complete moment between ${Math.max(8, requestedLength - Math.min(8, Math.round(requestedLength * 0.2)))} and ${requestedLength} seconds. This batch rule overrides any preferred range in the creator-mode guidance.`
    : "Use Smart length: choose the shortest duration that preserves the complete hook, context, and payoff, from 15 to 90 seconds.";
  const response = await openai.chat.completions.create({
    model: process.env.AI_TEXT_MODEL || "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are KlipPharma, an expert short-form video editor working in ${creatorMode.label} mode. Select complete, compelling moments grounded only in the timestamped transcript. Never invent dialogue or claim visual/audio events not present in the transcript. Return strict JSON with a clips array.`,
      },
      {
        role: "user",
        content: `Audience: ${job.audience}\nGoal: ${job.goal}\nPlatform: ${job.platform}\nCreator mode: ${creatorMode.label}\n\nBATCH AUTO-KLIP LENGTH\n${lengthRule}\n\nMODE-SPECIFIC EDITORIAL RULES\n${creatorMode.prompt}\n\nReturn the strongest ${requestedOutputCount} non-overlapping clips when the source contains enough qualifying moments, and never return more than ${requestedOutputCount}. Never exceed the batch maximum or 90 seconds. Every selection must begin and end on a complete thought. Each clip needs: start (number), end (number), title, hook, whyChosen, caption, strategy (a short 1-3 word editorial lane), scores object with hook, context, payoff, retention, audienceFit, platformFit (integers 0-100), and overallScore (integer 0-100). Prefer exact transcript boundaries.\n\nTRANSCRIPT\n${transcript.slice(0, 110000)}`,
      },
    ],
  });
  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  const maxEnd = job.segments.at(-1)?.end || Infinity;
  return (parsed.clips || [])
    .map((clip) => {
      const start = Math.max(0, Number(clip.start));
      const end = Math.min(maxEnd, Number(clip.end), start + generationMaximum, start + 90);
      const values = Object.values(clip.scores || {}).map(Number).filter(Number.isFinite);
      const fallbackScore = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      const suppliedScore = Number(clip.overallScore);
      return {
        ...clip,
        start,
        end,
        overallScore: Number.isFinite(suppliedScore) ? Math.round(suppliedScore) : fallbackScore,
      };
    })
    .filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.end - clip.start >= 8)
    .sort((a, b) => Number(b.overallScore) - Number(a.overallScore))
    .slice(0, requestedOutputCount);
}

async function renderClip(job, clip, planTier = job.planTier) {
  await ensureLocalSource(job);
  const outputName = `${job.id}-${clip.id}.mp4`;
  const outputPath = path.join(exportDir, outputName);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "klippharma-klip-"));
  try {
    const relevant = (job.segments || []).filter((s) => s.end > clip.start && s.start < clip.end);
    const duration = clip.end - clip.start;
    let filter = verticalCropFilter(clip.focusX, true);
    const customCaptionText = String(clip.captionText || "").trim();
    const captionCues = customCaptionText
      ? captionCuesFromText(customCaptionText, duration)
      : relevant.map((segment) => ({
        start: Math.max(0, segment.start - clip.start),
        end: Math.min(duration, segment.end - clip.start),
        text: segment.text,
      }));
    if (clip.captionsEnabled !== false && captionCues.length) {
      const subtitlePath = path.join(tempDir, "captions.ass");
      writeCaptionSubtitle(subtitlePath, captionCues, clip.captionStyle, clip.captionPosition);
      filter += watermarkFilter(subtitlePath);
    }
    filter = appendExportWatermarks(filter, tempDir, {
      duration,
      customText: clip.watermarkText,
      customPosition: clip.watermarkPosition,
      brandRequired: !hasPaidPlan(planTier),
      prefix: "clip",
    });
    if (hasCreativeAccess(planTier) && clip.memeEnabled) {
      filter = appendMemeHeadline(filter, tempDir, clip, duration);
      filter = appendMemeImage(filter, clip, duration);
    }
    const audioBitrate = job.contentType === "artist" ? "256k" : "160k";
    const translationLanguage = normalizeTranslationLanguage(clip.translationLanguage || job.translationLanguage);
    const audioTranslation = normalizeAudioTranslation(clip.audioTranslation ?? job.audioTranslation, translationLanguage);
    const dubVoice = normalizeDubVoice(clip.dubVoice || job.dubVoice);
    const originalRelevant = (job.originalSegments || job.segments || [])
      .filter((segment) => segment.end > clip.start && segment.start < clip.end);
    let voiceText = customCaptionText;
    if (!voiceText && audioTranslation === "dubbed") {
      if (translationLanguage === normalizeTranslationLanguage(job.translationLanguage) && job.translationLanguage !== "original") {
        voiceText = relevant.map((segment) => segment.text).join(" ").trim();
      } else {
        const translated = await translateSegments(originalRelevant, translationLanguage);
        voiceText = translated.map((segment) => segment.text).join(" ").trim();
      }
    }
    const dubPath = audioTranslation === "dubbed" && translationLanguage !== "original" && voiceText
      ? await synthesizeTranslatedVoice(voiceText, dubVoice, tempDir, "voiceover")
      : null;
    const hasSourceAudio = await probeHasAudio(ffmpegPath || "ffmpeg", job.filePath);
    const hasAddedAudio = Boolean(clip.audioPath && fs.existsSync(clip.audioPath));
    const sourceVolume = normalizeMixerPercent(clip.sourceVolume, dubPath ? 16 : 100) / 100;
    const basePath = hasAddedAudio ? path.join(tempDir, "base.mp4") : outputPath;
    if (dubPath) {
      const audioFilter = hasSourceAudio && sourceVolume > 0
        ? `[0:a]volume=${sourceVolume}[bed];[1:a]volume=1,apad,atrim=0:${duration}[voice];[bed][voice]amix=inputs=2:duration=first:normalize=0[a]`
        : `[1:a]volume=1,apad,atrim=0:${duration}[a]`;
      await run(ffmpegPath || "ffmpeg", [
        "-y", "-fflags", "+genpts", "-ss", String(clip.start), "-i", job.filePath, "-i", dubPath,
        "-t", String(duration), "-filter_complex", audioFilter,
        "-map", "0:v:0", "-map", "[a]", "-vf", filter,
        ...quickTimeVideoArgs("23"), ...quickTimeAudioArgs(audioBitrate),
        "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
        "-movflags", "+faststart", basePath,
      ]);
    } else if (hasSourceAudio) {
      const audioArgs = sourceVolume === 1
        ? ["-map", "0:a:0?"]
        : ["-filter_complex", `[0:a]volume=${sourceVolume}[a]`, "-map", "[a]"];
      await run(ffmpegPath || "ffmpeg", [
        "-y", "-fflags", "+genpts", "-ss", String(clip.start), "-i", job.filePath,
        "-t", String(duration),
        "-map", "0:v:0", ...audioArgs, "-vf", filter,
        ...quickTimeVideoArgs("23"), ...quickTimeAudioArgs(audioBitrate),
        "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
        "-movflags", "+faststart", basePath,
      ]);
    } else {
      await run(ffmpegPath || "ffmpeg", [
        "-y", "-fflags", "+genpts", "-ss", String(clip.start), "-i", job.filePath,
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-t", String(duration),
        "-map", "0:v:0", "-map", "1:a:0", "-vf", filter,
        ...quickTimeVideoArgs("23"),
        ...quickTimeAudioArgs(audioBitrate),
        "-shortest",
        "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
        "-movflags", "+faststart", basePath,
      ]);
    }
    if (hasAddedAudio) {
      const addedAudioVolume = normalizeMixerPercent(clip.addedAudioVolume, 35) / 100;
      const audioStart = Math.min(Math.max(0, normalizeAudioSeconds(clip.audioStart, 0, 90)), Math.max(0, duration - 0.1));
      const available = Math.max(0.1, duration - audioStart);
      const fadeIn = Math.min(normalizeAudioSeconds(clip.audioFadeIn, 1, 10), available / 2);
      const fadeOut = Math.min(normalizeAudioSeconds(clip.audioFadeOut, 1, 10), available / 2);
      const musicSteps = [
        "aformat=sample_rates=48000:channel_layouts=stereo",
        `volume=${addedAudioVolume}`,
        `atrim=0:${available}`,
        "asetpts=PTS-STARTPTS",
      ];
      if (fadeIn > 0.01) musicSteps.push(`afade=t=in:st=0:d=${fadeIn}`);
      if (fadeOut > 0.01) musicSteps.push(`afade=t=out:st=${Math.max(0, available - fadeOut)}:d=${fadeOut}`);
      const delay = Math.round(audioStart * 1000);
      if (delay > 0) musicSteps.push(`adelay=${delay}|${delay}`);
      const mixedAudio = clip.autoDuck !== false
        ? `[0:a]asplit=2[base][side];[1:a]${musicSteps.join(",")}[music];[music][side]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=500[ducked];[base][ducked]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[a]`
        : `[1:a]${musicSteps.join(",")}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[a]`;
      const addedAudioInput = clip.audioLoop === false
        ? ["-i", clip.audioPath]
        : ["-stream_loop", "-1", "-i", clip.audioPath];
      await run(ffmpegPath || "ffmpeg", [
        "-y", "-i", basePath, ...addedAudioInput,
        "-filter_complex", mixedAudio,
        "-map", "0:v:0", "-map", "[a]", "-t", String(duration),
        "-c:v", "copy", "-tag:v", "avc1", "-video_track_timescale", "30000",
        ...quickTimeAudioArgs(audioBitrate),
        "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputPath,
      ]);
    }
    clip.renderStatus = "ready";
    clip.downloadUrl = `/exports/${outputName}`;
    persistJob(job);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function synthesizeTranslatedVoice(text, voice, destinationDir, prefix) {
  const speech = await openai.audio.speech.create({
    model: process.env.AI_SPEECH_MODEL || "gpt-4o-mini-tts",
    voice: normalizeDubVoice(voice),
    input: String(text).trim().slice(0, 4096),
    response_format: "mp3",
    instructions: "Speak naturally in the language provided. Preserve the creator's energy and meaning. Do not add words.",
  });
  const destination = path.join(destinationDir, `${prefix}-${crypto.randomUUID()}.mp3`);
  fs.writeFileSync(destination, Buffer.from(await speech.arrayBuffer()));
  return destination;
}

function captionCuesFromText(text, duration) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const maxCues = Math.max(1, Math.floor(Math.max(1, duration) / 1.2));
  const chunkSize = Math.max(4, Math.ceil(words.length / maxCues));
  const chunks = [];
  for (let index = 0; index < words.length; index += chunkSize) chunks.push(words.slice(index, index + chunkSize).join(" "));
  const cueDuration = Math.max(0.4, duration / chunks.length);
  return chunks.map((chunk, index) => ({
    start: index * cueDuration,
    end: Math.min(duration, (index + 1) * cueDuration),
    text: chunk,
  }));
}

function captionForceStyle(style = "bold", position = "bottom") {
  const positions = {
    bottom: "Alignment=2,MarginV=190",
    middle: "Alignment=5,MarginV=0",
    top: "Alignment=8,MarginV=140",
  };
  const styles = {
    bold: "FontName=Arial,FontSize=24,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=4,Shadow=0",
    clean: "FontName=Arial,FontSize=20,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0",
    karaoke: "FontName=Arial,FontSize=24,Bold=1,PrimaryColour=&H003CEFB8,OutlineColour=&H00000000,BorderStyle=1,Outline=4,Shadow=0",
    minimal: "FontName=Arial,FontSize=17,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0",
  };
  return `${styles[style] || styles.bold},${positions[position] || positions.bottom}`;
}

function writeCaptionSubtitle(destination, cues, style = "bold", position = "bottom") {
  const positions = {
    bottom: { alignment: 2, margin: 190 },
    middle: { alignment: 5, margin: 0 },
    top: { alignment: 8, margin: 140 },
  };
  const styles = {
    bold: { size: 54, bold: -1, primary: "&H00FFFFFF", outline: 7 },
    clean: { size: 46, bold: 0, primary: "&H00FFFFFF", outline: 5 },
    karaoke: { size: 54, bold: -1, primary: "&H003CEFB8", outline: 7 },
    minimal: { size: 40, bold: 0, primary: "&H00FFFFFF", outline: 4 },
  };
  const selectedPosition = positions[position] || positions.bottom;
  const selectedStyle = styles[style] || styles.bold;
  const events = cues
    .map((cue) => {
      const start = Math.max(0, Number(cue.start) || 0);
      const end = Math.max(start + 0.1, Number(cue.end) || start + 0.1);
      const text = escapeAssText(cue.text);
      return `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`;
    })
    .join("\n");
  fs.writeFileSync(destination, `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,${selectedStyle.size},${selectedStyle.primary},${selectedStyle.primary},&H00000000,&H00000000,${selectedStyle.bold},0,0,0,100,100,0,0,1,${selectedStyle.outline},0,${selectedPosition.alignment},90,90,${selectedPosition.margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`);
}

function appendExportWatermarks(filter, tempDir, {
  duration,
  customText,
  customPosition,
  brandRequired = true,
  prefix = "watermark",
}) {
  const creatorText = normalizeWatermarkText(customText);
  if (creatorText) {
    const creatorPath = path.join(tempDir, `${prefix}-creator.ass`);
    writeWatermarkSubtitle(creatorPath, creatorText, duration, customPosition, "creator");
    filter += watermarkFilter(creatorPath);
  }
  if (brandRequired) {
    const requestedPosition = normalizeOverlayPosition(customPosition);
    const brandPosition = requestedPosition === "top-left" ? "bottom-right" : "top-left";
    const brandPath = path.join(tempDir, `${prefix}-klippharma.ass`);
    writeWatermarkSubtitle(brandPath, "KP  •  KLIPPHARMA", duration, brandPosition, "brand");
    filter += watermarkFilter(brandPath);
  }
  return filter;
}

function appendMemeHeadline(filter, tempDir, clip, duration) {
  const headline = normalizeMemeHeadline(clip.memeHeadline);
  if (!headline) return filter;
  const subtitlePath = path.join(tempDir, "meme-headline.ass");
  writeMemeHeadlineSubtitle(subtitlePath, headline, duration, clip);
  return filter + watermarkFilter(subtitlePath);
}

function appendMemeImage(filter, clip, duration) {
  if (!clip.memeImagePath || !fs.existsSync(clip.memeImagePath)) return filter;
  const escapedPath = clip.memeImagePath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
  const template = normalizeMemeTemplate(clip.memeTemplate);
  const start = normalizeAudioSeconds(clip.memeStart, 0, duration);
  const end = Math.max(start + 0.1, normalizeAudioSeconds(clip.memeEnd, duration, duration));
  const layouts = {
    "split-top": {
      imageFilter: "scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,format=rgba",
      x: "0",
      y: "0",
    },
    "split-bottom": {
      imageFilter: "scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,format=rgba",
      x: "0",
      y: "H-h",
    },
    logo: {
      imageFilter: "scale=360:360:force_original_aspect_ratio=decrease,format=rgba",
      x: "W-w-54",
      y: "54",
    },
    headline: {
      imageFilter: "scale=420:420:force_original_aspect_ratio=decrease,format=rgba",
      x: "W-w-54",
      y: "54",
    },
  };
  const layout = layouts[template] || layouts.headline;
  return `movie='${escapedPath}',${layout.imageFilter}[memeimage];[in]${filter}[memebase];[memebase][memeimage]overlay=x='${layout.x}':y='${layout.y}':enable='between(t,${start.toFixed(2)},${end.toFixed(2)})':eof_action=repeat[out]`;
}

function writeMemeHeadlineSubtitle(destination, text, duration, clip) {
  const position = normalizeMemePosition(clip.memePosition);
  const alignments = { top: 8, middle: 5, bottom: 2 };
  const margins = { top: 125, middle: 0, bottom: 170 };
  const fontSizes = { small: 46, medium: 62, large: 78 };
  const fontSize = fontSizes[normalizeMemeFontSize(clip.memeFontSize)] || fontSizes.medium;
  const color = normalizeMemeTextColor(clip.memeTextColor);
  const boxColor = normalizeMemeBoxColor(clip.memeBoxColor);
  const background = normalizeMemeBackground(clip.memeBackground);
  const primary = cssHexToAss(color);
  const boxHex = boxColor === "white" ? "#ffffff" : "#000000";
  const back = background === "none" ? "&H00000000" : cssHexToAss(boxHex, background === "transparent" ? "66" : "00");
  const outlineColor = background === "none" ? "&H00000000" : back;
  const borderStyle = background === "none" ? 1 : 3;
  const outline = background === "none" ? 4 : 0;
  const safeText = escapeAssText(normalizeMemeHeadline(text));
  const start = normalizeAudioSeconds(clip.memeStart, 0, duration);
  const end = Math.max(start + 0.1, normalizeAudioSeconds(clip.memeEnd, duration, duration));
  fs.writeFileSync(destination, `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Meme,Arial,${fontSize},${primary},${primary},${outlineColor},${back},-1,0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignments[position]},65,65,${margins[position]},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${assTime(start)},${assTime(end)},Meme,,0,0,0,,${safeText}
`);
}

function escapeAssText(value) {
  return String(value || "")
    .replaceAll("\\", "＼")
    .replaceAll("{", "｛")
    .replaceAll("}", "｝")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\\N");
}

function watermarkFilter(watermarkPath) {
  const escapedPath = watermarkPath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
  return `,subtitles='${escapedPath}'`;
}

function writeWatermarkSubtitle(destination, text, duration, position = "top-right", kind = "creator") {
  const alignments = {
    "top-right": 9,
    "top-left": 7,
    "bottom-right": 3,
    "bottom-left": 1,
  };
  const alignment = alignments[position] || alignments["top-right"];
  const fontSize = kind === "brand" ? 25 : 32;
  const primaryColour = kind === "brand" ? "&H003CEFB8" : "&H00FFFFFF";
  const safeText = normalizeWatermarkText(text);
  const end = assTime(Math.max(0.5, duration));
  fs.writeFileSync(destination, `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Watermark,Arial,${fontSize},${primaryColour},${primaryColour},&H00000000,&H90000000,-1,0,0,0,100,100,0,0,3,1,0,${alignment},55,55,75,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Watermark,,0,0,0,,${safeText}
`);
}

function generatePreview(job) {
  if (previewTasks.has(job.id)) return previewTasks.get(job.id);
  const task = buildPreview(job).finally(() => previewTasks.delete(job.id));
  previewTasks.set(job.id, task);
  return task;
}

async function buildPreview(job) {
  const command = ffmpegPath || "ffmpeg";
  const previewName = `${job.id}-preview.mp4`;
  const previewPath = path.join(exportDir, previewName);
  if (job.previewStatus === "ready" && job.previewUrl && fs.existsSync(previewPath) && fs.statSync(previewPath).size > 1024) {
    Object.assign(job, {
      previewUrl: `/exports/${previewName}`,
      previewStatus: "ready",
      previewHasAudio: job.previewHasAudio !== false,
    });
    delete job.previewError;
    persistJob(job);
    return true;
  }

  job.previewStatus = "generating";
  delete job.previewError;
  persistJob(job);
  const videoSettings = [
    "-map", "0:v:0",
    "-vf", "scale=-2:720:force_original_aspect_ratio=decrease,setsar=1,fps=30",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-profile:v", "main",
    "-level:v", "4.0",
    "-tag:v", "avc1",
    "-preset", "veryfast",
    "-crf", "27",
    "-fps_mode", "cfr",
    "-video_track_timescale", "30000",
    "-sn", "-dn",
    "-max_muxing_queue_size", "1024",
    "-movflags", "+faststart",
  ];
  const attempts = [
    {
      hasAudio: true,
      args: [
        "-y", "-i", job.filePath,
        "-map", "0:v:0", "-map", "0:a:0?",
        ...videoSettings.slice(2),
        "-c:a", "aac", "-profile:a", "aac_low", "-ac", "2", "-ar", "48000", "-b:a", "128k",
        previewPath,
      ],
    },
    {
      hasAudio: false,
      args: [
        "-y", "-i", job.filePath,
        ...videoSettings,
        "-an",
        previewPath,
      ],
    },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      await run(command, attempt.args);
      if (!fs.existsSync(previewPath) || fs.statSync(previewPath).size <= 1024) throw new Error("FFmpeg created an empty preview.");
      Object.assign(job, {
        previewUrl: `/exports/${previewName}`,
        previewStatus: "ready",
        previewHasAudio: attempt.hasAudio,
      });
      delete job.previewError;
      persistJob(job);
      return true;
    } catch (error) {
      lastError = error;
      console.warn(`Preview attempt failed for ${job.originalName}:`, error.message);
    }
  }

  delete job.previewUrl;
  Object.assign(job, {
    previewStatus: "failed",
    previewError: "The source video was saved, but its preview could not be converted yet. Select Retry preview to try again.",
  });
  persistJob(job);
  console.error(`Preview generation failed for ${job.originalName}:`, lastError?.message || "Unknown conversion error");
  return false;
}

function isAudioOnly(filePath = "") {
  return new Set([".mp3", ".m4a", ".wav", ".aac", ".flac"]).has(path.extname(filePath).toLowerCase());
}

function mimeTypeFor(filePath = "") {
  const types = {
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
  };
  return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function normalizeCreatorMode(value = "auto") {
  return Object.hasOwn(creatorModes, value) ? value : "auto";
}

function normalizeClipLength(value = "smart") {
  if (value === "smart") return "smart";
  const seconds = Number(value);
  return new Set([15, 30, 45, 60, 90]).has(seconds) ? seconds : "smart";
}

function normalizeMontageLength(value = 30) {
  const seconds = Number(value);
  return new Set([15, 30, 45, 60, 90]).has(seconds) ? seconds : 30;
}

function normalizeMontageStyle(value = "fast") {
  return new Set(["fast", "story", "music", "promo"]).has(value) ? value : "fast";
}

function normalizeWatermarkText(value = "") {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f{}\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeMemeHeadline(value = "") {
  return String(value || "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f{}\\]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 240);
}

function normalizeMemeTemplate(value = "headline") {
  return new Set(["headline", "split-top", "split-bottom", "logo"]).has(value) ? value : "headline";
}

function normalizeMemePosition(value = "middle") {
  return new Set(["top", "middle", "bottom"]).has(value) ? value : "middle";
}

function normalizeMemeFontSize(value = "medium") {
  return new Set(["small", "medium", "large"]).has(value) ? value : "medium";
}

function normalizeMemeTextColor(value = "#ffffff") {
  const legacy = { white: "#ffffff", lime: "#b8ef3c", black: "#000000" };
  const color = legacy[String(value || "").toLowerCase()] || String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#ffffff";
}

function normalizeMemeBoxColor(value = "black") {
  return value === "white" ? "white" : "black";
}

function cssHexToAss(value, alpha = "00") {
  const color = normalizeMemeTextColor(value);
  const red = color.slice(1, 3);
  const green = color.slice(3, 5);
  const blue = color.slice(5, 7);
  return `&H${alpha}${blue}${green}${red}`.toUpperCase();
}

function normalizeMemeBackground(value = "solid") {
  return new Set(["solid", "transparent", "none"]).has(value) ? value : "solid";
}

function normalizeOverlayPosition(value = "top-right") {
  return new Set(["top-right", "top-left", "bottom-right", "bottom-left"]).has(value) ? value : "top-right";
}

function normalizePlanTier(value = "free") {
  const tier = String(value || "free").trim().toLowerCase();
  return new Set(["paid", "pro", "creator", "studio", "business"]).has(tier) ? tier : "free";
}

function hasPaidPlan(value) {
  return normalizePlanTier(value) !== "free";
}

function hasProBatchOutput(value) {
  return proFeaturesOpen || new Set(["pro", "studio", "business"]).has(normalizePlanTier(value));
}

function normalizeRequestedOutputCount(value, planTier) {
  if (!hasProBatchOutput(planTier)) return 8;
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) ? Math.min(10, Math.max(1, count)) : 5;
}

function hasCreativeAccess(value) {
  return proFeaturesOpen || new Set(["pro", "studio", "business"]).has(normalizePlanTier(value));
}

function userForClient(user) {
  if (!user) return null;
  const {
    stripeCustomerId: _stripeCustomerId,
    stripeSubscriptionId: _stripeSubscriptionId,
    stripePriceId: _stripePriceId,
    ...safeUser
  } = user;
  return { ...safeUser, creativeFeaturesOpen: hasCreativeAccess(user.planTier) };
}

async function handleStripeEvent(event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (!session.subscription) return;
    const subscription = await stripe.subscriptions.retrieve(
      typeof session.subscription === "string" ? session.subscription : session.subscription.id,
    );
    await syncSubscriptionRecord(subscription, session.client_reference_id || session.metadata?.klippharmaUserId);
    return;
  }
  if (new Set([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]).has(event.type)) {
    await syncSubscriptionRecord(event.data.object);
  }
}

async function syncSubscriptionRecord(subscription, fallbackUserId = null) {
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id || null;
  const item = subscription.items?.data?.[0] || null;
  const plan = billingPlanByPriceId(item?.price?.id);
  const currentPeriodEnd = subscription.current_period_end || item?.current_period_end || null;
  return syncStripeSubscription({
    userId: subscription.metadata?.klippharmaUserId || fallbackUserId || null,
    customerId,
    subscriptionId: subscription.id,
    priceId: item?.price?.id || null,
    planTier: plan?.tier || "free",
    status: subscription.status || "inactive",
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
}

function billingPlans() {
  return [
    {
      key: "creator_monthly", tier: "creator", name: "Creator", interval: "month",
      priceLabel: String(process.env.STRIPE_CREATOR_MONTHLY_PRICE_LABEL || process.env.STRIPE_PRO_PRICE_LABEL || "$29/month"),
      priceId: stripeCreatorMonthlyPriceId, headline: "Start publishing consistently",
    },
    {
      key: "creator_yearly", tier: "creator", name: "Creator Annual", interval: "year",
      priceLabel: String(process.env.STRIPE_CREATOR_YEARLY_PRICE_LABEL || "$290/year"),
      priceId: stripeCreatorYearlyPriceId, headline: "Two months free",
    },
    {
      key: "pro_monthly", tier: "pro", name: "Pro", interval: "month",
      priceLabel: String(process.env.STRIPE_PRO_MONTHLY_PRICE_LABEL || "$79/month"),
      priceId: stripeProMonthlyPriceId, headline: "Full creative studio",
    },
    {
      key: "pro_yearly", tier: "pro", name: "Pro Annual", interval: "year",
      priceLabel: String(process.env.STRIPE_PRO_YEARLY_PRICE_LABEL || "$790/year"),
      priceId: stripeProYearlyPriceId, headline: "Two months free",
    },
    {
      key: "business_monthly", tier: "business", name: "Business", interval: "month",
      priceLabel: String(process.env.STRIPE_BUSINESS_MONTHLY_PRICE_LABEL || "$199/month"),
      priceId: stripeBusinessMonthlyPriceId, headline: "Five-seat team workspace",
    },
    {
      key: "business_yearly", tier: "business", name: "Business Annual", interval: "year",
      priceLabel: String(process.env.STRIPE_BUSINESS_YEARLY_PRICE_LABEL || "$1,990/year"),
      priceId: stripeBusinessYearlyPriceId, headline: "Two months free · five seats",
    },
  ];
}

function billingPlanByKey(key) {
  return billingPlans().find((plan) => plan.key === String(key || "")) || null;
}

function billingPlanByPriceId(priceId) {
  return billingPlans().find((plan) => plan.priceId && plan.priceId === String(priceId || "")) || null;
}

function billingCatalogForClient() {
  return billingPlans().map(({ priceId, ...plan }) => ({
    ...plan,
    configured: Boolean(priceId),
    autoRenews: true,
    offer: plan.key === "pro_monthly"
      ? "Creator members receive 15% off their first Pro month."
      : plan.interval === "year" ? "Discounted annual billing." : null,
  }));
}

function subscriptionForClient(user) {
  const status = user?.subscriptionStatus || "inactive";
  const matchedPlan = billingPlanByPriceId(user?.stripePriceId);
  const planTier = matchedPlan?.tier || normalizePlanTier(user?.planTier);
  return {
    planTier,
    planKey: matchedPlan?.key || null,
    planName: matchedPlan?.name || (
      planTier === "free" ? "Free"
        : planTier === "creator" ? "Creator"
          : planTier === "business" ? "Business"
            : "Pro"
    ),
    interval: matchedPlan?.interval || null,
    priceLabel: matchedPlan?.priceLabel || null,
    status,
    active: new Set(["active", "trialing"]).has(status),
    currentPeriodEnd: user?.subscriptionCurrentPeriodEnd || null,
    cancelAtPeriodEnd: Boolean(user?.cancelAtPeriodEnd),
  };
}

function requireStripeBilling() {
  if (billingConfigured) return;
  const error = new Error("Secure recurring billing has not been configured yet.");
  error.statusCode = 503;
  throw error;
}

function billingFailure(res, error) {
  const status = Number(error?.statusCode || error?.status || 500);
  if (status >= 500) console.error("Billing request failed:", error);
  const message = status < 500
    ? error.message
    : "The secure billing service could not complete that request. Please try again.";
  res.status(status).json({ error: message });
}

function normalizeMixerPercent(value, fallback = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(150, Math.max(0, number))) : fallback;
}

function normalizeFocusX(value, fallback = 50) {
  const number = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 50;
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(number) ? number : safeFallback)) * 10) / 10;
}

function verticalCropFilter(focusX = 50, includeFps = false) {
  const normalized = normalizeFocusX(focusX) / 100;
  const fps = includeFps ? ",fps=30" : "";
  return `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:x='max(0,min(iw-ow,(iw-ow)*${normalized.toFixed(4)}))':y=0,setsar=1${fps}`;
}

function quickTimeVideoArgs(crf = "23") {
  return [
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level:v", "4.1",
    "-tag:v", "avc1",
    "-preset", "veryfast",
    "-crf", String(crf),
    "-fps_mode", "cfr",
    "-video_track_timescale", "30000",
  ];
}

function quickTimeAudioArgs(bitrate = "160k") {
  return ["-c:a", "aac", "-profile:a", "aac_low", "-ar", "48000", "-ac", "2", "-b:a", bitrate];
}

function normalizeAudioSeconds(value, fallback = 0, maximum = 90) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(maximum, Math.max(0, number)) * 10) / 10 : fallback;
}

function removeStoredMontageAudio(owner) {
  const stored = owner?.montageAudioPath ? path.resolve(owner.montageAudioPath) : "";
  if (stored && path.dirname(stored) === path.resolve(uploadDir) && fs.existsSync(stored)) fs.unlinkSync(stored);
  delete owner.montageAudioPath;
  delete owner.montageAudioName;
  delete owner.montageAudioMime;
}

function removeStoredClipAudio(clip) {
  const stored = clip?.audioPath ? path.resolve(clip.audioPath) : "";
  if (stored && path.dirname(stored) === path.resolve(uploadDir) && fs.existsSync(stored)) fs.unlinkSync(stored);
  delete clip.audioPath;
  delete clip.audioName;
  delete clip.audioMime;
}

function jobIsBusy(job) {
  return job.status === "queued"
    || job.status === "processing"
    || job.clips?.some((clip) => clip.renderStatus === "rendering")
    || job.montage?.status === "rendering";
}

async function deleteJobPermanently(job) {
  if (job.objectKey) await deleteObject(job.userId, job.objectKey);
  removeLocalFile(job.filePath, uploadDir);
  removeLocalFile(job.audioPath, uploadDir);
  removeLocalFile(job.montageAudioPath, uploadDir);
  for (const name of fs.readdirSync(uploadDir)) {
    if (name.startsWith(`${job.id}-audio-`)) removeLocalFile(path.join(uploadDir, name), uploadDir);
  }
  removeLocalFile(path.join(exportDir, `${job.id}-preview.mp4`), exportDir);
  for (const clip of job.clips || []) {
    removeLocalFile(path.join(exportDir, `${job.id}-${clip.id}.mp4`), exportDir);
    removeLocalFile(clip.memeImagePath, uploadDir);
    removeLocalFile(clip.audioPath, uploadDir);
  }
  if (job.montage) removeBatchMontageFiles(job.batchId || job.id);
  removeLocalFile(path.join(projectsDir, `${job.id}.json`), projectsDir);
  jobs.delete(job.id);
  await deleteDatabaseProject(job.id, job.userId);
}

function removeBatchMontageFiles(batchId) {
  const safeBatchId = String(batchId || "");
  if (!safeBatchId) return;
  removeLocalFile(path.join(exportDir, `${safeBatchId}-automix.mp4`), exportDir);
  for (const name of fs.readdirSync(exportDir)) {
    if (name.startsWith(`.${safeBatchId}-automix-`) && name.endsWith(".pending.mp4")) {
      removeLocalFile(path.join(exportDir, name), exportDir);
    }
  }
}

function removeLocalFile(filePath, allowedRoot) {
  if (!filePath) return;
  const root = path.resolve(allowedRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
  if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.unlinkSync(target);
}

function finalizeBatchOutputCount(batchId) {
  if (!batchId) return;
  const group = [...jobs.values()]
    .filter((job) => job.batchId === batchId)
    .sort((a, b) => Number(a.batchPosition || 0) - Number(b.batchPosition || 0));
  if (!group.length || group.some((job) => job.status === "queued" || job.status === "processing")) return;
  if (group.every((job) => job.batchOutputFinalized)) return;
  const owner = group[0];
  if (!owner.customOutputCountEnabled) {
    group.forEach((job) => {
      job.batchOutputFinalized = true;
      persistJob(job);
    });
    return;
  }

  const requested = Math.min(10, Math.max(1, Number(owner.requestedOutputCount) || 5));
  const candidates = group.flatMap((job) => (
    job.status === "ready" && job.processingMode === "ai"
      ? (job.clips || []).map((clip) => ({ job, clip }))
      : []
  ));
  const selected = candidates
    .sort((left, right) => Number(right.clip.overallScore || 0) - Number(left.clip.overallScore || 0))
    .slice(0, requested);
  const selectedKeys = new Set(selected.map(({ job, clip }) => `${job.id}:${clip.id}`));
  const rankByKey = new Map(selected.map(({ job, clip }, index) => [`${job.id}:${clip.id}`, index + 1]));

  group.forEach((job) => {
    if (job.status === "ready" && job.processingMode === "ai") {
      job.clips = (job.clips || [])
        .filter((clip) => selectedKeys.has(`${job.id}:${clip.id}`))
        .map((clip) => ({ ...clip, rank: rankByKey.get(`${job.id}:${clip.id}`) }));
      job.stage = `${job.clips.length} selected from this source · ${selected.length} of ${requested} batch klips ready`;
    }
    job.batchOutputFinalized = true;
    persistJob(job);
  });
}

function maybeStartBatchMontage(batchId) {
  if (!batchId || batchMontageTasks.has(batchId)) return;
  const group = [...jobs.values()]
    .filter((job) => job.batchId === batchId)
    .sort((a, b) => Number(a.batchPosition || 0) - Number(b.batchPosition || 0));
  const owner = group.find((job) => job.montage);
  if (!owner || owner.montage.status !== "waiting") return;
  if (group.some((job) => job.status === "queued" || job.status === "processing")) return;

  owner.montage.status = "rendering";
  owner.montage.progress = 2;
  persistJob(owner);
  const task = renderBatchMontage(group, owner)
    .catch((error) => {
      console.error("Auto-Mix failed:", error);
      owner.montage.status = "failed";
      owner.montage.progress = 100;
      owner.montage.error = friendlyError(error);
      persistJob(owner);
    })
    .finally(() => batchMontageTasks.delete(batchId));
  batchMontageTasks.set(batchId, task);
}

async function renderBatchMontage(group, owner, editedSegments = null, planTier = owner.planTier) {
  await Promise.all(group.map((job) => ensureLocalSource(job)));
  const command = ffmpegPath || "ffmpeg";
  const targetDuration = normalizeMontageLength(owner.montage.targetDuration);
  const style = normalizeMontageStyle(owner.montage.style);
  const selectedSegments = editedSegments?.length ? editedSegments : selectMontageSegments(group, targetDuration, style);
  const segments = selectedSegments.map((segment) => ({
    ...segment,
    captionText: typeof segment.captionText === "string"
      ? segment.captionText.trim().slice(0, 1000)
      : montageCaptionText(segment.job, segment.start, segment.start + segment.duration),
  }));
  if (!segments.length) throw new Error("Auto-Mix needs at least one completed video source with an editable moment.");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "klippharma-automix-"));
  const pendingOutputPath = path.join(exportDir, `.${owner.batchId}-automix-r${Number(owner.montage.revision || 1)}.pending.mp4`);
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const piecePath = path.join(tempDir, `piece-${String(index).padStart(3, "0")}.mp4`);
      let filter = verticalCropFilter(segment.focusX, true);
      if (owner.montage.captionsEnabled !== false && segment.captionText) {
        const captionPath = path.join(tempDir, `captions-${String(index).padStart(3, "0")}.ass`);
        const cues = captionCuesFromText(segment.captionText, segment.duration);
        writeCaptionSubtitle(captionPath, cues, owner.montage.captionStyle, owner.montage.captionPosition);
        filter += watermarkFilter(captionPath);
      }
      filter = appendExportWatermarks(filter, tempDir, {
        duration: segment.duration,
        customText: owner.watermarkText,
        customPosition: owner.watermarkPosition,
        brandRequired: !hasPaidPlan(planTier),
        prefix: `automix-${String(index).padStart(3, "0")}`,
      });
      const hasAudio = await probeHasAudio(command, segment.job.filePath);
      const dubPath = segment.job.audioTranslation === "dubbed"
        && segment.job.translationLanguage !== "original"
        && segment.captionText
        ? await synthesizeTranslatedVoice(segment.captionText, segment.job.dubVoice, tempDir, `automix-voice-${index}`)
        : null;
      const args = dubPath
        ? [
          "-y", "-fflags", "+genpts", "-ss", String(segment.start), "-i", segment.job.filePath, "-i", dubPath,
          "-t", String(segment.duration),
          "-filter_complex", hasAudio
            ? `[0:a]volume=0.16[bed];[1:a]volume=1,apad,atrim=0:${segment.duration}[voice];[bed][voice]amix=inputs=2:duration=first:normalize=0[a]`
            : `[1:a]volume=1,apad,atrim=0:${segment.duration}[a]`,
          "-map", "0:v:0", "-map", "[a]", "-vf", filter,
          ...quickTimeVideoArgs("23"), ...quickTimeAudioArgs("160k"),
          "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
          "-movflags", "+faststart", piecePath,
        ]
        : hasAudio
        ? [
          "-y", "-fflags", "+genpts", "-ss", String(segment.start), "-i", segment.job.filePath, "-t", String(segment.duration),
          "-map", "0:v:0", "-map", "0:a:0?", "-vf", filter,
          ...quickTimeVideoArgs("23"), ...quickTimeAudioArgs("160k"),
          "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
          "-movflags", "+faststart", piecePath,
        ]
        : [
          "-y", "-fflags", "+genpts", "-ss", String(segment.start), "-i", segment.job.filePath,
          "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(segment.duration),
          "-map", "0:v:0", "-map", "1:a:0", "-vf", filter,
          ...quickTimeVideoArgs("23"), ...quickTimeAudioArgs("160k"), "-shortest",
          "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
          "-movflags", "+faststart", piecePath,
        ];
      await run(command, args);
      owner.montage.progress = Math.round(((index + 1) / (segments.length + 1)) * 92);
      persistJob(owner);
    }

    const concatPath = path.join(tempDir, "concat.txt");
    fs.writeFileSync(concatPath, segments
      .map((_segment, index) => path.join(tempDir, `piece-${String(index).padStart(3, "0")}.mp4`))
      .map((item) => `file '${item.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`)
      .join("\n"));
    const outputName = `${owner.batchId}-automix.mp4`;
    const outputPath = path.join(exportDir, outputName);
    const duration = segments.reduce((sum, segment) => sum + segment.duration, 0);
    const sourceVolume = normalizeMixerPercent(owner.montage.sourceVolume, 100) / 100;
    const addedAudioVolume = normalizeMixerPercent(owner.montage.addedAudioVolume, 35) / 100;
    const hasAddedAudio = Boolean(owner.montageAudioPath && fs.existsSync(owner.montageAudioPath));
    if (!hasAddedAudio && sourceVolume === 1) {
      await run(command, [
        "-y", "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", concatPath,
        "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
        "-tag:v", "avc1", "-video_track_timescale", "30000",
        "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", pendingOutputPath,
      ]);
    } else {
      const assembledPath = path.join(tempDir, "assembled.mp4");
      await run(command, [
        "-y", "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", concatPath,
        "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
        "-tag:v", "avc1", "-video_track_timescale", "30000",
        "-avoid_negative_ts", "make_zero", assembledPath,
      ]);
      owner.montage.progress = 96;
      persistJob(owner);
      if (hasAddedAudio) {
        const audioStart = Math.min(Math.max(0, normalizeAudioSeconds(owner.montage.audioStart, 0, 90)), Math.max(0, duration - 0.1));
        const available = Math.max(0.1, duration - audioStart);
        const fadeIn = Math.min(normalizeAudioSeconds(owner.montage.audioFadeIn, 1, 10), available / 2);
        const fadeOut = Math.min(normalizeAudioSeconds(owner.montage.audioFadeOut, 1, 10), available / 2);
        const fadeOutStart = Math.max(0, available - fadeOut);
        const delay = Math.round(audioStart * 1000);
        const musicSteps = [
          "aformat=sample_rates=48000:channel_layouts=stereo",
          `volume=${addedAudioVolume}`,
          `atrim=0:${available}`,
          "asetpts=PTS-STARTPTS",
        ];
        if (fadeIn > 0.01) musicSteps.push(`afade=t=in:st=0:d=${fadeIn}`);
        if (fadeOut > 0.01) musicSteps.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
        if (delay > 0) musicSteps.push(`adelay=${delay}|${delay}`);
        let filterComplex;
        if (sourceVolume > 0 && owner.montage.autoDuck !== false) {
          filterComplex = `[0:a]volume=${sourceVolume},asplit=2[base][side];[1:a]${musicSteps.join(",")}[music];[music][side]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=500[ducked];[base][ducked]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[a]`;
        } else if (sourceVolume > 0) {
          filterComplex = `[0:a]volume=${sourceVolume}[base];[1:a]${musicSteps.join(",")}[music];[base][music]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[a]`;
        } else {
          filterComplex = `[1:a]${musicSteps.join(",")}[a]`;
        }
        const audioInputArgs = owner.montage.audioLoop === false
          ? ["-i", owner.montageAudioPath]
          : ["-stream_loop", "-1", "-i", owner.montageAudioPath];
        await run(command, [
          "-y", "-i", assembledPath, ...audioInputArgs,
          "-filter_complex", filterComplex,
          "-map", "0:v:0", "-map", "[a]", "-t", String(duration),
          "-c:v", "copy", "-tag:v", "avc1", "-video_track_timescale", "30000",
          ...quickTimeAudioArgs("192k"),
          "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", pendingOutputPath,
        ]);
      } else {
        await run(command, [
          "-y", "-i", assembledPath, "-filter_complex", `[0:a]volume=${sourceVolume}[a]`,
          "-map", "0:v:0", "-map", "[a]",
          "-c:v", "copy", "-tag:v", "avc1", "-video_track_timescale", "30000",
          ...quickTimeAudioArgs("192k"),
          "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", pendingOutputPath,
        ]);
      }
    }
    fs.renameSync(pendingOutputPath, outputPath);
    Object.assign(owner.montage, {
      status: "ready",
      progress: 100,
      title: `Batch Auto-Mix · ${montageStyleLabel(style)}`,
      duration: Math.round(duration * 10) / 10,
      sourceCount: new Set(segments.map((segment) => segment.job.id)).size,
      segments: segments.map((segment) => ({
        sourceId: segment.job.id,
        sourceName: segment.job.originalName,
        sourceDuration: Math.round(Number(segment.job.duration || 0) * 100) / 100,
        start: Math.round(segment.start * 100) / 100,
        end: Math.round((segment.start + segment.duration) * 100) / 100,
        captionText: segment.captionText,
        focusX: normalizeFocusX(segment.focusX),
      })),
      downloadUrl: `/exports/${outputName}?v=${Number(owner.montage.revision || 1)}`,
    });
    delete owner.montage.error;
    persistJob(owner);
  } finally {
    if (fs.existsSync(pendingOutputPath)) fs.unlinkSync(pendingOutputPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function hydrateMontageSegments(group, requested) {
  if (!Array.isArray(requested) || !requested.length) throw new Error("Keep at least one moment in the Auto-Mix.");
  if (requested.length > 80) throw new Error("An Auto-Mix can contain no more than 80 moments.");
  const byId = new Map(group.map((job) => [job.id, job]));
  const hydrated = requested.map((item) => {
    const job = byId.get(String(item.sourceId || ""));
    if (!job || job.status !== "ready" || isAudioOnly(job.filePath) || !fs.existsSync(job.filePath)) {
      throw new Error("One selected source is no longer available.");
    }
    const start = Number(item.start);
    const end = Number(item.end);
    const sourceDuration = Number(job.duration || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > sourceDuration + 0.05) {
      throw new Error(`Choose valid start and end times for ${job.originalName}.`);
    }
    if (end - start < 0.75) throw new Error("Every Auto-Mix moment must be at least 0.75 seconds.");
    return {
      job,
      start: Math.round(start * 100) / 100,
      duration: Math.round((end - start) * 100) / 100,
      captionText: String(item.captionText || "").trim().slice(0, 1000),
      focusX: normalizeFocusX(item.focusX),
    };
  });
  const duration = hydrated.reduce((sum, segment) => sum + segment.duration, 0);
  if (duration > 90.05) throw new Error("The final Auto-Mix can be no longer than 90 seconds.");
  return hydrated;
}

function montageCaptionText(job, start, end) {
  return (job.segments || [])
    .filter((segment) => Number(segment.end) > start && Number(segment.start) < end)
    .map((segment) => String(segment.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);
}

function normalizeSourceLanguage(value) {
  const key = String(value || "auto").trim().toLowerCase();
  return supportedLanguages[key] ? key : "auto";
}

function normalizeTranslationLanguage(value) {
  const key = String(value || "original").trim().toLowerCase();
  return key === "original" || (key !== "auto" && supportedLanguages[key]) ? key : "original";
}

function normalizeAudioTranslation(value, translationLanguage = "original") {
  return value === "dubbed" && normalizeTranslationLanguage(translationLanguage) !== "original" ? "dubbed" : "original";
}

function normalizeDubVoice(value) {
  const voice = String(value || "alloy").trim().toLowerCase();
  return supportedDubVoices.has(voice) ? voice : "alloy";
}

function normalizeDetectedLanguage(value) {
  const language = String(value || "auto").trim().toLowerCase();
  return supportedLanguages[language] ? language : language.slice(0, 40) || "auto";
}

function languageLabel(value) {
  return supportedLanguages[value]?.label || String(value || "Original");
}

function selectMontageSegments(group, targetDuration, style) {
  const pieceDuration = { fast: 3.5, story: 8, music: 4.5, promo: 6 }[style] || 3.5;
  const queues = group
    .filter((job) => job.status === "ready" && !isAudioOnly(job.filePath) && fs.existsSync(job.filePath))
    .map((job) => {
      const clips = (job.clips?.length ? [...job.clips] : [{ start: 0, end: job.duration }])
        .sort((a, b) => Number(b.overallScore || 0) - Number(a.overallScore || 0));
      const queue = [];
      for (const clip of clips) {
        let cursor = Math.max(0, Number(clip.start) || 0);
        const end = Math.min(Number(job.duration || Infinity), Number(clip.end) || 0);
        let piecesFromClip = 0;
        while (end - cursor >= 1.25 && piecesFromClip < 12) {
          const duration = Math.min(pieceDuration, end - cursor);
          queue.push({ job, start: cursor, duration, focusX: normalizeFocusX(clip.focusX) });
          cursor += duration;
          piecesFromClip += 1;
        }
      }
      return queue;
    })
    .filter((queue) => queue.length);

  const selected = [];
  let remaining = targetDuration;
  while (remaining >= 0.75 && queues.some((queue) => queue.length)) {
    let progressed = false;
    for (const queue of queues) {
      if (remaining < 0.75) break;
      const candidate = queue.shift();
      if (!candidate) continue;
      const duration = Math.min(candidate.duration, remaining);
      if (duration < 0.75) continue;
      selected.push({ ...candidate, duration });
      remaining -= duration;
      progressed = true;
    }
    if (!progressed) break;
  }
  return selected;
}

function montageStyleLabel(style) {
  return { fast: "Fast & Punchy", story: "Smooth Story", music: "Music Energy", promo: "Clean Promo" }[style] || "Fast & Punchy";
}

function persistJob(job, options = {}) {
  try {
    const destination = path.join(projectsDir, `${job.id}.json`);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(job));
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.error(`Could not persist project ${job.id}:`, error.message);
  }
  return saveDatabaseProject(job).catch((error) => {
    console.error(`Could not save project ${job.id} to PostgreSQL:`, error.message);
    if (options.requireDatabase) throw error;
  });
}

async function persistUploadSession(session, options = {}) {
  try {
    const destination = path.join(uploadSessionsDir, `${session.id}.json`);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(session));
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.error(`Could not persist upload session ${session.id}:`, error.message);
  }
  try {
    await saveDatabaseUploadSession(session);
  } catch (error) {
    console.error(`Could not save upload session ${session.id} to PostgreSQL:`, error.message);
    if (options.requireDatabase || isProductionPersistenceRequired()) throw error;
  }
}

function loadPersistedUploadSessions() {
  for (const name of fs.readdirSync(uploadSessionsDir).filter((item) => item.endsWith(".json"))) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(uploadSessionsDir, name), "utf8"));
      restoreInterruptedUploadSession(session);
      uploadSessions.set(session.id, session);
      void persistUploadSession(session);
    } catch (error) {
      console.error(`Could not restore upload session ${name}:`, error.message);
    }
  }
}

async function loadPostgresUploadSessions() {
  const sessions = await loadDatabaseUploadSessions();
  for (const session of sessions) {
    restoreInterruptedUploadSession(session);
    uploadSessions.set(session.id, session);
    void persistUploadSession(session);
  }
}

async function cleanupAbandonedUploadSessions() {
  const cutoff = Date.now() - uploadSessionTtlMs;
  for (const session of uploadSessions.values()) {
    const updatedAt = Date.parse(session.updatedAt || session.createdAt || "");
    if (!Number.isFinite(updatedAt) || updatedAt > cutoff) continue;
    if (!["preparing", "ready_to_upload", "uploading", "paused", "interrupted", "failed", "cancelled"].includes(session.status)) continue;
    for (const file of session.files || []) {
      if (file.projectId || !file.objectKey || !file.uploadId || file.status === "queued_for_processing") continue;
      try {
        await abortMultipartUpload(session.userId, { objectKey: file.objectKey, uploadId: file.uploadId });
      } catch (error) {
        console.error(`Could not abort abandoned upload ${session.id}/${file.id}:`, error.message);
      }
      file.status = "cancelled";
      file.error = "Upload session expired before the source finished transferring.";
    }
    session.status = "cancelled";
    await persistUploadSession(session);
  }
}

function restoreInterruptedUploadSession(session) {
  if (!session?.id || !Array.isArray(session.files)) return;
  for (const file of session.files) {
    if (file.status === "uploading" || file.status === "ready_to_upload" || file.status === "preparing") {
      file.status = file.completedParts?.length ? "interrupted" : "ready_to_upload";
      file.error = "Upload interrupted — reconnect to resume.";
    }
  }
  refreshSessionStatus(session);
}

function canAccessUploadSession(req, session) {
  return canAccessUploadSessionRecord(req.user, req.team, session);
}

async function ownedUploadSession(req, sessionId) {
  let session = uploadSessions.get(String(sessionId || ""));
  if (!session && databaseConfigured) {
    session = await loadDatabaseUploadSession(String(sessionId || ""));
    if (session?.id) uploadSessions.set(session.id, session);
  }
  return canAccessUploadSession(req, session) ? session : null;
}

function isProductionPersistenceRequired() {
  return databaseConfigured && authMode === "required";
}

async function ensureProductionUploadPersistence() {
  if (!isProductionPersistenceRequired()) return;
  await assertUploadSessionSchemaReady();
}

function isSupportedStoredMedia(file, stored) {
  const type = String(stored?.type || file?.type || "");
  return !type || type === "application/octet-stream" || uploadLimits.mimePrefixes.some((prefix) => type.startsWith(prefix));
}

function loadPersistedJobs() {
  for (const name of fs.readdirSync(projectsDir).filter((item) => item.endsWith(".json"))) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(projectsDir, name), "utf8"));
      if (!job?.id) continue;
      job.userId ||= "local-owner";
      restoreInterruptedProject(job);
      jobs.set(job.id, job);
      persistJob(job);
    } catch (error) {
      console.error(`Could not restore ${name}:`, error.message);
    }
  }
}

async function loadPostgresJobs() {
  const projects = await loadDatabaseProjects();
  for (const job of projects) {
    restoreInterruptedProject(job);
    jobs.set(job.id, job);
    persistJob(job);
  }
}

function restoreInterruptedProject(job) {
  if (job.status === "queued" || job.status === "processing") {
    const sourceCanRecover = Boolean(job.objectKey || (job.filePath && fs.existsSync(job.filePath)));
    if (sourceCanRecover) {
      Object.assign(job, {
        status: "queued",
        progress: 2,
        phase: "queued",
        stage: "Recovered after restart · waiting for the processor",
        resumeAfterRestart: true,
      });
      delete job.error;
    } else {
      Object.assign(job, {
        status: "failed",
        progress: Math.min(95, Math.max(2, Number(job.progress || 2))),
        phase: "failed",
        stage: "Processing was interrupted",
        error: "This project was interrupted and its source is no longer available. Upload the source again to restart processing.",
        failedAt: new Date().toISOString(),
      });
    }
  }
  for (const clip of job.clips || []) {
    if (clip.renderStatus === "rendering") {
      clip.renderStatus = "idle";
      clip.renderError = "The last render was interrupted. Select Create vertical clip to restart it.";
    }
  }
  if (job.montage && (job.montage.status === "waiting" || job.montage.status === "rendering")) {
    job.montage.status = "failed";
    job.montage.progress = 100;
    job.montage.error = "Auto-Mix was interrupted by a server restart. Your individual klips are still available.";
  }
}

function resumePersistedProjects() {
  const recovered = [...jobs.values()]
    .filter((job) => job.resumeAfterRestart)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const job of recovered) {
    delete job.resumeAfterRestart;
    persistJob(job);
    enqueueProject(job);
  }
  const waitingBatches = new Set([...jobs.values()].filter((job) => job.montage?.status === "waiting").map((job) => job.batchId));
  const completedBatches = new Set([...jobs.values()].map((job) => job.batchId).filter(Boolean));
  for (const batchId of completedBatches) finalizeBatchOutputCount(batchId);
  for (const batchId of waitingBatches) maybeStartBatchMontage(batchId);
}

async function attachUser(req, res, next) {
  try {
    if (authMode === "off") {
      req.user = {
        id: "local-owner",
        email: "local@klippharma.test",
        local: true,
        planTier: normalizePlanTier(process.env.LOCAL_PLAN || "free"),
      };
      return next();
    }
    req.user = await findSessionUser(readCookie(req, "klippharma_session"));
    if (req.user) {
      req.team = await getWorkspaceContext(req.user.id);
      if (req.team?.businessActive) {
        req.user.planTier = "business";
        req.user.workspaceRole = req.team.role;
        req.user.workspaceId = req.team.id;
      }
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireUser(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: "Sign in to continue." });
}

function ownedJob(req, id) {
  const job = jobs.get(id);
  return canAccessJob(req, job) ? job : null;
}

function canAccessJob(req, job) {
  if (!job || !req.user) return false;
  if (job.userId === req.user.id) return true;
  if (
    isKlipdoseProject(job) &&
    job.userId === "local-owner" &&
    process.env.KLIPDOSE_PROJECT_OWNER_ID &&
    req.user.id === process.env.KLIPDOSE_PROJECT_OWNER_ID
  ) return true;
  return Boolean(req.team?.businessActive && req.team.memberIds?.includes(job.userId));
}

function requireWorkspaceEditor(req, res, next) {
  if (new Set(["GET", "HEAD", "OPTIONS"]).has(req.method)) return next();
  if (!req.team?.businessActive || new Set(["owner", "admin", "editor"]).has(req.team.role)) return next();
  return res.status(403).json({ error: "Viewers can review shared projects but cannot change them." });
}

function requireTeamAdmin(req) {
  if (!req.team?.businessActive) {
    const error = new Error("A Business subscription is required for team management.");
    error.status = 403;
    throw error;
  }
  if (!new Set(["owner", "admin"]).has(req.team.role)) {
    const error = new Error("Only workspace owners and admins can manage the team.");
    error.status = 403;
    throw error;
  }
}

async function billingAccountForRequest(req) {
  if (req.user.id === "local-owner") return req.user;
  if (req.team?.businessActive && req.team.owner) return req.team.owner;
  return findUserById(req.user.id);
}

function workspaceForClient(team) {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    role: team.role,
    ownerUserId: team.ownerUserId,
    businessActive: team.businessActive,
    memberCount: team.memberCount,
    seatLimit: team.seatLimit,
    canManageTeam: new Set(["owner", "admin"]).has(team.role),
    canManageBilling: team.role === "owner",
    members: team.members,
  };
}

function authorizeExport(req, res, next) {
  const filename = path.basename(req.path);
  const allowed = [...jobs.values()].some((job) => (
    canAccessJob(req, job) && (filename.startsWith(`${job.id}-`) || filename.startsWith(`${job.batchId}-`))
  ));
  if (!allowed) return res.status(404).json({ error: "Export not found." });
  return next();
}

function readCookie(req, name) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function setSessionCookie(res, session) {
  res.cookie("klippharma_session", session.token, { ...sessionCookieOptions(), expires: session.expiresAt });
}

function authRateLimit(req, res, next) {
  const now = Date.now();
  const key = `${req.ip}:${String(req.body?.email || "").trim().toLowerCase()}`;
  const attempt = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (attempt.resetAt <= now) {
    attempt.count = 0;
    attempt.resetAt = now + 15 * 60 * 1000;
  }
  attempt.count += 1;
  authAttempts.set(key, attempt);
  if (attempt.count > 12) return res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
  return next();
}

function authFailure(res, error) {
  const status = error instanceof AuthError ? error.status : 500;
  if (status >= 500) console.error("Authentication error:", error);
  res.status(status).json({ error: status >= 500 ? "Account service is temporarily unavailable." : error.message });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-5000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr}`)));
  });
}

function probeDuration(command, inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["-i", inputPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-30000); });
    child.on("error", reject);
    child.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (!match) return reject(new Error("Could not read media duration."));
      resolve((Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]));
    });
  });
}

function probeHasAudio(command, inputPath) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-i", inputPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-30000); });
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(/Stream\s+#.*Audio:/.test(stderr)));
  });
}


function probeHasVideo(command, inputPath) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-i", inputPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-30000); });
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(/Stream\s+#.*Video:/.test(stderr)));
  });
}

function friendlyError(error) {
  if (error?.status === 429) return "The API account needs billing or has reached its usage limit.";
  if (error?.status === 401) return "The API key could not be authenticated.";
  if (error?.code === "ENOENT" && String(error?.message).includes("ffmpeg")) return "FFmpeg is required to process video files. Install it with: brew install ffmpeg";
  if (String(error?.message).toLowerCase().includes("invalid file format")) return "This video container could not be converted. Try MP4, MOV, WebM, or M4V.";
  if (String(error?.message).includes("Maximum content size")) return "The extracted audio section is too large to transcribe.";
  return error?.message || "Something went wrong while processing the video.";
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  return `${min}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.floor(seconds * 100));
  const h = Math.floor(centiseconds / 360000);
  const m = Math.floor((centiseconds % 360000) / 6000);
  const s = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function requireTikTokConfig(req = null) {
  const clientKey = String(process.env.TIKTOK_CLIENT_KEY || "").trim();
  const clientSecret = String(process.env.TIKTOK_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.TIKTOK_REDIRECT_URI || `${tiktokReturnOrigin(req)}/api/integrations/tiktok/oauth/callback`).trim();
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new AuthError("TikTok Login Kit needs TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI.", 503);
  }
  return { clientKey, clientSecret, redirectUri };
}

function tiktokReturnOrigin(req = null) {
  return integrationReturnOrigin(req);
}

function integrationReturnOrigin(req = null) {
  if (isProductionRuntime()) return productionAppOrigin;
  const configured = normalizeOrigin(process.env.APP_BASE_URL);
  if (configured) return configured;
  return requestOrigin(req) || appBaseUrl;
}

function isProductionRuntime() {
  const railwayEnvironment = String(process.env.RAILWAY_ENVIRONMENT || "").trim().toLowerCase();
  return process.env.NODE_ENV === "production"
    || railwayEnvironment === "production"
    || Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
}

function requestOrigin(req) {
  if (!req) return null;
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  if (!host) return null;
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  return normalizeOrigin(`${proto}://${host}`);
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeTikTokScopes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return [...new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function requireYouTubeConfig(req = null) {
  const clientId = String(process.env.YOUTUBE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.YOUTUBE_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.YOUTUBE_REDIRECT_URI || `${integrationReturnOrigin(req)}/api/integrations/youtube/oauth/callback`).trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new AuthError("YouTube OAuth needs YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI.", 503);
  }
  return { clientId, clientSecret, redirectUri };
}

function normalizeYouTubeScopes(value) {
  const required = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ];
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  const scopes = raw.map((scope) => String(scope || "").trim()).filter(Boolean);
  return [...new Set(scopes.length ? scopes : required)];
}

async function exchangeYouTubeCode(code, req = null) {
  const config = requireYouTubeConfig(req);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new AuthError(data.error_description || data.error || "YouTube token exchange failed.", response.status || 400);
  }
  return data;
}

async function refreshYouTubeToken(refreshToken) {
  const config = requireYouTubeConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new AuthError(data.error_description || data.error || "YouTube token refresh failed. Reconnect YouTube.", response.status || 401);
  }
  return data;
}

async function revokeGoogleToken(accessToken) {
  const url = new URL("https://oauth2.googleapis.com/revoke");
  url.searchParams.set("token", accessToken);
  await fetch(url, { method: "POST" });
}

async function youtubeApi(pathname, { method = "GET", token, body = null, headers = {} } = {}) {
  const response = await fetch(`https://www.googleapis.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data.error?.message || data.error_description || "YouTube API request failed.";
    throw new AuthError(message, response.status || 400);
  }
  return data;
}

async function fetchYouTubeChannel(accessToken) {
  const data = await youtubeApi("/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true", { token: accessToken });
  const channel = data.items?.[0];
  if (!channel) throw new AuthError("No YouTube channel was found for this Google account.", 404);
  const snippet = channel.snippet || {};
  const stats = channel.statistics || {};
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads || null;
  const customUrl = snippet.customUrl || null;
  return {
    id: channel.id,
    title: snippet.title || "YouTube channel",
    description: snippet.description || "",
    handle: customUrl || null,
    avatarUrl: safeTikTokUrl(snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url),
    channelUrl: channel.id ? `https://www.youtube.com/channel/${channel.id}` : null,
    uploadsPlaylistId,
    stats: {
      subscribers: stats.hiddenSubscriberCount ? null : safeCount(stats.subscriberCount),
      hiddenSubscribers: stats.hiddenSubscriberCount === true,
      views: safeCount(stats.viewCount),
      videos: safeCount(stats.videoCount),
    },
  };
}

async function fetchRecentYouTubeVideos(accessToken, uploadsPlaylistId) {
  if (!uploadsPlaylistId) return { videos: [] };
  const playlist = await youtubeApi(`/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=6`, { token: accessToken });
  const ids = (playlist.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return { videos: [] };
  const videos = await youtubeApi(`/youtube/v3/videos?part=snippet,contentDetails,statistics,status&id=${encodeURIComponent(ids.join(","))}`, { token: accessToken });
  const byId = new Map((videos.items || []).map((video) => [video.id, video]));
  return {
    videos: ids.map((id) => byId.get(id)).filter(Boolean).map(youtubeVideoForClient),
    nextPageToken: playlist.nextPageToken || null,
  };
}

function youtubeVideoForClient(video) {
  const snippet = video.snippet || {};
  const stats = video.statistics || {};
  return {
    id: video.id,
    title: snippet.title || "YouTube video",
    description: snippet.description || "",
    publishedAt: snippet.publishedAt || null,
    duration: video.contentDetails?.duration || "",
    thumbnailUrl: safeTikTokUrl(snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url),
    views: safeCount(stats.viewCount),
    likes: safeCount(stats.likeCount),
    comments: safeCount(stats.commentCount),
    url: video.id ? `https://www.youtube.com/watch?v=${video.id}` : null,
    privacyStatus: video.status?.privacyStatus || null,
    uploadStatus: video.status?.uploadStatus || null,
  };
}

async function getYouTubeConnectionForRequest(req) {
  if (req.user.id === "local-owner") return localSocialConnections.get(socialKey(req, "youtube")) || null;
  return getSocialConnection(req.user.id, "youtube");
}

async function saveYouTubeConnectionForRequest(req, connection) {
  if (req.user.id === "local-owner") {
    const stored = {
      userId: req.user.id,
      provider: "youtube",
      workspaceId: req.team?.id || null,
      ...connection,
      scopes: normalizeYouTubeScopes(connection.scopes),
      connectedAt: connection.connectedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localSocialConnections.set(socialKey(req, "youtube"), stored);
    return stored;
  }
  return upsertSocialConnection({
    userId: req.user.id,
    provider: "youtube",
    workspaceId: req.team?.id || null,
    ...connection,
  });
}

async function deleteYouTubeConnectionForRequest(req) {
  if (req.user.id === "local-owner") return localSocialConnections.delete(socialKey(req, "youtube"));
  return deleteSocialConnection(req.user.id, "youtube");
}

async function requireYouTubeConnection(req, scope = null) {
  const connection = await getYouTubeConnectionForRequest(req);
  if (!connection?.accessToken) throw new AuthError("Connect YouTube in Settings > Integrations first.", 409);
  if (scope && !normalizeYouTubeScopes(connection.scopes).includes(scope)) {
    throw new AuthError(`Reconnect YouTube and approve the ${scope} permission to use this action.`, 403);
  }
  return connection;
}

async function ensureYouTubeAccessToken(req, connection) {
  const expiresAt = connection.accessTokenExpiresAt || connection.access_token_expires_at;
  if (connection.accessToken && (!expiresAt || new Date(expiresAt).getTime() > Date.now() + 60_000)) return connection;
  if (!connection.refreshToken) throw new AuthError("Reconnect YouTube to restore offline upload access.", 401);
  const token = await refreshYouTubeToken(connection.refreshToken);
  return saveYouTubeConnectionForRequest(req, {
    providerUserId: connection.providerUserId,
    profile: connection.profile || {},
    scopes: normalizeYouTubeScopes(token.scope || connection.scopes),
    accessToken: token.access_token,
    refreshToken: token.refresh_token || connection.refreshToken,
    accessTokenExpiresAt: secondsFromNow(token.expires_in),
    refreshTokenExpiresAt: null,
  });
}

function youtubeConnectionForClient(connection) {
  if (!connection) {
    return {
      connected: false,
      configured: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      scopes: [],
    };
  }
  const profile = connection.profile || {};
  return {
    connected: true,
    configured: true,
    provider: "youtube",
    channel: {
      id: profile.id || connection.providerUserId || null,
      title: profile.title || "YouTube channel",
      handle: profile.handle || null,
      description: profile.description || "",
      avatarUrl: safeTikTokUrl(profile.avatarUrl),
      channelUrl: safeTikTokUrl(profile.channelUrl),
    },
    stats: profile.stats || null,
    scopes: normalizeYouTubeScopes(connection.scopes),
    connectedAt: connection.connectedAt || connection.connected_at || null,
    updatedAt: connection.updatedAt || connection.updated_at || null,
  };
}

async function submitYouTubeVideo({ accessToken, target, metadata }) {
  if (metadata.youtubeConsentAccepted !== true) {
    throw new AuthError("Confirm the YouTube upload settings before uploading.", 400);
  }
  const stats = fs.statSync(target.path);
  const privacyStatus = normalizeYouTubePrivacy(metadata.privacyStatus);
  const videoResource = {
    snippet: {
      title: String(metadata.title || target.title || "KlipPharma upload").slice(0, 100),
      description: String(metadata.description || "").slice(0, 5000),
      tags: normalizeYouTubeTags(metadata.tags),
      categoryId: String(metadata.categoryId || "22"),
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: metadata.madeForKids === true,
    },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,contentDetails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "Content-Length": String(Buffer.byteLength(JSON.stringify(videoResource))),
      "X-Upload-Content-Length": String(stats.size),
      "X-Upload-Content-Type": target.mimeType || "video/mp4",
    },
    body: JSON.stringify(videoResource),
  });
  const uploadUrl = init.headers.get("location");
  if (!init.ok || !uploadUrl) {
    const data = await init.json().catch(() => ({}));
    throw new AuthError(data.error?.message || "YouTube did not return an upload session.", init.status || 502);
  }
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": String(stats.size),
      "Content-Type": target.mimeType || "video/mp4",
    },
    body: fs.createReadStream(target.path),
    duplex: "half",
  });
  const data = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new AuthError(data.error?.message || `YouTube upload failed with HTTP ${upload.status}.`, upload.status || 502);
  const videoId = data.id;
  const returnedPrivacy = data.status?.privacyStatus || privacyStatus;
  return {
    ok: true,
    provider: "youtube",
    videoId,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
    status: data.status?.uploadStatus || "uploaded",
    privacyStatus: returnedPrivacy,
    message: returnedPrivacy === "private"
      ? "Private YouTube upload started. Google may require app verification before public uploads are allowed."
      : "YouTube upload started. Processing status will update here.",
  };
}

function normalizeYouTubePrivacy(value) {
  return new Set(["private", "unlisted", "public"]).has(String(value || "").toLowerCase())
    ? String(value).toLowerCase()
    : "private";
}

function normalizeYouTubeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 20);
}

async function fetchYouTubeVideoStatus(accessToken, videoId) {
  const data = await youtubeApi(`/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, { token: accessToken });
  const video = data.items?.[0] || {};
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    status: video.status || null,
    processingDetails: video.processingDetails || null,
  };
}

async function exchangeTikTokCode(code, req = null) {
  const config = requireTikTokConfig(req);
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new AuthError(data.error_description || data.message || data.error || "TikTok token exchange failed.", response.status || 400);
  }
  return data;
}

async function revokeTikTokToken(accessToken) {
  const config = requireTikTokConfig();
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    token: accessToken,
  });
  await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function fetchTikTokUserProfile(accessToken, scopes = []) {
  const fields = tiktokProfileFieldsForScopes(scopes);
  const data = await tiktokApi(`/v2/user/info/?fields=${encodeURIComponent(fields.join(","))}`, {
    method: "GET",
    token: accessToken,
  });
  return data.data?.user || {};
}

function tiktokProfileFieldsForScopes(scopes = []) {
  const granted = new Set(normalizeTikTokScopes(scopes));
  const fields = ["open_id", "avatar_url", "avatar_url_100", "avatar_large_url", "display_name"];
  if (granted.has("user.info.profile")) {
    fields.push("username", "bio_description", "profile_deep_link", "is_verified");
  }
  if (granted.has("user.info.stats")) {
    fields.push("follower_count", "following_count", "likes_count", "video_count");
  }
  return fields;
}

async function fetchTikTokVideos(accessToken) {
  const fields = [
    "id",
    "create_time",
    "cover_image_url",
    "share_url",
    "video_description",
    "duration",
    "title",
    "like_count",
    "comment_count",
    "share_count",
    "view_count",
  ];
  const data = await tiktokApi(`/v2/video/list/?fields=${encodeURIComponent(fields.join(","))}`, {
    method: "POST",
    token: accessToken,
    body: { max_count: 6 },
  });
  return {
    videos: (data.data?.videos || []).map(tiktokVideoForClient),
    cursor: data.data?.cursor || null,
    hasMore: Boolean(data.data?.has_more),
  };
}

async function tiktokApi(pathname, { method = "GET", token, body = null } = {}) {
  const response = await fetch(`https://open.tiktokapis.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method !== "GET" ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
    },
    body: method !== "GET" ? JSON.stringify(body || {}) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.error && data.error.code && data.error.code !== "ok")) {
    const message = data.error?.message || data.message || data.error?.code || "TikTok API request failed.";
    throw new AuthError(message, response.status || 400);
  }
  return data;
}

function secondsFromNow(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

function socialKey(req) {
  return `${req.user.id}:tiktok`;
}

async function getTikTokConnectionForRequest(req) {
  if (req.user.id === "local-owner") return localSocialConnections.get(socialKey(req)) || null;
  return getSocialConnection(req.user.id, "tiktok");
}

async function saveTikTokConnectionForRequest(req, connection) {
  if (req.user.id === "local-owner") {
    const stored = {
      userId: req.user.id,
      provider: "tiktok",
      workspaceId: req.team?.id || null,
      ...connection,
      scopes: normalizeTikTokScopes(connection.scopes),
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localSocialConnections.set(socialKey(req), stored);
    return stored;
  }
  return upsertSocialConnection({
    userId: req.user.id,
    provider: "tiktok",
    workspaceId: req.team?.id || null,
    ...connection,
  });
}

async function deleteTikTokConnectionForRequest(req) {
  if (req.user.id === "local-owner") return localSocialConnections.delete(socialKey(req));
  return deleteSocialConnection(req.user.id, "tiktok");
}

async function requireTikTokConnection(req, scope = null) {
  const connection = await getTikTokConnectionForRequest(req);
  if (!connection?.accessToken) throw new AuthError("Connect TikTok in Settings > Integrations first.", 409);
  if (scope && !normalizeTikTokScopes(connection.scopes).includes(scope)) {
    throw new AuthError(`Reconnect TikTok and approve the ${scope} permission to use this action.`, 403);
  }
  return connection;
}

function tiktokConnectionForClient(connection) {
  if (!connection) {
    return {
      connected: false,
      configured: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
      scopes: [],
    };
  }
  const profile = connection.profile || {};
  const scopes = normalizeTikTokScopes(connection.scopes);
  const scopeSet = new Set(scopes);
  return {
    connected: true,
    configured: true,
    provider: "tiktok",
    profile: {
      displayName: profile.display_name || "TikTok creator",
      avatarUrl: safeTikTokUrl(profile.avatar_large_url || profile.avatar_url_100 || profile.avatar_url),
      username: scopeSet.has("user.info.profile") ? profile.username || null : null,
      bio: scopeSet.has("user.info.profile") ? profile.bio_description || null : null,
      profileUrl: scopeSet.has("user.info.profile") ? safeTikTokUrl(profile.profile_deep_link) : null,
      verified: scopeSet.has("user.info.profile") ? profile.is_verified === true : null,
      openId: profile.open_id || connection.providerUserId || null,
    },
    stats: scopeSet.has("user.info.stats") ? {
      followers: safeCount(profile.follower_count),
      following: safeCount(profile.following_count),
      likes: safeCount(profile.likes_count),
      videos: safeCount(profile.video_count),
    } : null,
    scopes,
    connectedAt: connection.connectedAt || connection.connected_at || null,
    updatedAt: connection.updatedAt || connection.updated_at || null,
  };
}

function tiktokVideoForClient(video) {
  return {
    id: video.id || null,
    title: video.title || "",
    description: video.video_description || "",
    coverImageUrl: safeTikTokUrl(video.cover_image_url),
    shareUrl: safeTikTokUrl(video.share_url),
    createTime: Number.isFinite(Number(video.create_time)) ? Number(video.create_time) : null,
    duration: safeCount(video.duration),
    views: safeCount(video.view_count),
    likes: safeCount(video.like_count),
    comments: safeCount(video.comment_count),
    shares: safeCount(video.share_count),
  };
}

function safeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function safeTikTokUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeReturnTo(value) {
  const raw = String(value || "/?settings=integrations").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/?settings=integrations";
  return raw.slice(0, 500);
}

function normalizeTikTokPostMode(value) {
  return String(value || "inbox").trim().toLowerCase() === "direct" ? "direct" : "inbox";
}

function resolveTikTokPublishTarget(req) {
  const project = ownedJob(req, req.body?.projectId);
  if (!project) throw new AuthError("Project not found.", 404);
  const type = String(req.body?.targetType || "clip").toLowerCase();
  if (type === "montage") {
    if (project.montage?.status !== "ready" || !project.montage.downloadUrl) {
      throw new AuthError("Build the Auto-Mix MP4 before sending it to TikTok.", 409);
    }
    const outputPath = path.join(exportDir, `${project.batchId || project.id}-automix.mp4`);
    if (!fs.existsSync(outputPath)) throw new AuthError("The rendered Auto-Mix MP4 is no longer available.", 404);
    return {
      type,
      title: project.montage.title || "KlipPharma Auto-Mix",
      path: outputPath,
      mimeType: "video/mp4",
    };
  }
  const clip = project.clips?.find((item) => item.id === req.body?.clipId);
  if (!clip) throw new AuthError("Clip not found.", 404);
  if (clip.renderStatus !== "ready" || !clip.downloadUrl) {
    throw new AuthError("Build the exact final preview before sending this klip to TikTok.", 409);
  }
  const outputPath = path.join(exportDir, `${project.id}-${clip.id}.mp4`);
  if (!fs.existsSync(outputPath)) throw new AuthError("The rendered MP4 is no longer available.", 404);
  return {
    type,
    title: clip.title || "KlipPharma klip",
    path: outputPath,
    mimeType: "video/mp4",
  };
}

async function submitTikTokVideo({ accessToken, target, mode, postInfo }) {
  const stats = fs.statSync(target.path);
  const sourceInfo = {
    source: "FILE_UPLOAD",
    video_size: stats.size,
    chunk_size: stats.size,
    total_chunk_count: 1,
  };
  const body = mode === "direct"
    ? {
      post_info: normalizeTikTokDirectPostInfo(postInfo),
      source_info: sourceInfo,
    }
    : { source_info: sourceInfo };
  const endpoint = mode === "direct" ? "/v2/post/publish/video/init/" : "/v2/post/publish/inbox/video/init/";
  const init = await tiktokApi(endpoint, { method: "POST", token: accessToken, body });
  const publishId = init.data?.publish_id;
  const uploadUrl = init.data?.upload_url;
  if (!publishId || !uploadUrl) throw new AuthError("TikTok did not return an upload target.", 502);
  await uploadTikTokFile(uploadUrl, target.path, stats.size, target.mimeType);
  return {
    ok: true,
    provider: "tiktok",
    mode,
    publishId,
    status: mode === "direct" ? "PROCESSING_UPLOAD" : "SEND_TO_USER_INBOX",
    message: mode === "direct"
      ? "TikTok is processing the upload. Status will update here."
      : "TikTok received the video. The creator can finish the post from their TikTok inbox notification.",
  };
}

function normalizeTikTokDirectPostInfo(body) {
  const privacyLevel = String(body.privacyLevel || "").trim();
  if (!privacyLevel) throw new AuthError("Choose a TikTok audience before publishing.", 400);
  const allowed = new Set(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]);
  if (!allowed.has(privacyLevel)) throw new AuthError("Choose a valid TikTok audience option.", 400);
  if (body.tiktokConsentAccepted !== true) {
    throw new AuthError("Confirm TikTok's posting and Music Usage terms before publishing.", 400);
  }
  return {
    title: String(body.caption || "").slice(0, 2200),
    privacy_level: privacyLevel,
    disable_duet: body.allowDuet !== true,
    disable_stitch: body.allowStitch !== true,
    disable_comment: body.allowComment !== true,
    brand_content_toggle: body.brandContent === true,
    brand_organic_toggle: body.brandOrganic === true,
    is_aigc: body.isAiGenerated === true,
  };
}

async function uploadTikTokFile(uploadUrl, filePath, size, mimeType) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType || "video/mp4",
      "Content-Length": String(size),
      "Content-Range": `bytes 0-${size - 1}/${size}`,
    },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AuthError(detail || `TikTok upload failed with HTTP ${response.status}.`, response.status || 502);
  }
}

app.use((error, _req, res, next) => {
  if (!(error instanceof multer.MulterError)) return next(error);
  if (error.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: "Choose no more than 10 files in one batch." });
  if (error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Each video must be smaller than 1 GB." });
  return res.status(400).json({ error: "The upload could not be accepted." });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "The request contained invalid JSON." });
  res.status(500).json({ error: "KlipPharma hit an unexpected server error." });
});

// KlipPharma defaults to its own port so it never replaces the Tax OS preview.
const port = Number(process.env.PORT || 3100);

async function startServer() {
  await initializeDatabase();
  loadPersistedUploadSessions();
  await loadPostgresUploadSessions();
  await cleanupAbandonedUploadSessions();
  setInterval(() => cleanupAbandonedUploadSessions().catch((error) => {
    console.error("Upload cleanup failed:", error.message);
  }), 60 * 60 * 1000).unref?.();
  loadPersistedJobs();
  await loadPostgresJobs();
  resumePersistedProjects();
  app.listen(port, () => {
    const accountStatus = authMode === "required" ? "accounts required" : "local owner mode";
    console.log(`KlipPharma is running at http://localhost:${port} · ${accountStatus}`);
  });
}

startServer().catch((error) => {
  console.error("KlipPharma could not start:", error.message);
  process.exitCode = 1;
});
