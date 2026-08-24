const TRANSFERRED_STATUSES = new Set(["queued_for_processing", "cancelled"]);

export function uploadFileNeedsDevice(file) {
  if (!file || file.projectId) return false;
  return !TRANSFERRED_STATUSES.has(String(file.status || ""));
}

export const defaultUploadSnapshotIdleMs = 30 * 60 * 1000;

export function uploadSessionNeedsDevice(session) {
  return Boolean(session?.files?.some(uploadFileNeedsDevice));
}

export function uploadSessionWasExplicitlyPaused(session) {
  return Boolean(session?.files?.some((file) => (
    uploadFileNeedsDevice(file) && String(file?.status || "") === "paused"
  )));
}

export function uploadSessionCanRestoreFromSnapshot(session, {
  now = Date.now(),
  maxIdleMs = defaultUploadSnapshotIdleMs,
} = {}) {
  if (!uploadSessionNeedsDevice(session)) return false;
  if (uploadSessionWasExplicitlyPaused(session)) return true;
  const updatedAt = Date.parse(session?.updatedAt || session?.createdAt || "");
  return Number.isFinite(updatedAt) && Math.max(0, Number(now) - updatedAt) <= Number(maxIdleMs);
}

export function restorableUploadSessions(sessions, options = {}) {
  return [...(sessions || [])].filter((session) => uploadSessionCanRestoreFromSnapshot(session, options));
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
