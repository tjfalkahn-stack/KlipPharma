Warning: truncated output (original token count: 53388)
Total output lines: 4573

import { selectUploadSessionNeedingDevice, uploadFileNeedsDevice } from "./upload-manager-state.js?v=0.29.17";

const $ = (selector) => document.querySelector(selector);
const ASSET_VERSION = "0.29.17";
window.__KLIPPHARMA_ASSET_VERSION__ = ASSET_VERSION;
console.info("[KlipPharma dashboard] asset loaded", { version: ASSET_VERSION, path: window.location.pathname });

const nativeFetch = window.fetch.bind(window);
let recoveringExpiredSession = false;

function isProtectedApiRequest(input) {
  try {
    const rawUrl = typeof input === "string" ? input : input?.url;
    const url = new URL(rawUrl, window.location.href);
    return url.origin === window.location.origin
      && url.pathname.startsWith("/api/")
      && !url.pathname.startsWith("/api/auth/")
      && url.pathname !== "/api/health";
  } catch {
    return false;
  }
}

function recoverExpiredSession() {
  if (recoveringExpiredSession || !currentUser) return;
  recoveringExpiredSession = true;
  clearTimeout(pollTimer);
  clearTimeout(dashboardRefreshTimer);
  clearTimeout(incomingRefreshTimer);
  currentProjects = [];
  billingState = null;
  showAuthentication();
  authError.textContent = "Your session expired. Sign in again to continue.";
  authError.classList.remove("hidden");
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  window.setTimeout(() => { recoveringExpiredSession = false; }, 500);
}

window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.status === 401 && isProtectedApiRequest(args[0])) recoverExpiredSession();
  return response;
};

function logIncomingDashboardFetch(details) {
  console.info("[KlipPharma Incoming Projects]", details);
}
const form = $("#uploadForm");
const appShell = $("#appShell");
const authView = $("#authView");
const authForm = $("#authForm");
const authSwitch = $("#authSwitch");
const authError = $("#authError");
const accountMenu = $("#accountMenu");
const billingModal = $("#billingModal");
const dashboardModal = $("#dashboardModal");
const incomingModal = $("#incomingModal");
const settingsModal = $("#settingsModal");
const tiktokPublishModal = $("#tiktokPublishModal");
const youtubePublishModal = $("#youtubePublishModal");
const globalUploadManagerPanel = $("#globalUploadManager");
const globalUploadPause = $("#globalUploadPause");
const globalUploadResume = $("#globalUploadResume");
const globalUploadCancel = $("#globalUploadCancel");
const checkoutAgreement = $("#checkoutAgreement");
const cancelAgreement = $("#cancelAgreement");
const tiktokConsent = $("#tiktokConsent");
const youtubeConsent = $("#youtubeConsent");
const videoInput = $("#video");
const dropzone = $("#dropzone");
const youtubeUrl = $("#youtubeUrl");
const youtubeMode = $("#youtubeMode");
const youtubeOwnership = $("#youtubeOwnership");
const youtubeImportButton = $("#youtubeImportButton");
const youtubeImportStatus = $("#youtubeImportStatus");
const uploadView = $("#uploadView");
const processingView = $("#processingView");
const processingBack = $("#processingBack");
const resultsView = $("#resultsView");
const autoMixBuilder = $("#autoMixBuilder");
const autoMixToggle = $("#createMontage");
const deleteBatchButton = $("#deleteBatch");
const translationLanguage = $("#translationLanguage");
const audioTranslation = $("#audioTranslation");
const dubVoice = $("#dubVoice");
const audioTranslationHelp = $("#audioTranslationHelp");
const outputCount = $("#outputCount");
const proOutputCount = $("#proOutputCount");
const outputCountBadge = $("#outputCountBadge");
const outputCountHelp = $("#outputCountHelp");
let selectedFiles = [];
const fileModes = new Map();
let currentProjects = [];
let pollTimer;
let dashboardRefreshTimer;
const previewRecovery = new Map();
let previewRecoveryQueue = Promise.resolve();
let creatingAccount = false;
let uploadMode = "local";
let currentUser = null;
let billingState = null;
let selectedBillingPlanKey = "creator_monthly";
let integrationsState = null;
let tiktokPublishTarget = null;
let tiktokCreatorInfo = null;
let youtubePublishTarget = null;
let currentDashboardProjects = [];
let incomingRefreshTimer = null;
let incomingState = { projects: [], stats: {}, connection: {} };
const uploadManager = {
  sessions: new Map(),
  fileHandles: new Map(),
  runningSessionIds: new Set(),
  activeSessionId: null,
  paused: false,
  cancelled: false,
  readyNotified: new Set(JSON.parse(localStorage.getItem("klippharmaReadyNotified") || "[]")),
};
const paidPlanTiers = new Set(["paid", "pro", "creator", "studio", "business"]);
const creatorModeCopy = {
  auto: ["Smart Detect", "Balanced selection for mixed or general content."],
  artist: ["Artist / Music", "Protects complete lyrical phrases, favors memorable song and artist-story moments, and renders final audio at a higher bitrate."],
  podcast: ["Podcast / Interview", "Keeps essential questions and answers together while finding insights, debates, stories, humor, and reactions."],
  monologue: ["Monologue / Talking Head", "Cuts slow introductions and prioritizes cold opens, lessons, hot takes, personal stories, and direct calls to action."],
};

processingBack.addEventListener("click", () => {
  processingBack.classList.add("hidden");
  processingView.setAttribute("aria-busy", "false");
  setView("upload");
});
globalUploadPause?.addEventListener("click", () => updateActiveUploadFiles("pause"));
globalUploadResume?.addEventListener("click", () => updateActiveUploadFiles("resume"));
globalUploadCancel?.addEventListener("click", () => updateActiveUploadFiles("cancel"));
restoreUploadManagerSnapshot();
const languageNames = {
  en: "English", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", it: "Italian",
  ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic", hi: "Hindi",
};

function isPaidPlan(user = currentUser) {
  return paidPlanTiers.has(String(user?.planTier || "free").trim().toLowerCase());
}

function hasCreativeAccess(user = currentUser) {
  return new Set(["pro", "studio", "business"]).has(String(user?.planTier || "").toLowerCase())
    || user?.creativeFeaturesOpen === true;
}

function hasProBatchOutput(user = currentUser) {
  return user?.creativeFeaturesOpen === true
    || new Set(["pro", "studio", "business"]).has(String(user?.planTier || "").trim().toLowerCase());
}

function paintOutputCountPolicy() {
  const enabled = hasProBatchOutput();
  outputCount.disabled = !enabled;
  proOutputCount.classList.toggle("locked", !enabled);
  outputCountBadge.textContent = enabled ? "PRO ACTIVE" : "PRO";
  outputCountHelp.textContent = enabled
    ? "This controls separate ranked klips, not source videos. Auto-Mix creates one combined video from the uploaded batch."
    : "Upgrade to Pro to choose 1–10 finished klips. Your current plan uses Smart selection.";
}

function paintBrandPolicy(root = document) {
  const paid = isPaidPlan();
  root.querySelectorAll("[data-brand-policy]").forEach((policy) => {
    policy.classList.toggle("paid", paid);
    policy.querySelector("[data-brand-policy-title]").textContent = paid
      ? "Paid export · KlipPharma watermark removed"
      : "Free/Demo export · KlipPharma watermark locked";
    policy.querySelector("[data-brand-policy-copy]").textContent = paid
      ? "Your typed watermark will still be burned into the downloaded MP4."
      : "Your typed watermark appears too. Subscribe to a paid tier to remove the KlipPharma mark.";
    policy.querySelector("[data-brand-policy-badge]").textContent = paid ? "PAID" : "LOCKED";
  });
}

autoMixToggle.addEventListener("change", paintAutoMixControls);
paintAutoMixControls();
translationLanguage.addEventListener("change", paintLanguageControls);
audioTranslation.addEventListener("change", paintLanguageControls);
paintLanguageControls();

function paintLanguageControls() {
  const hasTranslation = translationLanguage.value !== "original";
  audioTranslation.querySelector('option[value="dubbed"]').disabled = !hasTranslation;
  if (!hasTranslation) audioTranslation.value = "original";
  dubVoice.disabled = audioTranslation.value !== "dubbed";
  audioTranslationHelp.textContent = hasTranslation
    ? audioTranslation.value === "dubbed"
      ? "AI voiceover will use the translated caption language."
      : "Original source audio will be preserved."
    : "Choose a translation language to enable dubbing.";
}

videoInput.addEventListener("change", () => {
  const pickedFiles = [...videoInput.files];
  const result = addSelectedFiles(pickedFiles);
  bindSelectedFilesToInterruptedUploads(pickedFiles);
  // iOS Safari does not reliably allow scripts to rebuild FileList via DataTransfer.
  // Keep our own File objects and clear the native control so the same item can be picked again.
  videoInput.value = "";
  if (!result.supported && pickedFiles.length) return toast("Choose a supported video or audio file.");
  if (result.limitReached) toast("KlipPharma holds up to 10 files in one batch.");
  else if (result.added) toast(`${result.added} ${result.added === 1 ? "video" : "videos"} added. ${selectedFiles.length} total.`);
});
["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("drag");
  });
});

dropzone.addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  const result = addSelectedFiles([...files]);
  bindSelectedFilesToInterruptedUploads([...files]);
  if (!result.supported) return toast("Choose video or audio files.");
  if (result.limitReached) toast("KlipPharma holds up to 10 files in one batch.");
  else if (result.added) toast(`${result.added} ${result.added === 1 ? "video" : "videos"} added. ${selectedFiles.length} total.`);
  else toast("That video is already in this batch.");
});

youtubeImportButton.addEventListener("click", async () => {
  const url = youtubeUrl.value.trim();
  if (!url) return toast("Paste your YouTube video link first.");
  if (!youtubeOwnership.checked) return toast("Confirm that you own the video or have permission to use it.");

  youtubeImportButton.disabled = true;
  youtubeImportButton.textContent = "Starting secure import…";
  youtubeImportStatus.classList.remove("hidden");
  youtubeImportStatus.textContent = "Connecting to YouTube. You can download the source MP4 as soon as it is ready.";
  try {
    const settings = new FormData(form);
    const response = await fetch("/api/youtube/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        ownershipConfirmed: true,
        transcribe: youtubeMode.value !== "manual",
        audience: settings.get("audience"),
        goal: settings.get("goal"),
        platform: settings.get("platform"),
        contentType: settings.get("contentType"),
        clipLength: settings.get("clipLength"),
        sourceLanguage: settings.get("sourceLanguage"),
        translationLanguage: settings.get("translationLanguage"),
        audioTranslation: settings.get("audioTranslation"),
        dubVoice: settings.get("dubVoice"),
        watermarkText: settings.get("watermarkText"),
        watermarkPosition: settings.get("watermarkPosition"),
        outputCount: settings.get("outputCount"),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The YouTube import could not start.");
    currentProjects = [data.id];
    youtubeUrl.value = "";
    youtubeOwnership.checked = false;
    setView("processing");
    await pollProjects();
  } catch (error) {
    youtubeImportStatus.textContent = error.message || "The YouTube import could not start.";
    toast(youtubeImportStatus.textContent);
  } finally {
    youtubeImportButton.disabled = false;
    youtubeImportButton.innerHTML = "Import my YouTube video <b>→</b>";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFiles.length) return toast("Choose at least one video first.");
  setView("processing");
  try {
    const formData = new FormData(form);
    // Append from app state instead of relying on input.files. This is required on
    // iPhone/iPad Safari, where a programmatically assigned FileList can be ignored.
    formData.delete("videos");
    selectedFiles.forEach((file) => formData.append("videos", file, file.name));
    const fileOptions = selectedFiles.map((file) => ({ transcribe: fileModes.get(fileKey(file)) !== false }));
    formData.set("fileOptions", JSON.stringify(fileOptions));
    let data;
    if (uploadMode === "direct") {
      data = await startManagedUploadBatch(formData, fileOptions);
    } else {
      data = await uploadBatchLocally(formData);
    }
    currentProjects = data.ids || [data.id];
    if (currentProjects.length) await pollProjects();
  } catch (error) {
    toast(error.message || "Upload failed.");
    setView("upload");
  }
});

function uploadBatchLocally(formData) {
  const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  renderUploadTransfer(selectedFiles.map(() => 0), selectedFiles.map((file) => file.size), "Starting upload");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/projects");
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const sourceBytesUploaded = totalBytes * Math.min(1, event.loaded / Math.max(1, event.total));
      let remaining = sourceBytesUploaded;
      const loaded = selectedFiles.map((file) => {
        const value = Math.max(0, Math.min(file.size, remaining));
        remaining -= file.size;
        return value;
      });
      renderUploadTransfer(loaded, selectedFiles.map((file) => file.size), "Uploading to KlipPharma");
    });
    xhr.addEventListener("load", () => {
      const data = xhr.response || safeJson(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error || `Upload failed with status ${xhr.status}.`));
        return;
      }
      renderUploadTransfer(selectedFiles.map((file) => file.size), selectedFiles.map((file) => file.size), "Upload complete · starting processors");
      resolve(data);
    });
    xhr.addEventListener("error", () => reject(new Error("The upload connection was interrupted. Check your connection and try again.")));
    xhr.addEventListener("abort", () => reject(new Error("The upload was canceled.")));
    xhr.send(formData);
  });
}

async function startManagedUploadBatch(formData, fileOptions) {
  $("#stage").textContent = `Preparing ${selectedFiles.length} ${selectedFiles.length === 1 ? "upload" : "uploads"}`;
  $("#progressBar").style.width = "4%";
  $("#progressText").textContent = "Preparing upload";
  $("#processingSummary").textContent = "Keep your browser active until the upload completes. You can use other KlipPharma screens.";
  const settings = uploadSettingsFromForm(formData);
  const response = await fetch("/api/uploads/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: selectedFiles.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
      settings,
      fileOptions,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.code === "CLOUD_UPLOAD_UNAVAILABLE") {
      uploadMode = "local";
      toast("Cloud storage is reconnecting. Using the standard secure upload instead.");
      return uploadBatchLocally(formData);
    }
    throw new Error(data.error || "Could not prepare resumable uploads.");
  }
  const session = data.session;
  uploadManager.sessions.set(session.id, session);
  uploadManager.activeSessionId = session.id;
  uploadManager.paused = false;
  uploadManager.cancelled = false;
  session.files.forEach((file, index) => {
    uploadManager.fileHandles.set(file.id, selectedFiles[index]);
  });
  persistUploadManagerSnapshot();
  renderManagedUploadSession(session);
  renderGlobalUploadManager();
  runManagedUploadSession(session.id).catch((error) => {
    toast(error.message || "Upload interrupted — reconnect to resume.");
    renderGlobalUploadManager();
  });
  return { batchId: session.batchId, ids: [] };
}

function uploadSettingsFromForm(formData) {
  return {
    audience: formData.get("audience"),
    goal: formData.get("goal"),
    platform: formData.get("platform"),
    contentType: formData.get("contentType"),
    clipLength: formData.get("clipLength"),
    createMontage: formData.get("createMontage") === "true",
    montageLength: formData.get("montageLength"),
    montageStyle: formData.get("montageStyle"),
    montageTransition: formData.get("montageTransition"),
    watermarkText: formData.get("watermarkText"),
    watermarkPosition: formData.get("watermarkPosition"),
    sourceLanguage: formData.get("sourceLanguage"),
    translationLanguage: formData.get("translationLanguage"),
    audioTranslation: formData.get("audioTranslation"),
    dubVoice: formData.get("dubVoice"),
    outputCount: formData.get("outputCount"),
  };
}

async function runManagedUploadSession(sessionId) {
  if (uploadManager.runningSessionIds.has(sessionId)) return;
  const session = uploadManager.sessions.get(sessionId);
  if (!session) return;
  uploadManager.runningSessionIds.add(sessionId);
  const results = [];
  try {
    let nextIndex = 0;
    let firstError = null;
    const mobileTransfer = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      || window.matchMedia?.("(max-width: 760px)")?.matches;
    const workerCount = mobileTransfer ? 1 : Math.min(2, session.files.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < session.files.length && !uploadManager.cancelled) {
        const index = nextIndex;
        nextIndex += 1;
        const fileState = session.files[index];
        if (fileState.projectId || fileState.status === "cancelled") continue;
        try {
          const result = await uploadManagedFile(session, fileState);
          if (result?.id) {
            results.push(result.id);
            currentProjects = [...new Set([...currentProjects, result.id])];
            pollProjects();
          }
        } catch (error) {
          firstError ||= error;
        }
      }
    }));
    if (results.length) {
      $("#processingSummary").textContent = "Upload complete. KlipPharma will keep processing—even if you close this page.";
      renderGlobalUploadManager();
    }
    if (!results.length && firstError) throw firstError;
  } finally {
    uploadManager.runningSessionIds.delete(sessionId);
  }
}

async function uploadManagedFile(session, fileState) {
  const file = uploadManager.fileHandles.get(fileState.id);
  if (!file) {
    fileState.status = "interrupted";
    fileState.error = "Upload interrupted — reopen KlipPharma and reselect this file to resume.";
    renderManagedUploadSession(session);
    persistUploadManagerSnapshot();
    throw new Error(`${fileState.name} needs to be reselected before it can resume.`);
  }
  const completed = new Set((fileState.completedParts || []).map((part) => Number(part.partNumber)));
  for (let partNumber = 1; partNumber <= fileState.totalParts; partNumber += 1) {
    if (uploadManager.cancelled || fileState.status === "cancelled") throw new Error("Upload cancelled.");
    while (uploadManager.paused || fileState.status === "paused") {
      fileState.status = "paused";
      renderManagedUploadSession(session);
      await waitForUploadRetry(400);
    }
    if (completed.has(partNumber)) continue;
    await uploadManagedPartWithRetry(session, fileState, file, partNumber);
  }
  const response = await fetch(`/api/uploads/sessions/${session.id}/files/${fileState.id}/complete`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Could not finalize ${fileState.name}.`);
  mergeUploadSession(data.session);
  renderManagedUploadSession(uploadManager.sessions.get(session.id));
  renderGlobalUploadManager();
  persistUploadManagerSnapshot();
  return data;
}

async function uploadManagedPartWithRetry(session, fileState, file, partNumber) {
  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const start = (partNumber - 1) * fileState.partSize;
      const end = Math.min(fileState.size, start + fileState.partSize);
      const presign = await fetch(`/api/uploads/sessions/${session.id}/files/${fileState.id}/parts/${partNumber}`, { method: "POST" });
      const prepared = await presign.json();
      if (!presign.ok) throw new Error(prepared.error || `Could not prepare ${fileState.name}.`);
      const etag = await uploadPartDirectly(prepared.uploadUrl, file.slice(start, end), fileState.type, (loaded) => {
        const committed = (fileState.completedParts || []).reduce((sum, part) => sum + Number(part.size || 0), 0);
        fileState.uploadedBytes = Math.min(fileState.size, committed + loaded);
        fileState.status = "uploading";
        renderManagedUploadSession(session);
        renderGlobalUploadManager();
      });
      const record = await fetch(`/api/uploads/sessions/${session.id}/files/${fileState.id}/parts/${partNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etag, size: end - start }),
      });
      const data = await record.json();
      if (!record.ok) throw new Error(data.error || `Could not record ${fileState.name}.`);
      mergeUploadSession(data.session);
      persistUploadManagerSnapshot();
      return;
    } catch (error) {
      lastError = error;
      fileState.retryCount = Number(fileState.retryCount || 0) + 1;
      if (attempt < attempts) await waitForUploadRetry(700 * attempt);
    }
  }
  fileState.status = "failed";
  fileState.error = lastError?.message || "Upload failed.";
  renderManagedUploadSession(session);
  persistUploadManagerSnapshot();
  throw lastError;
}

function uploadPartDirectly(url, blob, type, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let stalled = false;
    let lastProgressAt = Date.now();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearInterval(stallTimer);
      callback(value);
    };
    xhr.open("PUT", url);
    xhr.timeout = 120_000;
    xhr.setRequestHeader("Content-Type", type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      lastProgressAt = Date.now();
      if (event.lengthComputable) onProgress(event.loaded);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size);
        finish(resolve, (xhr.getResponseHeader("ETag") || "").replace(/^"+|"+$/g, ""));
      } else {
        finish(reject, new Error(`Upload part failed with HTTP ${xhr.status || "unknown"}.`));
      }
    });
    xhr.addEventListener("error", () => finish(reject, new Error("Upload interrupted — reconnecting and retrying.")));
    xhr.addEventListener("timeout", () => finish(reject, new Error("Upload part timed out — retrying automatically.")));
    xhr.addEventListener("abort", () => finish(reject, new Error(stalled
      ? "Upload stopped making progress — retrying automatically."
      : "The upload was canceled.")));
    const stallTimer = setInterval(() => {
      if (settled || Date.now() - lastProgressAt < 45_000) return;
      stalled = true;
      xhr.abort();
    }, 5_000);
    xhr.send(blob);
  });
}

function mergeUploadSession(session) {
  if (!session?.id) return null;
  const current = uploadManager.sessions.get(session.id);
  if (current) {
    session.files.forEach((file) => {
      if (uploadManager.fileHandles.has(file.id)) return;
      const existing = current.files?.find((item) => item.id === file.id);
      if (existing && uploadManager.fileHandles.has(existing.id)) {
        uploadManager.fileHandles.set(file.id, uploadManager.fileHandles.get(existing.id));
      }
    });
  }
  uploadManager.sessions.set(session.id, session);
  return session;
}

function renderManagedUploadSession(session) {
  if (!session) return;
  const totalByFile = session.files.map((file) => file.size);
  const loadedByFile = session.files.map((file) => Math.min(file.size, Number(file.uploadedBytes || 0)));
  const uploaded = loadedByFile.reduce((sum, value) => sum + value, 0);
  const total = totalByFile.reduce((sum, value) => sum + value, 0);
  const percent = total ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
  const uploadComplete = session.files.every((file) => file.projectId || file.status === "queued_for_processing");
  $("#stage").textContent = uploadComplete ? "Queued for processing — safe to leave" : "Uploading from this device";
  $("#progressBar").style.width = `${percent}%`;
  $("#progressText").textContent = `${percent}% uploaded · ${formatBytes(uploaded)} of ${formatBytes(total)}`;
  $("#processingSummary").textContent = uploadComplete
    ? "Upload complete. KlipPharma will keep processing—even if you close this page."
    : "Keep your browser active until the upload completes. You can use other KlipPharma screens.";
  const statusBox = $("#batchStatus");
  statusBox.innerHTML = "";
  session.files.forEach((file) => {
    const filePercent = file.size ? Math.min(100, Math.round((Number(file.uploadedBytes || 0) / file.size) * 100)) : 0;
    const row = document.createElement("div");
    row.className = `batch-row ${uploadRowClass(file.status)}`;
    row.innerHTML = `<span class="batch-row-main"><b class="batch-row-name"></b><small class="batch-row-stage"></small></span><strong class="batch-row-status"></strong><span class="batch-row-progress"><i style="width:${filePercent}%"></i></span>`;
    row.querySelector(".batch-row-name").textContent = file.name;
    row.querySelector(".batch-row-stage").textContent = uploadStateCopy(file);
    row.querySelector(".batch-row-status").textContent = file.projectId ? "Queued" : `${filePercent}%`;
    if (file.error) {
      const error = document.createElement("p");
      error.className = "batch-row-error";
      error.textContent = file.error;
      row.append(error);
    }
    statusBox.append(row);
  });
}

function uploadRowClass(status) {
  if (status === "failed" || status === "interrupted") return "failed";
  if (status === "queued_for_processing") return "queued";
  return "uploading";
}

function uploadStateCopy(file) {
  if (file.projectId || file.status === "queued_for_processing") return "Queued for processing — safe to leave";
  if (file.status === "uploaded") return "Upload complete";
  if (file.status === "paused") return "Upload paused";
  if (file.status === "interrupted") return "Upload interrupted — reconnect to resume";
  if (file.status === "failed") return file.error || "Failed";
  if (file.status === "ready_to_upload" || file.status === "preparing") return "Preparing upload";
  return `Uploading from this device · ${formatBytes(file.uploadedBytes || 0)} of ${formatBytes(file.size)}`;
}

function renderGlobalUploadManager() {
  const session = selectUploadSessionNeedingDevice(uploadManager.sessions.values(), uploadManager.activeSessionId);
  if (!session) {
    uploadManager.activeSessionId = null;
    globalUploadManagerPanel?.classList.add("hidden");
    return;
  }
  uploadManager.activeSessionId = session.id;
  const total = session.files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const loaded = session.files.reduce((sum, file) => sum + Math.min(Number(file.size || 0), Number(file.uploadedBytes || 0)), 0);
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const completeCount = session.files.filter((file) => file.projectId || file.status === "queued_for_processing").length;
  const pendingCount = session.files.filter(uploadFileNeedsDevice).length;
  const interruptedCount = session.files.filter((file) => uploadFileNeedsDevice(file) && ["failed", "interrupted"].includes(file.status)).length;
  const active = session.files.some((file) => uploadFileNeedsDevice(file) && ["uploading", "ready_to_upload", "preparing", "paused"].includes(file.status));
  globalUploadManagerPanel?.classList.remove("hidden");
  $("#globalUploadState").textContent = interruptedCount ? "UPLOAD NEEDS ATTENTION" : "UPLOADS ACTIVE";
  $("#globalUploadTitle").textContent = interruptedCount
    ? `${interruptedCount} ${interruptedCount === 1 ? "video needs" : "videos need"} to resume`
    : `${completeCount} of ${session.files.length} safely uploaded`;
  $("#globalUploadDetail").textContent = interruptedCount
    ? "Return to the upload screen and reselect the interrupted file. Completed videos are safe."
    : active
    ? `Keep your browser active until upload completes. ${formatBytes(loaded)} of ${formatBytes(total)} transferred.`
    : `${pendingCount} ${pendingCount === 1 ? "video still needs" : "videos still need"} this device to finish uploading.`;
  $("#globalUploadMeter").style.width = `${percent}%`;
  globalUploadPause.disabled = uploadManager.paused || !active;
  globalUploadResume.disabled = !uploadManager.paused;
  globalUploadCancel.disabled = !active;
}

function persistUploadManagerSnapshot() {
  const sessions = [...uploadManager.sessions.values()].map((session) => ({
    ...session,
    files: session.files.map((file) => ({ ...file, needsReselect: !file.projectId && !uploadManager.fileHandles.has(file.id) })),
  }));
  localStorage.setItem("klippharmaUploadSessions", JSON.stringify({ activeSessionId: uploadManager.activeSessionId, sessions }));
}

function restoreUploadManagerSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem("klippharmaUploadSessions") || "{}");
    uploadManager.activeSessionId = snapshot.activeSessionId || null;
    (snapshot.sessions || []).forEach((session) => uploadManager.sessions.set(session.id, session));
    renderGlobalUploadManager();
  } catch {
    localStorage.removeItem("klippharmaUploadSessions");
  }
}

async function loadActiveUploadSessions() {
  try {
    const response = await fetch("/api/uploads/sessions");
    const data = await response.json();
    if (!response.ok) return;
    (data.sessions || []).forEach((session) => {
      mergeUploadSession(session);
      if (!uploadManager.activeSessionId) uploadManager.activeSessionId = session.id;
    });
    persistUploadManagerSnapshot();
    renderGlobalUploadManager();
  } catch {
    renderGlobalUploadManager();
  }
}

function bindSelectedFilesToInterruptedUploads(files) {
  if (!files?.length) return;
  let resumedSessionId = null;
  const sessions = [...uploadManager.sessions.values()]
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  for (const session of sessions) {
    let matchedFiles = 0;
    for (const fileState of session.files || []) {
      if (fileState.projectId || uploadManager.fileHandles.has(fileState.id)) continue;
      const match = files.find((file) => (
        file.name === fileState.name
        && file.size === fileState.size
        && (!fileState.lastModified || file.lastModified === fileState.lastModified)
        && (!fileState.type || fileState.type === "application/octet-stream" || !file.type || file.type === fileState.type)
      ));
      if (!match) continue;
      uploadManager.fileHandles.set(fileState.id, match);
      if (fileState.status === "interrupted") fileState.status = fileState.uploadedBytes ? "uploading" : "ready_to_upload";
      fileState.error = null;
      resumedSessionId = session.id;
      matchedFiles += 1;
    }
    if (matchedFiles) break;
  }
  if (!resumedSessionId) return;
  uploadManager.activeSessionId = resumedSessionId;
  uploadManager.paused = false;
  uploadManager.cancelled = false;
  const session = uploadManager.sessions.get(resumedSessionId);
  persistUploadManagerSnapshot();
  renderManagedUploadSession(session);
  renderGlobalUploadManager();
  toast("Matched the interrupted upload. Resuming from completed parts.");
  setView("processing");
  runManagedUploadSession(resumedSessionId).catch((error) => toast(error.message || "Could not resume upload."));
}

async function updateActiveUploadFiles(action) {
  const session = uploadManager.sessions.get(uploadManager.activeSessionId);
  if (!session) return;
  if (action === "pause") uploadManager.paused = true;
  if (action === "resume") uploadManager.paused = false;
  if (action === "cancel") {
    uploadManager.cancelled = true;
    if (!window.confirm("Cancel the active upload batch? Already queued projects will continue processing.")) {
      uploadManager.cancelled = false;
      return;
    }
  }
  const activeFiles = session.files.filter((file) => !file.projectId && file.status !== "cancelled");
  await Promise.all(activeFiles.map(async (file) => {
    const response = await fetch(`/api/uploads/sessions/${session.id}/files/${file.id}/${action}`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.session) mergeUploadSession(data.session);
  }));
  renderManagedUploadSession(uploadManager.sessions.get(session.id));
  renderGlobalUploadManager();
  persistUploadManagerSnapshot();
  if (action === "resume") runManagedUploadSession(session.id).catch((error) => toast(error.message || "Could not resume upload."));
}


function renderUploadTransfer(loadedByFile, totalByFile, label) {
  const loaded = loadedByFile.reduce((sum, value) => sum + Number(value || 0), 0);
  const total = totalByFile.reduce((sum, value) => sum + Number(value || 0), 0);
  const percent = total ? (loaded >= total ? 100 : Math.min(99, Math.round((loaded / total) * 100))) : 0;
  $("#stage").textContent = `${label} · ${loadedByFile.filter((value, index) => value >= totalByFile[index]).length} of ${loadedByFile.length} transferred`;
  $("#progressBar").style.width = `${percent}%`;
  $("#progressText").textContent = `${percent}% uploaded · ${formatBytes(loaded)} of ${formatBytes(total)}`;
  $("#processingSummary").textContent = "Keep this page open while your source files transfer. Processing starts automatically.";
  const statusBox = $("#batchStatus");
  statusBox.innerHTML = "";
  selectedFiles.forEach((file, index) => {
    const filePercent = totalByFile[index] ? Math.min(100, Math.round((loadedByFile[index] / totalByFile[index]) * 100)) : 0;
    const row = document.createElement("div");
    row.className = "batch-row uploading";
    row.innerHTML = `<span class="batch-row-main"><b class="batch-row-name"></b><small class="batch-row-stage"></small></span><strong class="batch-row-status">${filePercent}%</strong><span class="batch-row-progress"><i style="width:${filePercent}%"></i></span>`;
    row.querySelector(".batch-row-name").textContent = file.name;
    row.querySelector(".batch-row-stage").textContent = `${formatBytes(loadedByFile[index])} of ${formatBytes(totalByFile[index])}`;
    statusBox.append(row);
  });
}

function safeJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function pollProjects() {
  try {
    const projects = await Promise.all(currentProjects.map(async (id) => {
      const response = await fetch(`/api/projects/${id}`);
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "Could not load a project.");
      return project;
    }));
    notifyReadyProjects(projects);
    renderBatchStatus(projects);
    const sourcesFinished = projects.every((project) => project.status === "ready" || project.status === "failed" || project.status === "source_auth_required");
    const montage = projects.find((project) => project.montage)?.montage;
    const montageFinished = !montage || montage.status === "ready" || montage.status === "failed";
    const managedSession = managedSessionForProjects(projects);
    const uploadFinished = !managedSession || managedSession.files.every((file) => (
      file.projectId || file.status === "queued_for_processing" || file.status === "failed" || file.status === "cancelled"
    ));
    const finished = uploadFinished && sourcesFinished && montageFinished;
    if (finished) {
      const successful = projects.filter((project) => project.status === "ready");
      if (!successful.length) {
        toast(projects[0]?.error || "The batch could not be processed.");
        processingView.setAttribute("aria-busy", "false");
        processingBack.classList.remove("hidden");
        return;
      }
      processingView.setAttribute("aria-busy", "false");
      processingBack.classList.add("hidden");
      renderResults(successful);
      setView("results");
      loadRecentProjects();
      const failedCount = projects.length - successful.length;
      if (failedCount) toast(`${failedCount} ${failedCount === 1 ? "video could" : "videos could"} not be processed. The completed results are ready.`);
      return;
    }
    pollTimer = setTimeout(pollProjects, 1800);
  } catch (error) {
    toast(error.message || "Could not check the batch.");
    pollTimer = setTimeout(pollProjects, 2500);
  }
}

function managedSessionForProjects(projects) {
  const batchIds = new Set((projects || []).map((project) => String(project?.batchId || "")).filter(Boolean));
  const projectIds = new Set((projects || []).map((project) => String(project?.id || "")).filter(Boolean));
  return [...uploadManager.sessions.values()].find((session) => (
    batchIds.has(String(session?.batchId || ""))
      || (session?.files || []).some((file) => file?.projectId && projectIds.has(String(file.projectId)))
  )) || null;
}

function renderBatchStatus(projects) {
  const failed = projects.filter((project) => project.status === "failed" || project.status === "source_auth_required").length;
  const progressValues = projects.map((project) => (
    project.status === "failed" || project.status === "source_auth_required" ? Math.min(95, Number(project.progress || 0)) : Number(project.progress || 0)
  ));
  const average = Math.round(progressValues.reduce((sum, progress) => sum + progress, 0) / projects.length);
  const ready = projects.filter((project) => project.status === "ready").length;
  const active = projects.filter((project) => project.status === "processing").length;
  const queued = projects.filter((project) => project.status === "queued").length;
  const montage = projects.find((project) => project.montage)?.montage;
  const buildingMontage = montage && (montage.status === "waiting" || montage.status === "rendering");
  $("#stage").textContent = buildingMontage
    ? montage.status === "rendering" ? "Building one Auto-Mix from your batch" : "Auto-Mix is waiting for every source"
    : failed && ready + failed === projects.length
      ? `${failed} ${failed === 1 ? "video needs" : "videos need"} attention`
    : ready
    ? `${ready} of ${projects.length} videos ready`
    : active
      ? `Processing ${projects.length} ${projects.length === 1 ? "video" : "videos"}`
      : "Your batch is queued";
  $("#progressBar").…33388 tokens truncated…avatar-slot");
  if (profile.avatarUrl) {
    const image = document.createElement("img");
    image.src = profile.avatarUrl;
    image.alt = "";
    avatarSlot.append(image);
  } else {
    avatarSlot.innerHTML = '<span class="avatar-fallback">♪</span>';
  }
  body.querySelector("strong").textContent = profile.displayName || "TikTok creator";
  body.querySelector(".verified-badge").classList.toggle("hidden", profile.verified !== true);
  const username = body.querySelector(".tiktok-username");
  if (hasProfile && profile.username) {
    username.textContent = `@${profile.username}`;
  } else {
    username.classList.add("hidden");
  }
  if (hasProfile && profile.bio) {
    body.querySelector(".tiktok-bio").textContent = profile.bio;
    body.querySelector(".tiktok-bio").classList.remove("hidden");
  }
  if (hasProfile && profile.profileUrl) {
    const link = body.querySelector(".tiktok-profile-link");
    link.href = profile.profileUrl;
    link.classList.remove("hidden");
  }
  const openId = body.querySelector(".tiktok-open-id");
  if (!profile.username && profile.openId) openId.textContent = `Internal TikTok ID: ${profile.openId}`;
  else openId.classList.add("hidden");
  const readiness = body.querySelector(".integration-readiness");
  if (canDirect) readiness.append(readinessBadge("Direct Post ready"));
  else readiness.append(readinessBadge("Direct Post unavailable", true));
  if (canInbox) readiness.append(readinessBadge("Inbox Upload ready"));
  else readiness.append(readinessBadge("Inbox Upload unavailable", true));
  if (hasStats && tiktok.stats) {
    const stats = body.querySelector(".tiktok-stats-row");
    stats.classList.remove("hidden");
    [
      ["Followers", tiktok.stats.followers],
      ["Following", tiktok.stats.following],
      ["Likes", tiktok.stats.likes],
      ["Videos", tiktok.stats.videos],
    ].forEach(([label, value]) => {
      const item = document.createElement("span");
      item.innerHTML = `<b></b><small></small>`;
      item.querySelector("b").textContent = formatTikTokCount(value);
      item.querySelector("small").textContent = label;
      stats.append(item);
    });
  }
  if (hasVideos) {
    body.querySelector(".recent-tiktok-videos").classList.remove("hidden");
    loadTikTokVideos();
  }
  body.querySelector(".scope-list").textContent = `Granted scopes: ${scopes.length ? scopes.join(", ") : "none reported"}`;
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "secondary";
  refresh.textContent = "Refresh TikTok";
  refresh.addEventListener("click", refreshTikTok);
  const disconnect = document.createElement("button");
  disconnect.type = "button";
  disconnect.className = "danger-secondary";
  disconnect.textContent = "Disconnect";
  disconnect.addEventListener("click", disconnectTikTok);
  actions.append(refresh, disconnect);
}

function renderYouTubeIntegration(youtube) {
  const body = $("#youtubeIntegrationBody");
  const actions = $("#youtubeIntegrationActions");
  body.innerHTML = "";
  actions.innerHTML = "";
  if (!youtube?.connected) {
    body.innerHTML = `<span class="status-badge muted">Not connected</span><p>Connect a Google account with YouTube Data API access. KlipPharma stores OAuth tokens server-side and requests readonly plus upload permissions.</p>`;
    const connect = document.createElement("button");
    connect.className = "primary integration-primary";
    connect.type = "button";
    connect.textContent = "Connect YouTube →";
    connect.addEventListener("click", () => {
      window.location.assign("/api/integrations/youtube/oauth/start?returnTo=%2F%3Fsettings%3Dintegrations");
    });
    actions.append(connect);
    return;
  }
  const channel = youtube.channel || {};
  const scopes = youtube.scopes || [];
  const canUpload = scopes.includes("https://www.googleapis.com/auth/youtube.upload");
  body.innerHTML = `
    <span class="status-badge connected">Connected</span>
    <div class="connected-profile tiktok-profile-card youtube-profile-card">
      <div class="youtube-avatar-slot"></div>
      <div class="tiktok-profile-main">
        <div class="tiktok-name-line"><strong></strong></div>
        <small class="youtube-handle"></small>
        <p class="tiktok-bio hidden"></p>
        <a class="tiktok-profile-link hidden" target="_blank" rel="noopener noreferrer">View YouTube Channel</a>
      </div>
    </div>
    <div class="dashboard-readiness integration-readiness"></div>
    <div class="tiktok-stats-row youtube-stats-row"></div>
    <div class="recent-tiktok-videos recent-youtube-videos">
      <div class="section-mini-head"><strong>Recent YouTube Videos</strong><small></small></div>
      <div class="tiktok-video-list youtube-video-list">Loading recent videos…</div>
    </div>
    <p class="scope-list"></p>
  `;
  const avatarSlot = body.querySelector(".youtube-avatar-slot");
  if (channel.avatarUrl) {
    const image = document.createElement("img");
    image.src = channel.avatarUrl;
    image.alt = "";
    avatarSlot.append(image);
  } else {
    avatarSlot.innerHTML = '<span class="avatar-fallback youtube-fallback">▶</span>';
  }
  body.querySelector("strong").textContent = channel.title || "YouTube channel";
  const handle = body.querySelector(".youtube-handle");
  handle.textContent = channel.handle || "Channel identity connected";
  if (channel.description) {
    body.querySelector(".tiktok-bio").textContent = channel.description;
    body.querySelector(".tiktok-bio").classList.remove("hidden");
  }
  if (channel.channelUrl) {
    const link = body.querySelector(".tiktok-profile-link");
    link.href = channel.channelUrl;
    link.classList.remove("hidden");
  }
  const readiness = body.querySelector(".integration-readiness");
  if (canUpload) readiness.append(readinessBadge("Upload ready"));
  else readiness.append(readinessBadge("Upload unavailable", true));
  const stats = body.querySelector(".youtube-stats-row");
  [
    ["Subscribers", youtube.stats?.hiddenSubscribers ? "Hidden" : formatTikTokCount(youtube.stats?.subscribers)],
    ["Views", formatTikTokCount(youtube.stats?.views)],
    ["Videos", formatTikTokCount(youtube.stats?.videos)],
  ].forEach(([label, value]) => {
    const item = document.createElement("span");
    item.innerHTML = `<b></b><small></small>`;
    item.querySelector("b").textContent = value;
    item.querySelector("small").textContent = label;
    stats.append(item);
  });
  loadYouTubeVideos();
  body.querySelector(".scope-list").textContent = `Granted scopes: ${scopes.length ? scopes.join(", ") : "none reported"}`;
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "secondary";
  refresh.textContent = "Refresh YouTube";
  refresh.addEventListener("click", refreshYouTube);
  const disconnect = document.createElement("button");
  disconnect.type = "button";
  disconnect.className = "danger-secondary";
  disconnect.textContent = "Disconnect";
  disconnect.addEventListener("click", disconnectYouTube);
  actions.append(refresh, disconnect);
}

async function refreshYouTube() {
  const response = await fetch("/api/integrations/youtube/refresh", { method: "POST" });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Could not refresh YouTube.");
  integrationsState = { ...integrationsState, youtube: data.youtube };
  renderYouTubeIntegration(data.youtube);
  if (!dashboardModal.classList.contains("hidden")) renderDashboardPublishing(integrationsState, currentDashboardProjects);
  toast("YouTube refreshed.");
}

async function loadYouTubeVideos() {
  const list = $("#youtubeIntegrationBody .youtube-video-list");
  const summary = $("#youtubeIntegrationBody .section-mini-head small");
  if (!list) return;
  try {
    const response = await fetch("/api/integrations/youtube/videos");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load recent YouTube videos.");
    renderYouTubeVideos(data.videos || []);
    if (summary) summary.textContent = `${(data.videos || []).length} recent uploads`;
  } catch (error) {
    list.textContent = error.message || "Could not load recent YouTube videos.";
  }
}

function renderYouTubeVideos(videos) {
  const list = $("#youtubeIntegrationBody .youtube-video-list");
  if (!list) return;
  list.innerHTML = "";
  if (!videos.length) {
    list.innerHTML = "<p>No recent YouTube uploads were returned for this channel.</p>";
    return;
  }
  videos.forEach((video) => {
    const item = document.createElement("article");
    item.className = "tiktok-video-card youtube-video-card";
    const media = document.createElement(video.url ? "a" : "div");
    media.className = "tiktok-video-cover youtube-video-cover";
    if (video.url) {
      media.href = video.url;
      media.target = "_blank";
      media.rel = "noopener noreferrer";
      media.setAttribute("aria-label", "Open YouTube video");
    }
    if (video.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = video.thumbnailUrl;
      image.alt = "";
      media.append(image);
    } else {
      media.textContent = "YouTube";
    }
    const copy = document.createElement("div");
    copy.className = "tiktok-video-copy youtube-video-copy";
    const title = document.createElement("strong");
    title.textContent = video.title || "YouTube video";
    const meta = document.createElement("small");
    meta.textContent = [formatYouTubeDate(video.publishedAt), formatYouTubeDuration(video.duration)]
      .filter(Boolean)
      .join(" · ");
    const description = document.createElement("p");
    description.textContent = video.description || "";
    const metrics = document.createElement("small");
    metrics.textContent = `${formatTikTokCount(video.views)} views · ${formatTikTokCount(video.likes)} likes · ${formatTikTokCount(video.comments)} comments`;
    copy.append(title, meta, description, metrics);
    if (video.url) {
      const link = document.createElement("a");
      link.href = video.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open on YouTube";
      copy.append(link);
    }
    item.append(media, copy);
    list.append(item);
  });
}

async function disconnectYouTube() {
  if (!confirm("Disconnect YouTube from KlipPharma?")) return;
  const response = await fetch("/api/integrations/youtube", { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Could not disconnect YouTube.");
  await loadIntegrationsStatus();
  toast("YouTube disconnected.");
}

async function refreshTikTok() {
  const response = await fetch("/api/integrations/tiktok/refresh", { method: "POST" });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Could not refresh TikTok.");
  integrationsState = { ...integrationsState, tiktok: data.tiktok };
  renderTikTokIntegration(data.tiktok);
  toast("TikTok refreshed.");
}

async function loadTikTokVideos() {
  const list = $("#tiktokIntegrationBody .tiktok-video-list");
  const summary = $("#tiktokIntegrationBody .section-mini-head small");
  if (!list) return;
  try {
    const response = await fetch("/api/integrations/tiktok/videos");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load recent TikTok videos.");
    renderTikTokVideos(data.videos || []);
    if (summary) summary.textContent = data.hasMore ? "Showing latest videos" : `${(data.videos || []).length} available`;
  } catch (error) {
    list.textContent = error.message || "Could not load recent TikTok videos.";
  }
}

function renderTikTokVideos(videos) {
  const list = $("#tiktokIntegrationBody .tiktok-video-list");
  if (!list) return;
  list.innerHTML = "";
  if (!videos.length) {
    list.innerHTML = "<p>No public TikTok videos were returned for this account.</p>";
    return;
  }
  videos.forEach((video) => {
    const item = document.createElement("article");
    item.className = "tiktok-video-card";
    const media = document.createElement(video.shareUrl ? "a" : "div");
    media.className = "tiktok-video-cover";
    if (video.shareUrl) {
      media.href = video.shareUrl;
      media.target = "_blank";
      media.rel = "noopener noreferrer";
      media.setAttribute("aria-label", "Open TikTok video");
    }
    if (video.coverImageUrl) {
      const image = document.createElement("img");
      image.src = video.coverImageUrl;
      image.alt = "";
      media.append(image);
    } else {
      media.textContent = "TikTok";
    }
    const copy = document.createElement("div");
    copy.className = "tiktok-video-copy";
    const title = document.createElement("strong");
    title.textContent = video.title || video.description || "TikTok video";
    const meta = document.createElement("small");
    meta.textContent = [formatTikTokDate(video.createTime), formatTikTokDuration(video.duration)]
      .filter(Boolean)
      .join(" · ");
    const description = document.createElement("p");
    description.textContent = video.description || "";
    const metrics = document.createElement("small");
    metrics.textContent = `${formatTikTokCount(video.views)} views · ${formatTikTokCount(video.likes)} likes · ${formatTikTokCount(video.comments)} comments · ${formatTikTokCount(video.shares)} shares`;
    copy.append(title, meta, description, metrics);
    if (video.shareUrl) {
      const link = document.createElement("a");
      link.href = video.shareUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open on TikTok";
      copy.append(link);
    }
    item.append(media, copy);
    list.append(item);
  });
}

function formatTikTokCount(value) {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : "n/a";
}

function formatTikTokDate(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTikTokDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

async function disconnectTikTok() {
  if (!confirm("Disconnect TikTok from KlipPharma?")) return;
  const response = await fetch("/api/integrations/tiktok", { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Could not disconnect TikTok.");
  await loadIntegrationsStatus();
  toast("TikTok disconnected.");
}

async function openTikTokPublish(target) {
  tiktokPublishTarget = target;
  tiktokCreatorInfo = null;
  tiktokPublishModal.classList.remove("hidden");
  $("#tiktokPublishError").classList.add("hidden");
  $("#tiktokPublishStatus").classList.add("hidden");
  $("#tiktokPublishTarget").textContent = `${target.targetType === "montage" ? "Auto-Mix" : "Klip"}: ${target.title}`;
  $("#tiktokCaption").value = target.title || "";
  $("#tiktokPostMode").innerHTML = "";
  $("#tiktokPrivacy").innerHTML = '<option value="">Loading creator options…</option>';
  tiktokConsent.checked = false;
  ["#tiktokAllowComment", "#tiktokAllowDuet", "#tiktokAllowStitch", "#tiktokAiGenerated", "#tiktokBrandOrganic", "#tiktokBrandContent"]
    .forEach((selector) => { $(selector).checked = false; $(selector).disabled = false; });
  await loadIntegrationsStatus();
  const tiktok = integrationsState?.tiktok;
  if (!tiktok?.connected) {
    $("#tiktokPublishConnection").innerHTML = 'TikTok is not connected. Open Settings > Integrations and authorize a creator account first.';
    $("#tiktokSubmitButton").disabled = true;
    return;
  }
  const scopes = tiktok.scopes || [];
  const canUpload = hasTikTokScope("video.upload");
  const canDirect = hasTikTokScope("video.publish");
  renderTikTokModeOptions(scopes);
  $("#tiktokPublishConnection").innerHTML = `Connected as <strong>${tiktok.profile?.displayName || "TikTok creator"}</strong>. Granted scopes: ${scopes.join(", ") || "none reported"}.`;
  if (!canDirect) {
    $("#tiktokPublishConnection").innerHTML += "<br><small>Direct Post requires the video.publish scope. Inbox Upload remains available when video.upload is granted.</small>";
  }
  if (!canUpload && !canDirect) {
    $("#tiktokPublishConnection").innerHTML += "<br><small>This TikTok authorization cannot upload or publish video. Reconnect and approve video.upload or video.publish.</small>";
  }
  if (canDirect) await loadTikTokCreatorInfo();
  else {
    tiktokCreatorInfo = null;
    renderTikTokPrivacyOptions([]);
  }
  paintTikTokPublishMode();
  paintTikTokPublishButton();
}

function hasTikTokScope(scope) {
  return (integrationsState?.tiktok?.scopes || []).includes(scope);
}

function renderTikTokModeOptions(scopes = []) {
  const mode = $("#tiktokPostMode");
  mode.innerHTML = "";
  if (scopes.includes("video.upload")) {
    mode.add(new Option("Upload to TikTok inbox", "inbox"));
  }
  if (scopes.includes("video.publish")) {
    mode.add(new Option("Direct post", "direct"));
  }
  if (!mode.options.length) {
    mode.add(new Option("Reconnect TikTok to upload", ""));
  }
  if (scopes.includes("video.upload")) mode.value = "inbox";
  else if (scopes.includes("video.publish")) mode.value = "direct";
  else mode.value = "";
}

async function loadTikTokCreatorInfo() {
  try {
    const response = await fetch("/api/integrations/tiktok/creator-info");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Direct Post creator options unavailable.");
    tiktokCreatorInfo = data.creator || {};
    renderTikTokPrivacyOptions(tiktokCreatorInfo.privacy_level_options || []);
    $("#tiktokAllowComment").disabled = Boolean(tiktokCreatorInfo.comment_disabled);
    $("#tiktokAllowDuet").disabled = Boolean(tiktokCreatorInfo.duet_disabled);
    $("#tiktokAllowStitch").disabled = Boolean(tiktokCreatorInfo.stitch_disabled);
  } catch (error) {
    tiktokCreatorInfo = null;
    renderTikTokPrivacyOptions(["SELF_ONLY"]);
    if (hasTikTokScope("video.upload")) $("#tiktokPostMode").value = "inbox";
    $("#tiktokPublishConnection").innerHTML += `<br><small>${error.message || "Direct Post creator options unavailable. Inbox upload remains available when video.upload is granted."}</small>`;
  }
}

function renderTikTokPrivacyOptions(options) {
  const privacy = $("#tiktokPrivacy");
  privacy.innerHTML = '<option value="">Choose audience manually</option>';
  options.forEach((value) => {
    const label = {
      PUBLIC_TO_EVERYONE: "Public to everyone",
      MUTUAL_FOLLOW_FRIENDS: "Friends",
      FOLLOWER_OF_CREATOR: "Followers",
      SELF_ONLY: "Only me",
    }[value] || value;
    privacy.add(new Option(label, value));
  });
}

function paintTikTokPublishMode() {
  const requestedMode = $("#tiktokPostMode").value;
  if (requestedMode === "direct" && !hasTikTokScope("video.publish")) {
    $("#tiktokPostMode").value = hasTikTokScope("video.upload") ? "inbox" : "";
  }
  if (requestedMode === "inbox" && !hasTikTokScope("video.upload")) {
    $("#tiktokPostMode").value = hasTikTokScope("video.publish") ? "direct" : "";
  }
  const direct = $("#tiktokPostMode").value === "direct";
  $("#tiktokPrivacy").disabled = !direct;
  ["#tiktokAllowComment", "#tiktokAllowDuet", "#tiktokAllowStitch", "#tiktokAiGenerated", "#tiktokBrandOrganic", "#tiktokBrandContent"]
    .forEach((selector) => {
      const control = $(selector);
      control.closest("label").classList.toggle("muted-control", !direct);
      control.disabled = !direct || (selector === "#tiktokAllowComment" && Boolean(tiktokCreatorInfo?.comment_disabled))
        || (selector === "#tiktokAllowDuet" && Boolean(tiktokCreatorInfo?.duet_disabled))
        || (selector === "#tiktokAllowStitch" && Boolean(tiktokCreatorInfo?.stitch_disabled));
    });
}

function paintTikTokPublishButton() {
  const direct = $("#tiktokPostMode").value === "direct";
  const inbox = $("#tiktokPostMode").value === "inbox";
  const hasConnection = integrationsState?.tiktok?.connected;
  const canUseMode = (direct && hasTikTokScope("video.publish")) || (inbox && hasTikTokScope("video.upload"));
  $("#tiktokSubmitButton").disabled = !hasConnection || !canUseMode || !tiktokConsent.checked || (direct && !$("#tiktokPrivacy").value);
  $("#tiktokSubmitButton").textContent = direct ? "Publish to TikTok →" : "Upload to TikTok inbox →";
}

async function submitTikTokPublish() {
  if (!tiktokPublishTarget) return;
  const button = $("#tiktokSubmitButton");
  const status = $("#tiktokPublishStatus");
  const errorBox = $("#tiktokPublishError");
  button.disabled = true;
  button.textContent = "Sending to TikTok…";
  errorBox.classList.add("hidden");
  status.classList.remove("hidden");
  status.textContent = "Uploading the rendered MP4 to TikTok. Keep this page open.";
  try {
    const mode = $("#tiktokPostMode").value;
    if (mode === "direct" && !hasTikTokScope("video.publish")) throw new Error("Direct Post requires the video.publish scope. Reconnect TikTok and approve video.publish.");
    if (mode === "inbox" && !hasTikTokScope("video.upload")) throw new Error("Inbox Upload requires the video.upload scope. Reconnect TikTok and approve video.upload.");
    if (!mode) throw new Error("Reconnect TikTok with video.upload or video.publish before uploading.");
    const response = await fetch("/api/integrations/tiktok/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...tiktokPublishTarget,
        mode,
        caption: $("#tiktokCaption").value,
        privacyLevel: $("#tiktokPrivacy").value,
        allowComment: $("#tiktokAllowComment").checked,
        allowDuet: $("#tiktokAllowDuet").checked,
        allowStitch: $("#tiktokAllowStitch").checked,
        isAiGenerated: $("#tiktokAiGenerated").checked,
        brandOrganic: $("#tiktokBrandOrganic").checked,
        brandContent: $("#tiktokBrandContent").checked,
        tiktokConsentAccepted: tiktokConsent.checked,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "TikTok upload failed.");
    status.innerHTML = `<strong>${data.message || "TikTok upload started."}</strong><small>Publish ID: ${data.publishId}</small><span id="tiktokLiveStatus">Checking status…</span>`;
    pollTikTokPublishStatus(data.publishId);
  } catch (error) {
    errorBox.textContent = error.message || "TikTok upload failed.";
    errorBox.classList.remove("hidden");
    paintTikTokPublishButton();
  }
}

async function pollTikTokPublishStatus(publishId) {
  const live = $("#tiktokLiveStatus");
  try {
    const response = await fetch("/api/integrations/tiktok/publish/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check status.");
    const tiktokStatus = data.status || {};
    live.textContent = `TikTok status: ${tiktokStatus.status || "processing"}${tiktokStatus.fail_reason ? ` · ${tiktokStatus.fail_reason}` : ""}`;
    const done = new Set(["PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"]).has(tiktokStatus.status);
    if (!done) setTimeout(() => pollTikTokPublishStatus(publishId), 5000);
  } catch (error) {
    live.textContent = error.message || "Could not check TikTok status.";
  }
}

async function openYouTubePublish(target) {
  youtubePublishTarget = target;
  youtubePublishModal.classList.remove("hidden");
  $("#youtubePublishError").classList.add("hidden");
  $("#youtubePublishStatus").classList.add("hidden");
  $("#youtubePublishTarget").textContent = `${target.targetType === "montage" ? "Auto-Mix" : "Klip"}: ${target.title}`;
  $("#youtubeTitle").value = String(target.title || "KlipPharma upload").slice(0, 100);
  $("#youtubeDescription").value = "";
  $("#youtubeTags").value = "KlipPharma";
  $("#youtubeCategory").value = "22";
  $("#youtubePrivacy").value = "private";
  $("#youtubeMadeForKids").checked = false;
  youtubeConsent.checked = false;
  $("#youtubePublishConnection").textContent = "Checking YouTube connection…";
  await loadIntegrationsStatus();
  const youtube = integrationsState?.youtube;
  const scopes = youtube?.scopes || [];
  const canUpload = scopes.includes("https://www.googleapis.com/auth/youtube.upload");
  if (!youtube?.connected) {
    $("#youtubePublishConnection").innerHTML = "YouTube is not connected. Open Settings > Integrations and authorize a channel first.";
    $("#youtubeSubmitButton").disabled = true;
    return;
  }
  $("#youtubePublishConnection").innerHTML = `Connected to <strong>${youtube.channel?.title || "YouTube channel"}</strong>. Granted scopes: ${scopes.join(", ") || "none reported"}.<br><small>Private upload is recommended until Google completes app verification; Google may restrict unverified projects to private videos.</small>`;
  if (!canUpload) {
    $("#youtubePublishConnection").innerHTML += "<br><small>Publishing requires the youtube.upload scope. Reconnect YouTube and approve upload access.</small>";
  }
  paintYouTubePublishButton();
}

function paintYouTubePublishButton() {
  const scopes = integrationsState?.youtube?.scopes || [];
  const canUpload = integrationsState?.youtube?.connected
    && scopes.includes("https://www.googleapis.com/auth/youtube.upload");
  $("#youtubeSubmitButton").disabled = !canUpload || !youtubeConsent.checked || !$("#youtubeTitle").value.trim();
}

async function submitYouTubePublish() {
  if (!youtubePublishTarget) return;
  const button = $("#youtubeSubmitButton");
  const status = $("#youtubePublishStatus");
  const errorBox = $("#youtubePublishError");
  button.disabled = true;
  button.textContent = "Uploading to YouTube…";
  errorBox.classList.add("hidden");
  status.classList.remove("hidden");
  status.textContent = "Starting a resumable YouTube upload. Keep this page open.";
  try {
    const scopes = integrationsState?.youtube?.scopes || [];
    if (!scopes.includes("https://www.googleapis.com/auth/youtube.upload")) {
      throw new Error("YouTube upload requires the youtube.upload permission. Reconnect YouTube and approve upload access.");
    }
    const response = await fetch("/api/integrations/youtube/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...youtubePublishTarget,
        title: $("#youtubeTitle").value,
        description: $("#youtubeDescription").value,
        tags: $("#youtubeTags").value,
        categoryId: $("#youtubeCategory").value,
        privacyStatus: $("#youtubePrivacy").value,
        madeForKids: $("#youtubeMadeForKids").checked,
        youtubeConsentAccepted: youtubeConsent.checked,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "YouTube upload failed.");
    status.innerHTML = `<strong>${data.message || "YouTube upload started."}</strong><small>Video ID: ${data.videoId || "pending"}</small>${data.url ? `<a href="${data.url}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>` : ""}<span id="youtubeLiveStatus">Checking processing status…</span>`;
    if (data.videoId) pollYouTubePublishStatus(data.videoId);
  } catch (error) {
    errorBox.textContent = error.message || "YouTube upload failed.";
    errorBox.classList.remove("hidden");
    paintYouTubePublishButton();
  } finally {
    button.textContent = "Upload to YouTube →";
  }
}

async function pollYouTubePublishStatus(videoId) {
  const live = $("#youtubeLiveStatus");
  if (!live) return;
  try {
    const response = await fetch("/api/integrations/youtube/publish/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check YouTube status.");
    const processing = data.processingDetails?.processingStatus || "processing";
    const upload = data.status?.uploadStatus || "uploaded";
    const privacy = data.status?.privacyStatus ? ` · ${data.status.privacyStatus}` : "";
    const failed = data.processingDetails?.processingFailureReason;
    live.textContent = failed
      ? `YouTube status: failed · ${failed}`
      : `YouTube status: ${processing} · ${upload}${privacy}`;
    if (!new Set(["succeeded", "failed", "terminated"]).has(processing)) {
      setTimeout(() => pollYouTubePublishStatus(videoId), 6000);
    }
  } catch (error) {
    live.textContent = error.message || "Could not check YouTube status.";
  }
}

function formatYouTubeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatYouTubeDuration(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return "";
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function openBilling() {
  billingModal.classList.remove("hidden");
  $("#billingStatus").textContent = "Checking your subscription…";
  $("#billingError").classList.add("hidden");
  checkoutAgreement.checked = false;
  cancelAgreement.checked = false;
  $("#checkoutButton").disabled = true;
  $("#cancelSubscriptionButton").disabled = true;
  await loadBillingStatus();
}

async function loadBillingStatus() {
  try {
    const response = await fetch("/api/billing/status");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load billing.");
    billingState = data;
    renderBilling();
  } catch (error) {
    showBillingError(error.message);
  }
}

function renderBilling() {
  if (!billingState) return;
  const { configured, catalog = [], subscription } = billingState;
  const active = Boolean(subscription?.active);
  const ending = active && subscription.cancelAtPeriodEnd;
  const tier = String(subscription?.planTier || "free").toLowerCase();
  const creatorUpgrade = active && tier === "creator";
  const businessUpgrade = active && tier === "pro";
  const upgradeEligible = creatorUpgrade || businessUpgrade;
  const canManageBilling = billingState.canManageBilling !== false;
  const endDate = subscription?.currentPeriodEnd
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(subscription.currentPeriodEnd))
    : "the end of your current paid period";
  $("#billingStart").classList.toggle("hidden", active && !upgradeEligible);
  $("#billingManage").classList.toggle("hidden", !active);
  $("#billingUpgrade").classList.toggle("hidden", !upgradeEligible || !canManageBilling);
  $("#cancelPanel").classList.toggle("hidden", ending);
  $("#resumeSubscriptionButton").classList.toggle("hidden", !ending);
  const allowedTiers = !active ? null : creatorUpgrade ? ["pro", "business"] : businessUpgrade ? ["business"] : [];
  renderPlanCatalog(catalog, allowedTiers);
  $("#billingUpgradeKicker").textContent = businessUpgrade ? "PRO → BUSINESS" : "CREATOR → PRO OFFER";
  $("#billingUpgradeTitle").textContent = businessUpgrade ? "Add a five-seat Business workspace" : "Get 15% off your first Pro month";
  $("#billingUpgradeCopy").textContent = businessUpgrade
    ? "Move to Business for shared projects, team roles, invitations, and centralized billing."
    : "Active $29 Creator members can move to the $79 Pro studio and receive the one-time upgrade discount.";
  $("#upgradeProButton").textContent = businessUpgrade ? "Upgrade to Business →" : "Upgrade to Pro →";
  $("#billingStatus").textContent = !configured
    ? "Billing setup is not complete on this installation."
    : ending
      ? `${subscription.planName} is active. Renewal is cancelled and access ends ${endDate}.`
      : active
        ? `${subscription.planName} is active at ${subscription.priceLabel || "the current recurring price"}.`
        : "You are currently on the Free plan.";
  $("#billingRenewal").textContent = ending
    ? `No additional renewal charge is scheduled. Your plan remains available through ${endDate}.`
    : `Your subscription renews automatically every ${subscription.interval || "billing period"}. Your current paid period ends ${endDate}.`;
  $("#cancelAgreementCopy").textContent = `I understand my plan remains active through ${endDate}, then access ends and future recurring charges stop.`;
  $("#checkoutButton").disabled = !configured || !checkoutAgreement.checked || !canManageBilling;
  $("#checkoutButton").textContent = upgradeEligible ? "Upgrade selected plan →" : "Continue to secure checkout →";
  $("#upgradeProButton").disabled = !configured;
  $("#portalButton").disabled = !canManageBilling;
  $("#cancelSubscriptionButton").disabled = !canManageBilling || !cancelAgreement.checked;
  $("#accountPlan").textContent = active ? tier.toUpperCase() : "FREE";
  if (currentUser) {
    currentUser.planTier = subscription?.planTier || currentUser.planTier;
    paintBrandPolicy(document);
  }
}

function renderPlanCatalog(catalog, filterTiers = null) {
  const root = $("#planCatalog");
  root.innerHTML = "";
  const available = catalog.filter((plan) => (
    plan.configured && (!filterTiers || filterTiers.includes(plan.tier))
  ));
  if (!available.length) {
    root.innerHTML = '<div class="dashboard-empty">Plan prices are being configured.</div>';
    return;
  }
  if (!available.some((plan) => plan.key === selectedBillingPlanKey)) selectedBillingPlanKey = available[0].key;
  available.forEach((plan) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `plan-option${plan.key === selectedBillingPlanKey ? " selected" : ""}`;
    option.innerHTML = `<strong>${plan.name}</strong><b>${plan.priceLabel}</b><small>${plan.headline}</small>${plan.interval === "year" ? "<em>YEARLY SAVINGS</em>" : ""}`;
    option.addEventListener("click", () => {
      selectedBillingPlanKey = plan.key;
      renderPlanCatalog(catalog, filterTiers);
    });
    root.append(option);
  });
  const plan = catalog.find((item) => item.key === selectedBillingPlanKey);
  $("#checkoutAgreementCopy").textContent = plan
    ? `I authorize KlipPharma to charge ${plan.priceLabel} automatically every ${plan.interval} until I cancel.`
    : "I authorize KlipPharma to charge the selected recurring price automatically until I cancel.";
}

async function billingPost(url, body = {}) {
  $("#billingError").classList.add("hidden");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The billing request could not be completed.");
    return data;
  } catch (error) {
    showBillingError(error.message);
    return null;
  }
}

function showBillingError(message) {
  const element = $("#billingError");
  element.textContent = message || "The billing request could not be completed.";
  element.classList.remove("hidden");
}

async function bootstrapApplication() {
  try {
    const [response, healthResponse] = await Promise.all([fetch("/api/auth/session"), fetch("/api/health")]);
    const data = await response.json();
    const health = healthResponse.ok ? await healthResponse.json() : {};
    uploadMode = health.uploadMode || "local";
    if (!response.ok) throw new Error(data.error);
    if (data.authenticated) {
      showApplication(data.user);
      loadBillingStatus();
      if (await acceptPendingInvitation()) return;
      await loadActiveUploadSessions();
      await loadRecentProjects();
      handleStartupParameters();
    } else {
      showAuthentication();
    }
  } catch (error) {
    showAuthentication();
    authError.textContent = error.message || "KlipPharma could not reach the account service.";
    authError.classList.remove("hidden");
  }
}

async function acceptPendingInvitation() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("invite");
  if (!token || !currentUser) return false;
  try {
    const response = await fetch("/api/team/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not accept that workspace invitation.");
    url.searchParams.delete("invite");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    toast("Business workspace joined. Loading your shared studio…");
    window.setTimeout(() => window.location.reload(), 500);
    return true;
  } catch (error) {
    url.searchParams.delete("invite");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    toast(error.message || "That invitation could not be accepted.");
    return false;
  }
}

function showApplication(user) {
  recoveringExpiredSession = false;
  currentUser = user || null;
  authView.classList.add("hidden");
  appShell.classList.remove("hidden");
  paintBrandPolicy(document);
  paintOutputCountPolicy();
  $("#accountEmail").textContent = user?.local ? "Local owner" : (user?.email || "Creator");
  $("#accountPlan").textContent = user?.local
    ? "PREVIEW"
    : String(user?.planTier || "free").toUpperCase();
  $("#logoutButton").classList.toggle("hidden", Boolean(user?.local));
  accountMenu.classList.remove("hidden");
  renderGlobalUploadManager();
}

function showAuthentication() {
  currentUser = null;
  appShell.classList.add("hidden");
  accountMenu.classList.add("hidden");
  authView.classList.remove("hidden");
  $("#authEmail").focus();
}

function handleStartupParameters() {
  const url = new URL(window.location.href);
  const shouldOpenSettings = url.searchParams.get("settings") === "integrations" || url.searchParams.has("tiktok") || url.searchParams.has("youtube");
  if (!shouldOpenSettings) return;
  const tiktokResult = url.searchParams.get("tiktok");
  const youtubeResult = url.searchParams.get("youtube");
  const message = url.searchParams.get("message");
  url.searchParams.delete("settings");
  url.searchParams.delete("tiktok");
  url.searchParams.delete("youtube");
  url.searchParams.delete("message");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  openSettings();
  if (tiktokResult === "connected") toast("TikTok connected. Publishing is ready when upload scopes are granted.");
  if (tiktokResult === "error") toast(message || "TikTok authorization failed.");
  if (youtubeResult === "connected") toast("YouTube connected. Channel details and upload readiness are visible now.");
  if (youtubeResult === "error") toast(message || "YouTube authorization failed.");
}

bootstrapApplication();

const billingResult = new URLSearchParams(window.location.search).get("billing");
if (billingResult) {
  history.replaceState({}, "", window.location.pathname);
  setTimeout(() => {
    if (billingResult === "success") {
      toast("Payment received. KlipPharma Pro is being activated.");
      openBilling();
    } else {
      toast("Secure checkout was closed. No subscription change was made.");
    }
  }, 500);
}
