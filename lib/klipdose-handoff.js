import crypto from "node:crypto";

const callbackStates = new Set(["received", "importing", "ready", "rejected", "failed"]);

export function klipdoseApiKeyFromEnv(env = process.env) {
  return String(env.KLIPPHARMA_API_KEY || env.KLIPDOSE_SHARED_API_KEY || "").trim();
}

export function validateKlipdoseApiToken(provided, env = process.env) {
  const expected = klipdoseApiKeyFromEnv(env);
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function parseKlipdoseHandoffPayload(body = {}) {
  const issues = [];
  const source = objectValue(body.source) || objectValue(body.content) || {};
  const metadata = objectValue(body.sourceMetadata) || objectValue(body.metadata) || {};
  const creator = objectValue(body.creator) || {};
  const platformIdentity = objectValue(body.platformIdentity) || objectValue(body.platform_identity) || {};
  const score = firstFiniteNumber(
    body.viralScore,
    body.viral_score,
    body.highlightScore,
    body.highlight_score,
    body.opportunityScore,
    body.score,
    objectValue(body.scores)?.viral,
    objectValue(body.scores)?.highlight,
  );
  const idempotencyKey = firstString(
    body.idempotencyKey,
    body.idempotency_key,
    body.externalId,
    body.external_id,
    body.handoffId,
    body.handoff_id,
    body.sourceContentId,
    source.id,
    metadata.id,
  );
  const sourceUrl = firstString(
    body.sourceUrl,
    body.source_url,
    body.url,
    source.url,
    source.sourceUrl,
    metadata.sourceUrl,
    metadata.url,
  );
  const callbackUrl = firstString(body.callbackUrl, body.callback_url, objectValue(body.callback)?.url);

  if (!idempotencyKey || idempotencyKey.length > 180) {
    issues.push({ path: ["idempotencyKey"], message: "A stable idempotency key is required." });
  }
  if (!validHttpUrl(sourceUrl)) {
    issues.push({ path: ["sourceUrl"], message: "A public http or https source URL is required." });
  }
  if (callbackUrl && !validHttpUrl(callbackUrl)) {
    issues.push({ path: ["callbackUrl"], message: "Callback URL must be http or https." });
  }

  const clips = normalizeKlipdoseClips(body.clips || body.highlights || body.clipTimestamps || body.clip_timestamps);
  const hashtags = normalizeTags(body.hashtags || body.proposedHashtags || body.proposed_hashtags);
  const proposedCaptions = normalizeCaptions(body.proposedCaptions || body.proposed_captions || body.captions);

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    project: {
      idempotencyKey,
      sourceUrl,
      sourceContentId: firstString(body.sourceContentId, body.source_content_id, source.id, metadata.sourceContentId),
      title: firstString(body.title, body.name, source.title, metadata.title) || "Klipdose project",
      creatorName: firstString(body.creatorName, body.creator_name, body.creator, creator.displayName, creator.display_name, creator.name, creator.handle) || "Klipdose creator",
      thumbnailUrl: firstString(body.thumbnailUrl, body.thumbnail_url, source.thumbnailUrl, source.thumbnail_url, metadata.thumbnailUrl),
      platform: firstString(body.platform, source.platform, platformIdentity.platform, metadata.platform),
      creatorIdentity: cleanObject({
        id: firstString(creator.id, creator.creatorId, creator.creator_id),
        platform: firstString(creator.platform, body.platform, source.platform),
        handle: firstString(creator.handle, creator.username, body.creatorHandle, body.creator_handle),
        displayName: firstString(creator.displayName, creator.display_name, creator.name, body.creatorName, body.creator_name),
        profileUrl: firstString(creator.profileUrl, creator.profile_url),
      }),
      platformIdentity: cleanObject(platformIdentity),
      sourceMetadata: cleanObject({ ...metadata, ...cleanObject(source) }),
      viralScore: score,
      opportunityScore: score,
      confidence: firstFiniteNumber(body.confidence, body.relevanceScore, body.relevance_score),
      recommendation: firstString(body.recommendation, body.recommendedAction, body.recommended_action, body.goal) || "Review source",
      recommendedAction: firstString(body.recommendation, body.recommendedAction, body.recommended_action, body.goal) || "Review source",
      clips,
      proposedCaptions,
      hashtags,
      callbackUrl: callbackUrl || null,
    },
  };
}

export function applyKlipdoseHandoffState(job, state, details = {}) {
  if (!callbackStates.has(state)) throw new Error(`Unsupported Klipdose handoff state: ${state}`);
  const at = new Date().toISOString();
  job.klipdoseHandoffStatus = state;
  job.klipdoseAudit = Array.isArray(job.klipdoseAudit) ? job.klipdoseAudit : [];
  job.klipdoseAudit.push(cleanObject({ state, at, ...details }));
  job.klipdoseAudit = job.klipdoseAudit.slice(-80);
  if (state === "rejected") job.rejectedAt = at;
  if (state === "failed") job.failedAt = job.failedAt || at;
  return job;
}

export function klipdoseCallbackSecret(env = process.env) {
  return String(env.KLIPDOSE_CALLBACK_SECRET || env.KLIPPHARMA_CALLBACK_SECRET || env.KLIPPHARMA_API_KEY || env.KLIPDOSE_SHARED_API_KEY || "").trim();
}

export function signKlipdoseCallbackBody(bodyText, secret) {
  if (!secret) return null;
  return `sha256=${crypto.createHmac("sha256", secret).update(bodyText).digest("hex")}`;
}

export function klipdoseCallbackPayload(job, state, extra = {}) {
  return cleanObject({
    projectId: job.id,
    idempotencyKey: job.idempotencyKey,
    sourceContentId: job.sourceContentId || null,
    state,
    status: job.status,
    phase: job.phase || null,
    stage: job.stage || null,
    progress: Number(job.progress || 0),
    error: state === "failed" || state === "rejected" ? job.error || extra.error || null : null,
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

export function recordKlipdoseCallbackAttempt(job, attempt) {
  job.klipdoseCallbackAttempts = Array.isArray(job.klipdoseCallbackAttempts) ? job.klipdoseCallbackAttempts : [];
  job.klipdoseCallbackAttempts.push(cleanObject({ ...attempt, at: attempt.at || new Date().toISOString() }));
  job.klipdoseCallbackAttempts = job.klipdoseCallbackAttempts.slice(-30);
  job.klipdoseCallbackStatus = cleanObject({
    state: attempt.state,
    delivered: Boolean(attempt.delivered),
    final: Boolean(attempt.final),
    lastStatusCode: attempt.statusCode || null,
    lastError: attempt.error || null,
    updatedAt: new Date().toISOString(),
  });
  return job;
}

export function shouldRetryKlipdoseCallback(statusCode) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (normalized) return normalized.slice(0, 1000);
  }
  return "";
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return tags.map((tag) => String(tag).trim().replace(/^#/, "")).filter(Boolean).slice(0, 30);
}

function normalizeCaptions(value) {
  const captions = Array.isArray(value) ? value : value ? [value] : [];
  return captions.map((caption) => String(caption).trim()).filter(Boolean).slice(0, 20);
}

function normalizeKlipdoseClips(value) {
  const clips = Array.isArray(value) ? value : [];
  return clips.map((clip, index) => {
    if (Array.isArray(clip)) {
      return cleanObject({ index, start: Number(clip[0]), end: Number(clip[1]) });
    }
    const item = objectValue(clip) || {};
    return cleanObject({
      index,
      start: firstFiniteNumber(item.start, item.startTime, item.start_time, item.from),
      end: firstFiniteNumber(item.end, item.endTime, item.end_time, item.to),
      title: firstString(item.title, item.name),
      caption: firstString(item.caption, item.proposedCaption, item.proposed_caption),
      hashtags: normalizeTags(item.hashtags),
      score: firstFiniteNumber(item.score, item.viralScore, item.highlightScore),
      reason: firstString(item.reason, item.recommendation),
    });
  }).filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.end > clip.start).slice(0, 50);
}

function cleanObject(value) {
  const result = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined || entry === null || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    result[key] = entry;
  }
  return result;
}
