const TRANSFERRED_STATUSES = new Set(["queued_for_processing", "cancelled"]);

export function uploadFileNeedsDevice(file) {
  if (!file || file.projectId) return false;
  return !TRANSFERRED_STATUSES.has(String(file.status || ""));
}

export function uploadSessionNeedsDevice(session) {
  return Boolean(session?.files?.some(uploadFileNeedsDevice));
}

export function pendingUploadSessions(sessions) {
  return [...(sessions || [])].filter(uploadSessionNeedsDevice);
}

export function uploadSnapshotBelongsToUser(snapshot, userId) {
  const ownerId = String(snapshot?.userId || "");
  const currentUserId = String(userId || "");
  return Boolean(ownerId && currentUserId && ownerId === currentUserId);
}

export function serverSessionsConfirmedByBrowser(serverSessions, browserSessionIds) {
  const knownIds = new Set([...(browserSessionIds || [])].map((id) => String(id || "")));
  return [...(serverSessions || [])].filter((session) => knownIds.has(String(session?.id || "")));
}

export function selectUploadSessionNeedingDevice(sessions, preferredSessionId = null) {
  const pending = pendingUploadSessions(sessions);
  const preferred = pending.find((session) => String(session.id) === String(preferredSessionId || ""));
  if (preferred) return preferred;
  return pending.sort((a, b) => (
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  ))[0] || null;
}
