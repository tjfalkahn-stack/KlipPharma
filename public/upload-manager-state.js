const TRANSFERRED_STATUSES = new Set(["queued_for_processing", "cancelled"]);

export function uploadFileNeedsDevice(file) {
  if (!file || file.projectId) return false;
  return !TRANSFERRED_STATUSES.has(String(file.status || ""));
}

export function uploadSessionNeedsDevice(session) {
  return Boolean(session?.files?.some(uploadFileNeedsDevice));
}

export function selectUploadSessionNeedingDevice(sessions, preferredSessionId = null) {
  const pending = [...(sessions || [])].filter(uploadSessionNeedsDevice);
  const preferred = pending.find((session) => String(session.id) === String(preferredSessionId || ""));
  if (preferred) return preferred;
  return pending.sort((a, b) => (
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  ))[0] || null;
}
