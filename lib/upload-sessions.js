import crypto from "node:crypto";
import path from "node:path";

export const defaultUploadPartSize = 8 * 1024 * 1024;
export const maxUploadFileSize = 1024 * 1024 * 1024;
export const maxBatchFileCount = 10;
export const maxUploadBatchSize = 2 * 1024 * 1024 * 1024;
export const defaultUploadSessionListIdleMs = 30 * 60 * 1000;
export const allowedUploadStatuses = new Set([
  "preparing",
  "ready_to_upload",
  "uploading",
  "paused",
  "interrupted",
  "uploaded",
  "finalizing",
  "queued_for_processing",
  "processing",
  "ready",
  "failed",
  "cancelled",
]);

const supportedExtensions = new Set([
  ".mov", ".mp4", ".m4v", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mpeg", ".mpg",
]);

export function createUploadSession({ userId, workspaceId = null, files, settings = {}, fileOptions = [], partSize = defaultUploadPartSize, limits = {} }) {
  if (!userId) throw new Error("Upload sessions require a user.");
  const normalizedFiles = normalizeUploadFiles(files, partSize, limits);
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    batchId,
    userId,
    workspaceId,
    status: "preparing",
    settings: sanitizeUploadSettings(settings),
    files: normalizedFiles.map((file, index) => ({
      ...file,
      index,
      transcribe: fileOptions[index]?.transcribe !== false,
      uploadedBytes: 0,
      completedParts: [],
      retryCount: 0,
      status: "preparing",
      projectId: null,
      error: null,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeUploadFiles(files, partSize = defaultUploadPartSize, limits = {}) {
  const maxFiles = normalizeLimit(limits.maxFiles, maxBatchFileCount);
  const maxBatchBytes = normalizeLimit(limits.maxBatchBytes, maxUploadBatchSize);
  const list = Array.isArray(files) ? files.slice(0, maxFiles) : [];
  if (!list.length) throw new Error("Choose at least one video or audio file.");
  if (Array.isArray(files) && files.length > maxFiles) throw new Error(`Choose no more than ${maxFiles} files in one batch.`);
  const normalized = list.map((file) => normalizeUploadFile(file, partSize, limits));
  const totalBytes = normalized.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > maxBatchBytes) throw new Error(`This batch is larger than the ${formatLimit(maxBatchBytes)} upload limit.`);
  return normalized;
}

export function normalizeUploadFile(file, partSize = defaultUploadPartSize, limits = {}) {
  const name = String(file?.name || "video").slice(0, 180);
  const extension = path.extname(name).toLowerCase();
  const size = Number(file?.size);
  const maxFileBytes = normalizeLimit(limits.maxFileBytes, maxUploadFileSize);
  const allowedMimePrefixes = Array.isArray(limits.mimePrefixes) && limits.mimePrefixes.length
    ? limits.mimePrefixes
    : ["video/", "audio/"];
  const type = String(file?.type || "application/octet-stream").slice(0, 200);
  if (!supportedExtensions.has(extension)) {
    throw new Error("Choose MP4, MOV, M4V, WebM, MP3, M4A, WAV, AAC, OGG, FLAC, MPEG, or MPG files.");
  }
  if (!Number.isFinite(size) || size <= 0 || size > maxFileBytes) {
    throw new Error(`Each source must be between 1 byte and ${formatLimit(maxFileBytes)}.`);
  }
  if (type && type !== "application/octet-stream" && !allowedMimePrefixes.some((prefix) => type.startsWith(prefix))) {
    throw new Error("Choose video or audio source files.");
  }
  const safePartSize = Math.max(5 * 1024 * 1024, Number(partSize) || defaultUploadPartSize);
  return {
    id: crypto.randomUUID(),
    name,
    type,
    size,
    lastModified: Number(file?.lastModified || 0) || null,
    partSize: safePartSize,
    totalParts: Math.ceil(size / safePartSize),
  };
}

export function attachMultipartUpload(file, upload) {
  if (!file || !upload?.uploadId || !upload?.objectKey) throw new Error("Multipart upload was not prepared.");
  file.uploadId = upload.uploadId;
  file.objectKey = upload.objectKey;
  file.status = "ready_to_upload";
  file.updatedAt = new Date().toISOString();
  return file;
}

export function objectKeyForUploadFile(userId, batchId, fileId, fileName) {
  if (!userId || !batchId || !fileId) throw new Error("Upload object keys require owner, batch, and file ids.");
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (!supportedExtensions.has(extension)) throw new Error("Unsupported upload file extension.");
  return `${userId}/uploads/${batchId}/${fileId}${extension}`;
}

export function recordUploadPart(session, fileId, part) {
  const file = findUploadFile(session, fileId);
  const partNumber = Number(part?.partNumber);
  const size = Number(part?.size);
  const etag = sanitizeEtag(part?.etag);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > file.totalParts) {
    throw new Error("Upload part number is invalid.");
  }
  if (!etag) throw new Error("Upload part ETag is required.");
  if (!Number.isFinite(size) || size <= 0) throw new Error("Upload part size is required.");
  const existingIndex = file.completedParts.findIndex((item) => item.partNumber === partNumber);
  const record = { partNumber, etag, size };
  if (existingIndex >= 0) file.completedParts[existingIndex] = record;
  else file.completedParts.push(record);
  file.completedParts.sort((a, b) => a.partNumber - b.partNumber);
  file.uploadedBytes = Math.min(file.size, file.completedParts.reduce((sum, item) => sum + Number(item.size || 0), 0));
  file.status = file.uploadedBytes >= file.size && file.completedParts.length >= file.totalParts ? "uploaded" : "uploading";
  touchSession(session);
  return file;
}

export function markUploadFileCompleted(session, fileId, { projectId }) {
  const file = findUploadFile(session, fileId);
  if (!projectId) throw new Error("Project id is required.");
  file.status = "queued_for_processing";
  file.projectId = projectId;
  file.uploadedBytes = file.size;
  file.completedAt = new Date().toISOString();
  touchSession(session);
  refreshSessionStatus(session);
  return file;
}

export function setUploadFileStatus(session, fileId, status, extra = {}) {
  if (!allowedUploadStatuses.has(status)) throw new Error("Upload status is invalid.");
  const file = findUploadFile(session, fileId);
  Object.assign(file, { status, ...extra, updatedAt: new Date().toISOString() });
  touchSession(session);
  refreshSessionStatus(session);
  return file;
}

export function refreshSessionStatus(session) {
  const files = Array.isArray(session?.files) ? session.files : [];
  if (files.every((file) => file.status === "cancelled")) session.status = "cancelled";
  else if (files.some((file) => file.status === "failed")) session.status = "failed";
  else if (files.every((file) => file.projectId || file.status === "queued_for_processing")) session.status = "processing";
  else if (files.some((file) => file.status === "uploading" || file.status === "uploaded" || file.status === "finalizing")) session.status = "uploading";
  else if (files.some((file) => file.status === "paused")) session.status = "paused";
  else session.status = "preparing";
  return session.status;
}

export function uploadSessionForClient(session) {
  return {
    id: session.id,
    batchId: session.batchId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    storageMode: session.storageMode || "cloud",
    files: (session.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      uploadedBytes: file.uploadedBytes || 0,
      partSize: file.partSize,
      totalParts: file.totalParts,
      completedParts: file.completedParts || [],
      status: file.status,
      projectId: file.projectId || null,
      error: file.error || null,
      storageMode: file.storageMode || session.storageMode || "cloud",
    })),
  };
}

export function canAccessUploadSession(user, team, session) {
  if (!session || !user?.id) return false;
  if (session.userId === user.id) return true;
  const memberIds = team?.memberIds || [];
  return Boolean(team?.businessActive && memberIds.includes(session.userId));
}

export function uploadSessionNeedsDeviceTransfer(session) {
  return Boolean(session?.files?.some((file) => (
    !file?.projectId && !new Set(["queued_for_processing", "cancelled"]).has(String(file?.status || ""))
  )));
}

export function uploadSessionWasExplicitlyPaused(session) {
  return Boolean(session?.files?.some((file) => (
    !file?.projectId && String(file?.status || "") === "paused"
  )));
}

export function listUploadSessionsForClient(sessions, {
  requestedIds = [],
  now = Date.now(),
  maxIdleMs = defaultUploadSessionListIdleMs,
} = {}) {
  const requested = new Set([...(requestedIds || [])].map((id) => String(id || "")));
  return [...(sessions || [])].filter((session) => {
    if (!session?.id || !uploadSessionNeedsDeviceTransfer(session)) return false;
    if (requested.has(String(session.id)) && uploadSessionWasExplicitlyPaused(session)) return true;
    const updatedAt = Date.parse(session.updatedAt || session.createdAt || "");
    return Number.isFinite(updatedAt) && Math.max(0, Number(now) - updatedAt) <= Number(maxIdleMs);
  });
}

export function assertUploadFileIdentity(fileState, browserFile) {
  if (!fileState || !browserFile) throw new Error("Reselect the original file to resume this upload.");
  const sameName = String(browserFile.name || "") === String(fileState.name || "");
  const sameSize = Number(browserFile.size) === Number(fileState.size);
  const expectedModified = Number(fileState.lastModified || 0);
  const sameModified = !expectedModified || Number(browserFile.lastModified || 0) === expectedModified;
  const type = String(browserFile.type || "");
  const sameType = !fileState.type || fileState.type === "application/octet-stream" || !type || type === fileState.type;
  if (!sameName || !sameSize || !sameModified || !sameType) {
    throw new Error("That file does not match the interrupted upload. Reselect the original file to resume.");
  }
  return true;
}

export function findUploadFile(session, fileId) {
  const file = session?.files?.find((item) => item.id === fileId);
  if (!file) throw new Error("Upload file not found.");
  return file;
}

export function sanitizeUploadSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const allowed = [
    "audience", "goal", "platform", "contentType", "clipLength", "createMontage", "montageLength",
    "montageStyle", "watermarkText", "watermarkPosition", "sourceLanguage", "translationLanguage",
    "audioTranslation", "dubVoice", "outputCount",
  ];
  return Object.fromEntries(allowed.map((key) => [key, source[key]]));
}

function sanitizeEtag(value) {
  return String(value || "").replace(/^W\//, "").replace(/^"+|"+$/g, "").trim();
}

function touchSession(session) {
  session.updatedAt = new Date().toISOString();
  return session;
}

function normalizeLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function formatLimit(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024 / 1024)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
