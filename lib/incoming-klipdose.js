import { detectSourcePlatform, isRetryableSourceStatus, platformBadgeForSource } from "./source-platform.js";

export function isKlipdoseProject(job) {
  return job?.integrationSource === "klipdose";
}

export function isArchivedKlipdoseProject(job) {
  return Boolean(job?.archivedAt || job?.dismissedAt);
}

export function klipdoseProcessingBucket(job) {
  if (!job) return "failed";
  if (job.status === "ready") return "ready";
  if (job.status === "failed" || job.status === "rejected" || job.status === "source_auth_required" || job.status === "source_unavailable") return "failed";
  if (job.status === "queued" || job.status === "processing" || job.status === "importing") return "processing";
  return "new";
}

export function klipdoseIncomingStats(jobs) {
  const active = jobs.filter((job) => isKlipdoseProject(job) && !isArchivedKlipdoseProject(job));
  return {
    new: active.filter((job) => klipdoseProcessingBucket(job) === "new").length,
    processing: active.filter((job) => klipdoseProcessingBucket(job) === "processing").length,
    ready: active.filter((job) => klipdoseProcessingBucket(job) === "ready").length,
    failed: active.filter((job) => klipdoseProcessingBucket(job) === "failed").length,
  };
}

export function visibleKlipdoseProjects(jobs, canAccess, { includeArchived = false } = {}) {
  return jobs
    .filter((job) => canAccess(job) && isKlipdoseProject(job))
    .filter((job) => includeArchived || !isArchivedKlipdoseProject(job))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function klipdoseProjectForClient(job) {
  const detectedSource = job.sourceUrl ? detectSourcePlatform(job.sourceUrl) : {};
  const sourcePlatform = job.sourcePlatform || job.sourceProvider || detectedSource.sourcePlatform || "external";
  const sourceType = job.sourceType || detectedSource.sourceType || null;
  return {
    id: job.id,
    batchId: job.batchId || job.id,
    title: job.originalName || job.title || "Klipdose project",
    creatorName: job.creatorName || job.metadata?.creatorName || "Klipdose creator",
    sourceUrl: job.sourceUrl || null,
    thumbnailUrl: job.thumbnailUrl || job.metadata?.thumbnailUrl || null,
    opportunityScore: job.opportunityScore ?? job.viralScore ?? null,
    viralScore: job.viralScore ?? job.opportunityScore ?? null,
    confidence: job.confidence ?? null,
    recommendedAction: job.klipdoseRecommendation || job.recommendedAction || job.goal || "Review source",
    recommendation: job.klipdoseRecommendation || job.recommendedAction || job.goal || "Review source",
    creatorIdentity: safeIdentity(job.creatorIdentity),
    platformIdentity: safeIdentity(job.platformIdentity),
    proposedCaptionCount: job.proposedCaptions?.length || 0,
    proposedClipCount: job.klipdoseProposedClips?.length || 0,
    hashtags: Array.isArray(job.hashtags) ? job.hashtags.slice(0, 12) : [],
    receivedAt: job.klipdoseReceivedAt || job.createdAt || null,
    status: job.status || "queued",
    sourceState: job.stage || job.status || "new",
    sourcePlatform,
    sourceType,
    stage: job.stage || "",
    progress: job.progress ?? 0,
    clipCount: job.clips?.length || 0,
    platformBadge: platformBadgeForSource(sourcePlatform),
    sourceBadge: "KLIPDOSE",
    error: job.error || null,
    sourceReady: Boolean(job.sourceReady),
    canRetryImport: isRetryableSourceStatus(job.status),
    canOpenEditor: Boolean(job.sourceReady || job.status === "ready"),
    archivedAt: job.archivedAt || null,
    sourceContentId: job.sourceContentId || null,
    idempotencyKey: job.idempotencyKey || null,
  };
}

function safeIdentity(identity) {
  if (!identity || typeof identity !== "object") return {};
  return {
    id: identity.id || null,
    platform: identity.platform || null,
    handle: identity.handle || identity.username || null,
    displayName: identity.displayName || identity.name || null,
    profileUrl: identity.profileUrl || null,
  };
}
