export function authorizedSourceAttachmentPatch({ filePath, mimeType, uploadedAt = new Date().toISOString() }) {
  return {
    filePath,
    objectKey: null,
    mimeType,
    sourceReady: true,
    sourceAttachmentUploadedAt: uploadedAt,
    status: "queued",
    progress: 48,
    phase: "queued",
    stage: "Authorized source uploaded · waiting for the klip processor",
    error: null,
    archivedAt: null,
    dismissedAt: null,
  };
}

export function applyAuthorizedSourceAttachment(job, attachment) {
  Object.assign(job, attachment);
  return job;
}
