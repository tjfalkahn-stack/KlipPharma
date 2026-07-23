import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AuthError,
  authMode,
  authenticateUser,
  createSession,
  createUser,
  deleteDatabaseProject,
  deleteSession,
  findSessionUser,
  initializeDatabase,
  loadDatabaseProjects,
  saveDatabaseProject,
  validateCredentials,
} from "./lib/database.js";
import {
  assertOwnedKey,
  createDirectUpload,
  deleteObject,
  downloadObject,
  objectStorageConfigured,
  verifyObject,
} from "./lib/object-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = process.env.STORAGE_ROOT ? path.resolve(process.env.STORAGE_ROOT) : path.join(__dirname, "storage");
const uploadDir = path.join(storageRoot, "uploads");
const exportDir = path.join(storageRoot, "exports");
const projectsDir = path.join(storageRoot, "projects");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });
fs.mkdirSync(projectsDir, { recursive: true });

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const jobs = new Map();
const previewTasks = new Map();
const batchMontageTasks = new Map();
const processingQueue = [];
const authAttempts = new Map();
const maxConcurrentProjects = 2;
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
let activeProjects = 0;

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const supportedExtension = new Set([".mov", ".mp4", ".m4v", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mpeg", ".mpg"])
      .has(path.extname(file.originalname).toLowerCase());
    cb(null, file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/") || supportedExtension);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(attachUser);
app.use("/exports", requireUser, authorizeExport, express.static(exportDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "KlipPharma", aiConfigured: Boolean(process.env.OPENAI_API_KEY), ffmpeg: true, authMode, uploadMode: objectStorageConfigured ? "direct" : "local" });
});

app.get("/api/auth/session", (req, res) => {
  res.json({ required: authMode === "required", authenticated: Boolean(req.user), user: req.user || null });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  if (authMode !== "required") return res.status(409).json({ error: "Accounts are disabled in local mode." });
  try {
    const credentials = validateCredentials(req.body.email, req.body.password);
    const user = await createUser(credentials.email, credentials.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session);
    res.status(201).json({ user });
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
    res.json({ user });
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

app.use("/api/uploads", requireUser);
app.use("/api/projects", requireUser);
app.use("/api/batches", requireUser);

app.post("/api/uploads/presign", async (req, res) => {
  if (!objectStorageConfigured) return res.status(409).json({ error: "Direct cloud uploads are not enabled on this installation." });
  const files = Array.isArray(req.body.files) ? req.body.files.slice(0, 10) : [];
  if (!files.length) return res.status(400).json({ error: "Choose at least one video or audio file." });
  try {
    const uploads = await Promise.all(files.map(async (file) => {
      const size = Number(file.size);
      if (!Number.isFinite(size) || size <= 0 || size > 1024 * 1024 * 1024) throw new Error("Each source must be between 1 byte and 1 GB.");
      return { ...(await createDirectUpload(req.user.id, file)), name: String(file.name || "video").slice(0, 180), size, type: String(file.type || "application/octet-stream").slice(0, 200) };
    }));
    res.json({ uploads });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not prepare the direct upload." });
  }
});

app.get("/api/projects", (req, res) => {
  const projects = [...jobs.values()]
    .filter((job) => job.userId === req.user.id)
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
    job.userId === req.user.id && String(job.batchId || job.id) === String(req.params.batchId)
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
    item.userId === req.user.id && item.id !== job.id && String(item.batchId || item.id) === String(batchId)
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

app.post("/api/projects/cloud", async (req, res) => {
  if (!objectStorageConfigured) return res.status(409).json({ error: "Cloud object storage is not configured." });
  const sources = Array.isArray(req.body.sources) ? req.body.sources.slice(0, 10) : [];
  if (!sources.length) return res.status(400).json({ error: "Upload at least one source before creating the project." });
  try {
    const files = await Promise.all(sources.map(async (source) => {
      const objectKey = assertOwnedKey(req.user.id, source.objectKey);
      const stored = await verifyObject(req.user.id, objectKey);
      if (!stored.size || stored.size > 1024 * 1024 * 1024) throw new Error("Each uploaded source must be smaller than 1 GB.");
      return {
        originalname: String(source.name || "video").slice(0, 180),
        mimetype: stored.type || String(source.type || "application/octet-stream"),
        objectKey,
        path: path.join(uploadDir, path.basename(objectKey)),
      };
    }));
    const result = createProjectBatch(req, files, Array.isArray(req.body.fileOptions) ? req.body.fileOptions : []);
    res.status(202).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "The cloud upload could not be verified." });
  }
});

function createProjectBatch(req, files, fileOptions = []) {

  const batchId = crypto.randomUUID();
  const created = files.map((file, index) => {
    const id = crypto.randomUUID();
    const job = {
      id,
      userId: req.user.id,
      batchId,
      batchPosition: index + 1,
      batchSize: files.length,
      status: "queued",
      progress: 2,
      stage: "Waiting for the processor",
      originalName: file.originalname,
      filePath: file.path,
      objectKey: file.objectKey || null,
      mimeType: file.mimetype,
      processingMode: fileOptions[index]?.transcribe === false ? "manual" : "ai",
      contentType: normalizeCreatorMode(req.body.contentType),
      clipLength: normalizeClipLength(req.body.clipLength),
      createMontage: req.body.createMontage === true || req.body.createMontage === "true",
      montageLength: normalizeMontageLength(req.body.montageLength),
      montageStyle: normalizeMontageStyle(req.body.montageStyle),
      watermarkText: normalizeWatermarkText(req.body.watermarkText),
      watermarkPosition: normalizeOverlayPosition(req.body.watermarkPosition),
      planTier: normalizePlanTier(req.user.planTier),
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
    processProject(job)
      .catch((error) => {
        console.error(error);
        Object.assign(job, { status: "failed", progress: 100, stage: "Processing failed", error: friendlyError(error) });
        persistJob(job);
      })
      .finally(() => {
        activeProjects -= 1;
        maybeStartBatchMontage(job.batchId);
        runNextProjects();
      });
  }
}

app.get("/api/projects/:id", (req, res) => {
  const job = ownedJob(req, req.params.id);
  if (!job) return res.status(404).json({ error: "Project not found." });
  const safe = { ...job, montage: job.montage ? { ...job.montage } : undefined };
  safe.planTier = normalizePlanTier(req.user.planTier);
  safe.klipPharmaWatermarkRequired = !hasPaidPlan(req.user.planTier);
  if (!isAudioOnly(job.filePath)) safe.sourceUrl = `/api/projects/${job.id}/source`;
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
    .filter((job) => job.batchId === owner.batchId && job.userId === req.user.id)
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
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  delete clip.renderError;
  persistJob(job);
  res.json({ clip });
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
  const manualMode = job.processingMode === "manual";
  Object.assign(job, { status: "processing", progress: 10, stage: manualMode ? "Preparing your manual editor" : "Extracting clear audio from your video" });
  persistJob(job);
  const audioPath = path.join(uploadDir, `${job.id}-audio.mp3`);
  const command = ffmpegPath || "ffmpeg";
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
      whyChosen: "AI transcription is off for this video. Use the start and end controls to create your own klip without transcription charges.",
      scores: {},
      overallScore: null,
      captionsEnabled: false,
      captionText: "",
      captionStyle: "bold",
      captionPosition: "bottom",
      watermarkText: job.watermarkText || "",
      watermarkPosition: job.watermarkPosition || "top-right",
      focusX: 50,
      renderStatus: "idle",
      feedback: null,
    }];
    Object.assign(job, { status: "ready", progress: 100, stage: "Manual editor ready" });
    persistJob(job);
    return;
  }

  job.audioPath = audioPath;
  job.progress = 28;
  job.stage = "Transcribing every word and timestamp";
  persistJob(job);
  const transcription = await transcribeAudio(job, audioPath);
  job.progress = 55;
  job.stage = "Ranking hooks, context, and payoff";
  persistJob(job);
  job.transcript = transcription.text;
  job.segments = normalizeSegments(transcription);
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
    renderStatus: "idle",
    feedback: null,
  }));
  Object.assign(job, { status: "ready", progress: 100, stage: `${job.clips.length} dope clips found` });
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

  const combined = { text: "", segments: [] };
  for (let index = 0; index < files.length; index += 1) {
    job.stage = files.length > 1
      ? `Transcribing section ${index + 1} of ${files.length}`
      : "Transcribing every word and timestamp";
    job.progress = 28 + Math.round(((index + 1) / files.length) * 24);
    persistJob(job);
    const part = await openai.audio.transcriptions.create({
      file: fs.createReadStream(files[index].path),
      model: process.env.AI_TRANSCRIPTION_MODEL || "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
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
        content: `Audience: ${job.audience}\nGoal: ${job.goal}\nPlatform: ${job.platform}\nCreator mode: ${creatorMode.label}\n\nBATCH AUTO-KLIP LENGTH\n${lengthRule}\n\nMODE-SPECIFIC EDITORIAL RULES\n${creatorMode.prompt}\n\nSelect up to 8 non-overlapping clips and never exceed the batch maximum or 90 seconds. Every selection must begin and end on a complete thought. Each clip needs: start (number), end (number), title, hook, whyChosen, caption, strategy (a short 1-3 word editorial lane), scores object with hook, context, payoff, retention, audienceFit, platformFit (integers 0-100), and overallScore (integer 0-100). Prefer exact transcript boundaries.\n\nTRANSCRIPT\n${transcript.slice(0, 110000)}`,
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
    .sort((a, b) => Number(b.overallScore) - Number(a.overallScore));
}

async function renderClip(job, clip, planTier = job.planTier) {
  await ensureLocalSource(job);
  const outputName = `${job.id}-${clip.id}.mp4`;
  const outputPath = path.join(exportDir, outputName);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "klippharma-klip-"));
  try {
    const relevant = (job.segments || []).filter((s) => s.end > clip.start && s.start < clip.end);
    let filter = verticalCropFilter(clip.focusX, true);
    const customCaptionText = String(clip.captionText || "").trim();
    const captionCues = customCaptionText
      ? captionCuesFromText(customCaptionText, clip.end - clip.start)
      : relevant.map((segment) => ({
        start: Math.max(0, segment.start - clip.start),
        end: Math.min(clip.end - clip.start, segment.end - clip.start),
        text: segment.text,
      }));
    if (clip.captionsEnabled !== false && captionCues.length) {
      const subtitlePath = path.join(tempDir, "captions.srt");
      const srt = captionCues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${String(cue.text).replaceAll("\n", " ")}\n`).join("\n");
      fs.writeFileSync(subtitlePath, srt);
      const escapedSubs = subtitlePath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
      filter += `,subtitles='${escapedSubs}':force_style='${captionForceStyle(clip.captionStyle, clip.captionPosition)}'`;
    }
    filter = appendExportWatermarks(filter, tempDir, {
      duration: clip.end - clip.start,
      customText: clip.watermarkText,
      customPosition: clip.watermarkPosition,
      brandRequired: !hasPaidPlan(planTier),
      prefix: "clip",
    });
    const audioBitrate = job.contentType === "artist" ? "256k" : "160k";
    await run(ffmpegPath || "ffmpeg", [
      "-y", "-fflags", "+genpts", "-ss", String(clip.start), "-i", job.filePath,
      "-t", String(clip.end - clip.start),
      "-map", "0:v:0", "-map", "0:a:0?", "-vf", filter,
      ...quickTimeVideoArgs("23"),
      ...quickTimeAudioArgs(audioBitrate),
      "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048",
      "-movflags", "+faststart", outputPath,
    ]);
    clip.renderStatus = "ready";
    clip.downloadUrl = `/exports/${outputName}`;
    persistJob(job);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
  for (const clip of job.clips || []) removeLocalFile(path.join(exportDir, `${job.id}-${clip.id}.mp4`), exportDir);
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
        const captionPath = path.join(tempDir, `captions-${String(index).padStart(3, "0")}.srt`);
        const cues = captionCuesFromText(segment.captionText, segment.duration);
        fs.writeFileSync(captionPath, cues.map((cue, cueIndex) => `${cueIndex + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join("\n"));
        const escapedCaptions = captionPath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
        filter += `,subtitles='${escapedCaptions}':force_style='${captionForceStyle(owner.montage.captionStyle, owner.montage.captionPosition)}'`;
      }
      filter = appendExportWatermarks(filter, tempDir, {
        duration: segment.duration,
        customText: owner.watermarkText,
        customPosition: owner.watermarkPosition,
        brandRequired: !hasPaidPlan(planTier),
        prefix: `automix-${String(index).padStart(3, "0")}`,
      });
      const hasAudio = await probeHasAudio(command, segment.job.filePath);
      const args = hasAudio
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

function persistJob(job) {
  try {
    const destination = path.join(projectsDir, `${job.id}.json`);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(job));
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.error(`Could not persist project ${job.id}:`, error.message);
  }
  saveDatabaseProject(job).catch((error) => {
    console.error(`Could not save project ${job.id} to PostgreSQL:`, error.message);
  });
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
        stage: "Recovered after restart · waiting for the processor",
        resumeAfterRestart: true,
      });
      delete job.error;
    } else {
      Object.assign(job, {
        status: "failed",
        progress: 100,
        stage: "Processing was interrupted",
        error: "This project was interrupted and its source is no longer available. Upload the source again to restart processing.",
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
  return job?.userId === req.user?.id ? job : null;
}

function authorizeExport(req, res, next) {
  const filename = path.basename(req.path);
  const allowed = [...jobs.values()].some((job) => (
    job.userId === req.user.id && (filename.startsWith(`${job.id}-`) || filename.startsWith(`${job.batchId}-`))
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
