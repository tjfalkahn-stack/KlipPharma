export function isKlipdoseProject(job) {
  return job?.integrationSource === "klipdose";
}

export function isArchivedKlipdoseProject(job) {
  return Boolean(job?.archivedAt || job?.dismissedAt);
}

export function klipdoseProcessingBucket(job) {
  if (!job) return "failed";
  if (job.status === "ready") return "ready";
  if (job.status === "failed" || job.status === "source_auth_required") return "failed";
  if (job.status === "queued" || job.status === "processing") return "processing";
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
  return {
    id: job.id,
    batchId: job.batchId || job.id,
    title: job.originalName || job.title || "Klipdose project",
    creatorName: job.creatorName || job.metadata?.creatorName || "Klipdose creator",
    sourceUrl: job.sourceUrl || null,
    thumbnailUrl: job.thumbnailUrl || job.metadata?.thumbnailUrl || null,
    opportunityScore: job.opportunityScore ?? null,
    confidence: job.confidence ?? null,
    recommendedAction: job.recommendedAction || job.goal || "Review source",
    receivedAt: job.klipdoseReceivedAt || job.createdAt || null,
    status: job.status || "queued",
    stage: job.stage || "",
    progress: job.progress ?? 0,
    sourceBadge: "KLIPDOSE",
    error: job.error || null,
    archivedAt: job.archivedAt || null,
    sourceContentId: job.sourceContentId || null,
    idempotencyKey: job.idempotencyKey || null,
  };
}
