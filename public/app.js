const $ = (selector) => document.querySelector(selector);
const ASSET_VERSION = "0.29.4";
window.__KLIPPHARMA_ASSET_VERSION__ = ASSET_VERSION;
console.info("[KlipPharma dashboard] asset loaded", { version: ASSET_VERSION, path: window.location.pathname });

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
const settingsModal = $("#settingsModal");
const tiktokPublishModal = $("#tiktokPublishModal");
const youtubePublishModal = $("#youtubePublishModal");
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
    ? "Choose exactly 1–10 top-ranked klips across the entire batch."
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
      const response = await uploadBatchDirectly(formData, fileOptions);
      data = await response.json();
      if (!response.ok) throw new Error(data.error || "The cloud upload could not start.");
    } else {
      data = await uploadBatchLocally(formData);
    }
    currentProjects = data.ids || [data.id];
    await pollProjects();
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

async function uploadBatchDirectly(formData, fileOptions) {
  $("#stage").textContent = `Preparing ${selectedFiles.length} private cloud ${selectedFiles.length === 1 ? "upload" : "uploads"}`;
  $("#progressBar").style.width = "8%";
  $("#progressText").textContent = "Secure direct upload";
  const prepare = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: selectedFiles.map((file) => ({ name: file.name, type: file.type, size: file.size })) }),
  });
  const prepared = await prepare.json();
  if (!prepare.ok) throw new Error(prepared.error || "Could not prepare the cloud upload.");

  const loadedByFile = selectedFiles.map(() => 0);
  const totalByFile = selectedFiles.map((file) => file.size);
  await Promise.all(prepared.uploads.map(async (upload, index) => {
    await uploadFileDirectly(upload.uploadUrl, selectedFiles[index], upload.type, (loaded) => {
      loadedByFile[index] = loaded;
      renderUploadTransfer(loadedByFile, totalByFile, "Uploading privately to cloud storage");
    });
  }));

  $("#stage").textContent = "Verifying uploads and starting the processors";
  $("#progressBar").style.width = "84%";
  const settings = {
    sources: prepared.uploads.map((upload) => ({ objectKey: upload.objectKey, name: upload.name, type: upload.type, size: upload.size })),
    fileOptions,
    audience: formData.get("audience"),
    goal: formData.get("goal"),
    platform: formData.get("platform"),
    contentType: formData.get("contentType"),
    clipLength: formData.get("clipLength"),
    createMontage: formData.get("createMontage") === "true",
    montageLength: formData.get("montageLength"),
    montageStyle: formData.get("montageStyle"),
    watermarkText: formData.get("watermarkText"),
    watermarkPosition: formData.get("watermarkPosition"),
    sourceLanguage: formData.get("sourceLanguage"),
    translationLanguage: formData.get("translationLanguage"),
    audioTranslation: formData.get("audioTranslation"),
    dubVoice: formData.get("dubVoice"),
    outputCount: formData.get("outputCount"),
  };
  return fetch("/api/projects/cloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

function uploadFileDirectly(url, file, type, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type || file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size);
        resolve();
      } else {
        reject(new Error(`Cloud upload failed for ${file.name}. Check the R2 CORS policy.`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error(`The cloud upload connection failed for ${file.name}.`)));
    xhr.send(file);
  });
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
    renderBatchStatus(projects);
    const sourcesFinished = projects.every((project) => project.status === "ready" || project.status === "failed" || project.status === "source_auth_required");
    const montage = projects.find((project) => project.montage)?.montage;
    const montageFinished = !montage || montage.status === "ready" || montage.status === "failed";
    const finished = sourcesFinished && montageFinished;
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
  $("#progressBar").style.width = `${average}%`;
  $("#progressText").textContent = buildingMontage
    ? "Individual klips ready · assembling Auto-Mix"
    : `${average}% processing · ${ready} ready · ${failed} need attention`;
  $("#processingSummary").textContent = failed
    ? "Open the item below to see what failed. Successful videos will still finish."
    : queued
      ? `${queued} ${queued === 1 ? "video is" : "videos are"} waiting for a processor. This page updates automatically.`
      : "Upload complete. KlipPharma is analyzing each source and will show every phase below.";
  const statusBox = $("#batchStatus");
  statusBox.innerHTML = "";
  projects.forEach((project) => {
    const row = document.createElement("div");
    row.className = `batch-row ${project.status === "source_auth_required" ? "failed" : project.status}`;
    const main = document.createElement("span");
    main.className = "batch-row-main";
    const name = document.createElement("b");
    name.className = "batch-row-name";
    name.textContent = project.originalName;
    const stage = document.createElement("small");
    stage.className = "batch-row-stage";
    stage.textContent = project.status === "failed" || project.status === "source_auth_required"
      ? project.stage || "Processing stopped"
      : project.status === "queued" && project.queuePosition
        ? `${project.stage || "Queued"} · position ${project.queuePosition}`
        : project.stage || "Preparing";
    main.append(name, stage);
    const detail = document.createElement("strong");
    detail.className = "batch-row-status";
    detail.textContent = project.status === "ready"
      ? `${project.clips?.length || 0} klips ready`
      : project.status === "failed" || project.status === "source_auth_required"
        ? project.status === "source_auth_required" ? "Auth required" : `Stopped at ${Math.min(95, Number(project.progress || 0))}%`
        : project.status === "queued"
          ? "Queued"
          : `${project.progress || 0}%`;
    const progress = document.createElement("span");
    progress.className = "batch-row-progress";
    const progressFill = document.createElement("i");
    progressFill.style.width = `${project.status === "failed" || project.status === "source_auth_required" ? Math.min(95, Number(project.progress || 0)) : Number(project.progress || 0)}%`;
    progress.append(progressFill);
    row.append(main, detail, progress);
    if ((project.status === "failed" || project.status === "source_auth_required") && project.error) {
      const error = document.createElement("p");
      error.className = "batch-row-error";
      error.textContent = project.error;
      row.append(error);
    }
    if (project.sourceReady && project.sourceUrl) {
      const download = document.createElement("a");
      download.className = "batch-source-download";
      download.href = `${project.sourceUrl}?download=1`;
      download.download = "";
      download.textContent = "Download source MP4";
      row.append(download);
    }
    statusBox.append(row);
  });
}

function renderResults(projects) {
  const totalClips = projects.reduce((sum, project) => sum + project.clips.length, 0);
  $("#resultTitle").textContent = `${totalClips} dope klips from ${projects.length} ${projects.length === 1 ? "video" : "videos"}`;
  const batchGrid = $("#clipGrid");
  batchGrid.innerHTML = "";
  renderMontage(projects);
  projects.forEach((project, index) => {
    const section = $("#projectTemplate").content.cloneNode(true);
    section.querySelector(".source-number").textContent = `SOURCE ${index + 1} OF ${projects.length}`;
    section.querySelector(".source-name").textContent = project.originalName;
    section.querySelector(".source-count").textContent = `${project.clips.length} ${project.clips.length === 1 ? "KLIP" : "KLIPS"}`;
    const sourceDownload = section.querySelector(".source-download");
    if (project.sourceUrl) {
      sourceDownload.href = `${project.sourceUrl}?download=1`;
      sourceDownload.classList.remove("hidden");
    }
    section.querySelector(".delete-source").addEventListener("click", (event) => deleteSourceProject(project, event.currentTarget));
    const grid = section.querySelector(".project-clip-grid");
    renderProjectClips(project, grid);
    batchGrid.append(section);
  });
}

function renderMontage(projects) {
  const output = $("#montageOutput");
  output.innerHTML = "";
  const owner = projects.find((project) => project.montage);
  const montage = owner?.montage;
  if (!owner || !montage) return;
  const section = document.createElement("section");
  section.className = `automix-result ${montage.status}`;
  const copy = document.createElement("div");
  copy.className = "automix-result-copy";
  const kicker = document.createElement("span");
  kicker.textContent = montage.status === "ready" ? "AUTO-MIX READY" : "AUTO-MIX NEEDS ATTENTION";
  const title = document.createElement("h2");
  title.textContent = montage.status === "ready" ? montage.title || "Your batch Auto-Mix" : "The combined edit was not created";
  const details = document.createElement("p");
  details.textContent = montage.status === "ready"
    ? `${montage.segments?.length || 0} moments · ${montage.sourceCount || projects.length} sources · ${clock(montage.duration || montage.targetDuration || 0)} final video`
    : montage.error || "Your individual AI klips are still available below.";
  copy.append(kicker, title, details);
  section.append(copy);
  if (montage.status === "ready" && montage.downloadUrl) {
    const player = document.createElement("video");
    player.className = "automix-player";
    player.controls = true;
    player.preload = "metadata";
    player.playsInline = true;
    player.src = montage.downloadUrl;
    const actions = document.createElement("div");
    actions.className = "automix-result-actions";
    const badge = document.createElement("span");
    badge.textContent = `${String(montage.style || "fast").replace(/^./, (letter) => letter.toUpperCase())} edit`;
    const review = document.createElement("button");
    review.type = "button";
    review.className = "automix-review";
    review.textContent = "Review & edit Auto-Mix";
    const download = document.createElement("a");
    download.className = "automix-download";
    download.href = montage.downloadUrl;
    download.download = "";
    download.textContent = "Download current MP4";
    const tiktok = document.createElement("button");
    tiktok.type = "button";
    tiktok.className = "automix-tiktok";
    tiktok.textContent = "Send to TikTok";
    tiktok.addEventListener("click", () => openTikTokPublish({
      targetType: "montage",
      projectId: owner.id,
      title: montage.title || "KlipPharma Auto-Mix",
    }));
    const youtube = document.createElement("button");
    youtube.type = "button";
    youtube.className = "automix-youtube";
    youtube.textContent = "Send to YouTube";
    youtube.addEventListener("click", () => openYouTubePublish({
      targetType: "montage",
      projectId: owner.id,
      title: montage.title || "KlipPharma Auto-Mix",
    }));
    const deleteOutput = document.createElement("button");
    deleteOutput.type = "button";
    deleteOutput.className = "automix-delete";
    deleteOutput.textContent = "Delete Auto-Mix MP4";
    deleteOutput.addEventListener("click", () => deleteMontageExport(owner, deleteOutput));
    actions.append(badge, review, download, tiktok, youtube, deleteOutput);
    section.append(player, actions);
    const editor = buildMontageEditor(owner, projects, montage, player, review);
    section.append(editor);
  }
  output.append(section);
}

function buildMontageEditor(owner, projects, montage, finalPlayer, reviewButton) {
  const editor = document.createElement("section");
  editor.className = "automix-editor hidden";
  editor.innerHTML = `
    <div class="automix-editor-head">
      <div><small>FINAL REVIEW · AUTO-MIX EDITOR</small><h3>Control the cut before export</h3><p>Preview, trim, reorder, remove, and rewrite every moment. Rebuild only when the sequence feels right.</p></div>
      <div class="automix-total"><span>FINAL LENGTH</span><strong>0:00.0</strong><small>MAX 1:30</small></div>
    </div>
    <div class="automix-source-preview hidden"><video controls preload="metadata" playsinline></video><div><small>PREVIEWING SOURCE MOMENT</small><strong></strong><span></span></div></div>
    <div class="automix-master-controls">
      <label class="caption-toggle automix-caption-toggle"><input type="checkbox" /><span></span><b>Burn captions into Auto-Mix</b></label>
      <label><span>CAPTION STYLE</span><select class="automix-caption-style"><option value="bold">Bold Social</option><option value="clean">Clean</option><option value="karaoke">KlipPharma Green</option><option value="minimal">Minimal</option></select></label>
      <label><span>CAPTION POSITION</span><select class="automix-caption-position"><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>
      <label><span>TEXT WATERMARK</span><input class="automix-watermark-text" maxlength="80" placeholder="@yourhandle or Brand Name" /></label>
      <label><span>WATERMARK POSITION</span><select class="automix-watermark-position"><option value="top-right">Top right</option><option value="top-left">Top left</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option></select></label>
    </div>
    <div class="brand-policy" data-brand-policy>
      <span class="brand-policy-mark">KP</span>
      <span><strong data-brand-policy-title>Free/Demo export · KlipPharma watermark locked</strong><small data-brand-policy-copy>Your typed watermark appears too. Subscribe to a paid tier to remove the KlipPharma mark.</small></span>
      <b class="brand-policy-badge" data-brand-policy-badge>LOCKED</b>
    </div>
    <section class="automix-audio-mixer">
      <div class="automix-audio-head"><div><small>AUDIO MIXER</small><strong>Mix the original sound with music or effects</strong></div><span>LOCAL AUDIO · NO AI CHARGE</span></div>
      <div class="automix-audio-grid">
        <label><span>MIX PRESET</span><select class="automix-mix-preset"><option value="custom">Custom Mix</option><option value="voice">Voice First</option><option value="balanced">Balanced</option><option value="music">Music Led</option><option value="sound-only">Added Sound Only</option><option value="original-only">Original Only</option></select></label>
        <label class="automix-volume"><span>ORIGINAL VIDEO AUDIO <output></output></span><input class="automix-source-volume" type="range" min="0" max="150" step="1" /></label>
        <label class="automix-volume"><span>ADDED SOUND VOLUME <output></output></span><input class="automix-added-volume" type="range" min="0" max="150" step="1" /></label>
        <label><span>SOUND STARTS AT</span><input class="automix-audio-start" type="number" min="0" max="90" step="0.1" /></label>
        <label><span>FADE IN</span><input class="automix-fade-in" type="number" min="0" max="10" step="0.1" /></label>
        <label><span>FADE OUT</span><input class="automix-fade-out" type="number" min="0" max="10" step="0.1" /></label>
      </div>
      <div class="automix-sound-track">
        <div class="automix-sound-copy"><small>ADDED SOUND / MUSIC</small><strong class="automix-audio-name">No sound uploaded</strong><span>MP3, WAV, M4A, AAC, OGG, or FLAC</span></div>
        <audio class="automix-audio-preview hidden" controls preload="metadata"></audio>
        <label class="automix-audio-upload"><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" /><span>Upload sound</span></label>
        <button type="button" class="automix-audio-remove hidden">Remove</button>
      </div>
      <div class="automix-audio-options">
        <label class="automix-check"><input class="automix-audio-loop" type="checkbox" /><span>Loop added sound to the end</span></label>
        <label class="automix-check"><input class="automix-auto-duck" type="checkbox" /><span>Auto-duck music under dialogue</span></label>
        <p>Volume changes and effects are applied when you rebuild the Auto-Mix.</p>
      </div>
    </section>
    <div class="automix-sequence-head"><div><small>SEQUENCE</small><strong class="automix-moment-count"></strong></div><p>Use the arrows to change the story order. Caption words belong only to that moment.</p></div>
    <div class="automix-sequence"></div>
    <div class="automix-editor-footer"><button type="button" class="automix-reset">Reset changes</button><span class="automix-editor-note">Your current MP4 stays available until the rebuild finishes.</span><button type="button" class="automix-rebuild">Rebuild & preview final Auto-Mix</button></div>
  `;
  paintBrandPolicy(editor);

  const original = (montage.segments || []).map((segment) => ({ ...segment }));
  let moments = original.map((segment) => ({ ...segment }));
  const sequence = editor.querySelector(".automix-sequence");
  const total = editor.querySelector(".automix-total strong");
  const count = editor.querySelector(".automix-moment-count");
  const sourcePreviewShell = editor.querySelector(".automix-source-preview");
  const sourcePreview = sourcePreviewShell.querySelector("video");
  const sourcePreviewName = sourcePreviewShell.querySelector("strong");
  const sourcePreviewTime = sourcePreviewShell.querySelector("span");
  const captionsEnabled = editor.querySelector(".automix-caption-toggle input");
  const captionStyle = editor.querySelector(".automix-caption-style");
  const captionPosition = editor.querySelector(".automix-caption-position");
  const watermarkText = editor.querySelector(".automix-watermark-text");
  const watermarkPosition = editor.querySelector(".automix-watermark-position");
  const mixPreset = editor.querySelector(".automix-mix-preset");
  const sourceVolume = editor.querySelector(".automix-source-volume");
  const addedAudioVolume = editor.querySelector(".automix-added-volume");
  const sourceVolumeOutput = sourceVolume.closest("label").querySelector("output");
  const addedVolumeOutput = addedAudioVolume.closest("label").querySelector("output");
  const audioStart = editor.querySelector(".automix-audio-start");
  const audioFadeIn = editor.querySelector(".automix-fade-in");
  const audioFadeOut = editor.querySelector(".automix-fade-out");
  const audioLoop = editor.querySelector(".automix-audio-loop");
  const autoDuck = editor.querySelector(".automix-auto-duck");
  const audioInput = editor.querySelector(".automix-audio-upload input");
  const audioUploadLabel = editor.querySelector(".automix-audio-upload span");
  const audioRemove = editor.querySelector(".automix-audio-remove");
  const audioName = editor.querySelector(".automix-audio-name");
  const audioPreview = editor.querySelector(".automix-audio-preview");
  captionsEnabled.checked = montage.captionsEnabled !== false;
  captionStyle.value = montage.captionStyle || "bold";
  captionPosition.value = montage.captionPosition || "bottom";
  watermarkText.value = owner.watermarkText || "";
  watermarkPosition.value = owner.watermarkPosition || "top-right";
  sourceVolume.value = String(montage.sourceVolume ?? 100);
  addedAudioVolume.value = String(montage.addedAudioVolume ?? 35);
  audioStart.value = String(montage.audioStart ?? 0);
  audioFadeIn.value = String(montage.audioFadeIn ?? 1);
  audioFadeOut.value = String(montage.audioFadeOut ?? 1);
  audioLoop.checked = montage.audioLoop !== false;
  autoDuck.checked = montage.autoDuck !== false;
  let currentAudio = montage.audioUrl ? { name: montage.audioName || "Added sound", url: montage.audioUrl } : null;
  let previewEnd = 0;

  const paintVolume = () => {
    sourceVolumeOutput.textContent = `${sourceVolume.value}%`;
    addedVolumeOutput.textContent = `${addedAudioVolume.value}%`;
  };
  const paintAudioTrack = () => {
    audioName.textContent = currentAudio?.name || "No sound uploaded";
    audioPreview.classList.toggle("hidden", !currentAudio?.url);
    audioRemove.classList.toggle("hidden", !currentAudio);
    if (currentAudio?.url) audioPreview.src = currentAudio.url;
    else {
      audioPreview.pause();
      audioPreview.removeAttribute("src");
      audioPreview.load();
    }
  };
  paintVolume();
  paintAudioTrack();

  [sourceVolume, addedAudioVolume].forEach((control) => control.addEventListener("input", () => {
    mixPreset.value = "custom";
    paintVolume();
  }));
  mixPreset.addEventListener("change", () => {
    const presets = {
      voice: [100, 22, true],
      balanced: [85, 45, true],
      music: [35, 90, false],
      "sound-only": [0, 100, false],
      "original-only": [100, 0, false],
    };
    const preset = presets[mixPreset.value];
    if (!preset) return;
    sourceVolume.value = String(preset[0]);
    addedAudioVolume.value = String(preset[1]);
    autoDuck.checked = preset[2];
    paintVolume();
  });

  audioInput.addEventListener("change", async () => {
    const file = audioInput.files?.[0];
    if (!file) return;
    audioInput.disabled = true;
    audioUploadLabel.textContent = "Uploading…";
    try {
      const formData = new FormData();
      formData.append("audio", file);
      const response = await fetch(`/api/projects/${owner.id}/montage/audio`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not upload that sound.");
      currentAudio = { name: data.audioName, url: data.audioUrl };
      paintAudioTrack();
      toast(`${data.audioName} added to the mixer.`);
    } catch (error) {
      toast(error.message || "Could not upload that sound.");
    } finally {
      audioInput.disabled = false;
      audioInput.value = "";
      audioUploadLabel.textContent = "Upload sound";
    }
  });

  audioRemove.addEventListener("click", async () => {
    audioRemove.disabled = true;
    const response = await fetch(`/api/projects/${owner.id}/montage/audio`, { method: "DELETE" });
    const data = await response.json();
    audioRemove.disabled = false;
    if (!response.ok) return toast(data.error || "Could not remove the sound.");
    currentAudio = null;
    paintAudioTrack();
    toast("Added sound removed. Original video audio is unchanged.");
  });

  sourcePreview.addEventListener("timeupdate", () => {
    if (previewEnd && sourcePreview.currentTime >= previewEnd) {
      sourcePreview.pause();
      previewEnd = 0;
    }
  });

  const paint = () => {
    sequence.innerHTML = "";
    const duration = moments.reduce((sum, moment) => sum + Math.max(0, Number(moment.end) - Number(moment.start)), 0);
    total.textContent = preciseClock(duration);
    total.classList.toggle("over", duration > 90.05);
    count.textContent = `${moments.length} ${moments.length === 1 ? "moment" : "moments"}`;
    moments.forEach((moment, index) => {
      const source = projects.find((project) => project.id === moment.sourceId);
      const sourceDuration = Number(moment.sourceDuration || source?.duration || moment.end || 0);
      const row = document.createElement("article");
      row.className = "automix-moment";
      const identity = document.createElement("div");
      identity.className = "automix-moment-identity";
      const number = document.createElement("b");
      number.textContent = String(index + 1).padStart(2, "0");
      const sourceCopy = document.createElement("div");
      const sourceName = document.createElement("strong");
      sourceName.textContent = moment.sourceName || source?.originalName || "Source video";
      const durationLabel = document.createElement("small");
      durationLabel.textContent = `${preciseClock(Number(moment.end) - Number(moment.start))} moment`;
      sourceCopy.append(sourceName, durationLabel);
      identity.append(number, sourceCopy);

      const timing = document.createElement("div");
      timing.className = "automix-moment-timing";
      const startLabel = document.createElement("label");
      startLabel.innerHTML = "<span>START</span>";
      const startInput = document.createElement("input");
      startInput.type = "number";
      startInput.min = "0";
      startInput.max = String(Math.max(0, sourceDuration - 0.75));
      startInput.step = "0.1";
      startInput.value = Number(moment.start).toFixed(1);
      startLabel.append(startInput);
      const endLabel = document.createElement("label");
      endLabel.innerHTML = "<span>END</span>";
      const endInput = document.createElement("input");
      endInput.type = "number";
      endInput.min = "0.75";
      endInput.max = String(sourceDuration);
      endInput.step = "0.1";
      endInput.value = Number(moment.end).toFixed(1);
      endLabel.append(endInput);
      timing.append(startLabel, endLabel);

      const captionLabel = document.createElement("label");
      captionLabel.className = "automix-moment-caption";
      captionLabel.innerHTML = "<span>CAPTION WORDS</span>";
      const caption = document.createElement("textarea");
      caption.rows = 2;
      caption.maxLength = 1000;
      caption.placeholder = "Add or correct the exact words for this moment.";
      caption.value = moment.captionText || "";
      captionLabel.append(caption);

      const framingLabel = document.createElement("label");
      framingLabel.className = "automix-moment-framing";
      framingLabel.innerHTML = "<span>9:16 SUBJECT</span>";
      const focusInput = document.createElement("input");
      focusInput.type = "range";
      focusInput.min = "0";
      focusInput.max = "100";
      focusInput.step = "1";
      focusInput.value = String(Number.isFinite(Number(moment.focusX)) ? Number(moment.focusX) : 50);
      const focusOutput = document.createElement("output");
      focusOutput.textContent = `${Math.round(Number(focusInput.value))}%`;
      framingLabel.append(focusInput, focusOutput);

      const tools = document.createElement("div");
      tools.className = "automix-moment-tools";
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "automix-moment-preview";
      preview.textContent = "▶ Preview";
      const up = document.createElement("button");
      up.type = "button";
      up.title = "Move earlier";
      up.textContent = "↑";
      up.disabled = index === 0;
      const down = document.createElement("button");
      down.type = "button";
      down.title = "Move later";
      down.textContent = "↓";
      down.disabled = index === moments.length - 1;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.title = "Remove moment";
      remove.textContent = "×";
      tools.append(preview, up, down, remove);

      startInput.addEventListener("input", () => {
        moment.start = Math.max(0, Number(startInput.value));
        durationLabel.textContent = `${preciseClock(Math.max(0, Number(moment.end) - moment.start))} moment`;
        updateTotal();
      });
      endInput.addEventListener("input", () => {
        moment.end = Math.min(sourceDuration, Number(endInput.value));
        durationLabel.textContent = `${preciseClock(Math.max(0, moment.end - Number(moment.start)))} moment`;
        updateTotal();
      });
      caption.addEventListener("input", () => { moment.captionText = caption.value; });
      focusInput.addEventListener("input", () => {
        moment.focusX = Number(focusInput.value);
        focusOutput.textContent = `${Math.round(moment.focusX)}%`;
        if (sourcePreviewName.textContent === (moment.sourceName || source?.originalName || "Source moment")) {
          sourcePreview.style.objectPosition = `${moment.focusX}% center`;
        }
      });
      preview.addEventListener("click", async () => {
        const url = source?.previewUrl || source?.sourceUrl;
        if (!url) return toast("This source preview is unavailable.");
        sourcePreviewShell.classList.remove("hidden");
        if (sourcePreview.getAttribute("src") !== url) {
          sourcePreview.src = url;
          if (sourcePreview.readyState < 1) {
            await new Promise((resolve) => sourcePreview.addEventListener("loadedmetadata", resolve, { once: true }));
          }
        }
        sourcePreviewName.textContent = moment.sourceName || source?.originalName || "Source moment";
        sourcePreviewTime.textContent = `${preciseClock(moment.start)}–${preciseClock(moment.end)}`;
        sourcePreview.style.objectPosition = `${Number(moment.focusX ?? 50)}% center`;
        sourcePreview.currentTime = Number(moment.start);
        previewEnd = Number(moment.end);
        try { await sourcePreview.play(); } catch { toast("Press play in the source preview."); }
        sourcePreviewShell.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      up.addEventListener("click", () => {
        [moments[index - 1], moments[index]] = [moments[index], moments[index - 1]];
        paint();
      });
      down.addEventListener("click", () => {
        [moments[index], moments[index + 1]] = [moments[index + 1], moments[index]];
        paint();
      });
      remove.addEventListener("click", () => {
        if (moments.length === 1) return toast("Keep at least one moment in the Auto-Mix.");
        moments.splice(index, 1);
        paint();
      });

      row.append(identity, timing, framingLabel, captionLabel, tools);
      sequence.append(row);
    });
  };

  const updateTotal = () => {
    const duration = moments.reduce((sum, moment) => sum + Math.max(0, Number(moment.end) - Number(moment.start)), 0);
    total.textContent = preciseClock(duration);
    total.classList.toggle("over", duration > 90.05);
  };

  reviewButton.addEventListener("click", () => {
    const opening = editor.classList.contains("hidden");
    editor.classList.toggle("hidden", !opening);
    reviewButton.textContent = opening ? "Close Auto-Mix Editor" : "Review & edit Auto-Mix";
    if (opening) editor.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  editor.querySelector(".automix-reset").addEventListener("click", () => {
    moments = original.map((segment) => ({ ...segment }));
    captionsEnabled.checked = montage.captionsEnabled !== false;
    captionStyle.value = montage.captionStyle || "bold";
    captionPosition.value = montage.captionPosition || "bottom";
    watermarkText.value = owner.watermarkText || "";
    watermarkPosition.value = owner.watermarkPosition || "top-right";
    mixPreset.value = "custom";
    sourceVolume.value = String(montage.sourceVolume ?? 100);
    addedAudioVolume.value = String(montage.addedAudioVolume ?? 35);
    audioStart.value = String(montage.audioStart ?? 0);
    audioFadeIn.value = String(montage.audioFadeIn ?? 1);
    audioFadeOut.value = String(montage.audioFadeOut ?? 1);
    audioLoop.checked = montage.audioLoop !== false;
    autoDuck.checked = montage.autoDuck !== false;
    paintVolume();
    paint();
    toast("Auto-Mix draft reset.");
  });

  editor.querySelector(".automix-rebuild").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const duration = moments.reduce((sum, moment) => sum + Number(moment.end) - Number(moment.start), 0);
    if (moments.some((moment) => !Number.isFinite(Number(moment.start)) || !Number.isFinite(Number(moment.end)) || Number(moment.end) - Number(moment.start) < 0.75)) {
      return toast("Every moment needs valid start and end times and must be at least 0.75 seconds.");
    }
    if (duration > 90.05) return toast("Shorten the sequence to 1:30 or less before rebuilding.");
    button.disabled = true;
    button.textContent = "Starting rebuild…";
    const response = await fetch(`/api/projects/${owner.id}/montage/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segments: moments.map(({ sourceId, start, end, captionText, focusX }) => ({ sourceId, start, end, captionText, focusX })),
        captionsEnabled: captionsEnabled.checked,
        captionStyle: captionStyle.value,
        captionPosition: captionPosition.value,
        watermarkText: watermarkText.value,
        watermarkPosition: watermarkPosition.value,
        sourceVolume: Number(sourceVolume.value),
        addedAudioVolume: Number(addedAudioVolume.value),
        audioStart: Number(audioStart.value),
        audioFadeIn: Number(audioFadeIn.value),
        audioFadeOut: Number(audioFadeOut.value),
        audioLoop: audioLoop.checked,
        autoDuck: autoDuck.checked,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      button.disabled = false;
      button.textContent = "Rebuild & preview final Auto-Mix";
      return toast(data.error || "Could not rebuild the Auto-Mix.");
    }
    finalPlayer.pause();
    toast("Rebuilding your edited Auto-Mix.");
    setView("processing");
    pollProjects();
  });

  paint();
  return editor;
}

function paintAutoMixControls() {
  const enabled = autoMixToggle.checked;
  autoMixBuilder.classList.toggle("enabled", enabled);
  autoMixBuilder.querySelectorAll(".automix-controls input, .automix-controls select").forEach((control) => {
    control.disabled = !enabled;
  });
}

function renderProjectClips(project, grid) {
  project.clips.forEach((clip) => {
    const node = $("#clipTemplate").content.cloneNode(true);
    paintBrandPolicy(node);
    const card = node.querySelector(".clip-card");
    card.dataset.clipId = clip.id;
    card.dataset.projectId = project.id;
    node.querySelector(".rank").textContent = `#${clip.rank}`;
    const scoreRing = node.querySelector(".score-ring");
    const score = Number.isFinite(Number(clip.overallScore)) ? Math.round(Number(clip.overallScore)) : 0;
    if (clip.manual) {
      card.classList.add("manual-card");
      scoreRing.classList.add("manual-score");
      scoreRing.querySelector("strong").textContent = "✂";
      scoreRing.querySelector("small").textContent = "MANUAL";
    } else {
      scoreRing.querySelector("strong").textContent = score;
      scoreRing.style.setProperty("--score", `${score * 3.6}deg`);
    }
    node.querySelector(".duration").textContent = `${clock(clip.start)}–${clock(clip.end)}`;
    node.querySelector(".platform").textContent = clip.manual ? "MANUAL CUT" : project.platform;
    const modeLabel = creatorModeCopy[project.contentType]?.[0] || creatorModeCopy.auto[0];
    node.querySelector(".creator-mode").textContent = clip.strategy ? `${modeLabel} · ${clip.strategy}` : modeLabel;
    const recipeLength = Number(project.clipLength);
    node.querySelector(".clip-length").textContent = clip.manual
      ? "EDITABLE · MAX 1:30"
      : Number.isFinite(recipeLength)
        ? `AUTO-KLIP · MAX ${clock(recipeLength)}`
        : "AUTO-KLIP · SMART";
    if (!clip.manual && project.translationLanguage && project.translationLanguage !== "original") {
      const languageBadge = document.createElement("span");
      languageBadge.className = "translation-language";
      languageBadge.textContent = project.audioTranslation === "dubbed"
        ? `${languageNames[project.translationLanguage] || project.translationLanguage} · DUBBED`
        : `${languageNames[project.translationLanguage] || project.translationLanguage} · CAPTIONS`;
      node.querySelector(".meta").append(languageBadge);
    }
    node.querySelector("h3").textContent = clip.title;
    node.querySelector("blockquote").textContent = `“${clip.hook || clip.caption}”`;
    node.querySelector(".why").textContent = clip.whyChosen;
    const labels = { hook:"Hook", context:"Context", payoff:"Payoff", retention:"Retention", audienceFit:"Audience", platformFit:"Platform" };
    const scoreBox = node.querySelector(".score-bars");
    if (clip.manual) {
      scoreBox.classList.add("hidden");
      node.querySelector(".feedback").classList.add("hidden");
    } else {
      Object.entries(labels).forEach(([key,label]) => scoreBox.insertAdjacentHTML("beforeend", `<div class="score-line">${label} ${clip.scores?.[key] ?? 0}<i><b style="width:${clip.scores?.[key] ?? 0}%"></b></i></div>`));
    }
    installTrimmer(project, clip, card);
    const renderButton = node.querySelector(".render");
    const download = node.querySelector(".download");
    const tiktokExport = node.querySelector(".tiktok-export");
    const youtubeExport = node.querySelector(".youtube-export");
    const deleteExport = node.querySelector(".delete-export");
    const finalPreview = node.querySelector(".final-render-preview");
    const finalPreviewVideo = node.querySelector(".final-render-video");
    if (clip.renderStatus === "ready" && clip.downloadUrl) {
      renderButton.classList.add("hidden");
      download.href = clip.downloadUrl;
      download.classList.remove("hidden");
      tiktokExport.classList.remove("hidden");
      youtubeExport.classList.remove("hidden");
      deleteExport.classList.remove("hidden");
      finalPreviewVideo.src = clip.downloadUrl;
      finalPreview.classList.remove("hidden");
    }
    renderButton.addEventListener("click", async (event) => {
      try {
        await card.trimController.save();
        await renderVideo(project.id, clip.id, event.currentTarget, card);
      } catch (error) {
        toast(error.message || "Could not save this cut.");
      }
    });
    tiktokExport.addEventListener("click", () => openTikTokPublish({
      targetType: "clip",
      projectId: project.id,
      clipId: clip.id,
      title: clip.title || "KlipPharma klip",
    }));
    youtubeExport.addEventListener("click", () => openYouTubePublish({
      targetType: "clip",
      projectId: project.id,
      clipId: clip.id,
      title: clip.title || "KlipPharma klip",
    }));
    deleteExport.addEventListener("click", () => deleteClipExport(project, clip, card, deleteExport));
    node.querySelectorAll(".feedback button").forEach((button) => button.addEventListener("click", () => rate(project.id, clip.id, button)));
    grid.append(node);
  });
}

function addSelectedFiles(incoming) {
  const supported = incoming.filter(isSupportedMedia);
  const keys = new Set(selectedFiles.map(fileKey));
  let added = 0;
  let limitReached = false;
  for (const file of supported) {
    const key = fileKey(file);
    if (keys.has(key)) continue;
    if (selectedFiles.length >= 10) {
      limitReached = true;
      break;
    }
    selectedFiles.push(file);
    fileModes.set(key, true);
    keys.add(key);
    added += 1;
  }
  syncSelectedFiles();
  showSelectedFiles();
  return { added, supported: supported.length, limitReached };
}

function syncSelectedFiles() {
  // selectedFiles is the source of truth. Do not construct DataTransfer here:
  // its constructor/file assignment is unsupported on several iOS Safari releases.
  videoInput.value = "";
}

function clearSelectedFiles() {
  selectedFiles = [];
  fileModes.clear();
  syncSelectedFiles();
  showSelectedFiles();
}

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function showSelectedFiles() {
  const files = selectedFiles;
  const selection = $("#fileSelection");
  selection.innerHTML = "";
  selection.classList.toggle("hidden", !files.length);
  if (!files.length) {
    $("#fileLabel").textContent = "Drop your long-form videos here";
    return;
  }
  $("#fileLabel").textContent = files.length === 1 ? files[0].name : `${files.length} videos selected`;
  files.forEach((file, index) => {
    const item = document.createElement("div");
    const number = document.createElement("b");
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.textContent = file.name;
    const size = document.createElement("small");
    size.textContent = fileSize(file.size);
    const mode = document.createElement("button");
    mode.type = "button";
    mode.className = "file-mode ai-mode";
    const paintMode = () => {
      const usesAi = fileModes.get(fileKey(file)) !== false;
      mode.classList.toggle("ai-mode", usesAi);
      mode.classList.toggle("manual-mode", !usesAi);
      mode.textContent = usesAi ? "AI + captions" : "Manual · no transcript";
      mode.title = usesAi ? "Transcription and AI clip selection are on" : "No transcription or AI-selection charge";
    };
    mode.addEventListener("click", () => {
      const key = fileKey(file);
      fileModes.set(key, fileModes.get(key) === false);
      paintMode();
    });
    paintMode();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.title = "Remove from batch";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      fileModes.delete(fileKey(file));
      syncSelectedFiles();
      showSelectedFiles();
      toast(`${file.name} removed.`);
    });
    item.append(number, name, size, mode, remove);
    selection.append(item);
  });
}

function isSupportedMedia(file) {
  return file.type.startsWith("video/") || file.type.startsWith("audio/") || /\.(mov|mp4|m4v|webm|mp3|m4a|wav|mpeg|mpg)$/i.test(file.name);
}

function fileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadRecentProjects() {
  const section = $("#recentProjects");
  try {
    const response = await fetch("/api/projects");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const groups = new Map();
    for (const project of data.projects || []) {
      const key = project.batchId || project.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(project);
    }
    const batches = [...groups.values()].slice(0, 6);
    const grid = $("#recentGrid");
    grid.innerHTML = "";
    section.classList.toggle("hidden", !batches.length);
    batches.forEach((batch) => {
      const ready = batch.filter((project) => project.status === "ready");
      const names = batch.map((project) => project.originalName);
      const clipCount = ready.reduce((sum, project) => sum + Number(project.clipCount || 0), 0);
      const card = document.createElement("article");
      card.className = "recent-card";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`;
      const details = document.createElement("p");
      const created = batch[0]?.createdAt ? new Date(batch[0].createdAt).toLocaleDateString() : "Saved project";
      details.textContent = ready.length
        ? `${created} · ${clipCount} ${clipCount === 1 ? "klip" : "klips"}`
        : `${created} · Processing was interrupted`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = ready.length ? "Open results" : "Unavailable";
      button.disabled = !ready.length;
      if (ready.length) button.addEventListener("click", () => openSavedBatch(ready.map((project) => project.id), button));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "recent-delete";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => deleteSavedBatch(batch, deleteButton));
      const actions = document.createElement("div");
      actions.className = "recent-actions";
      actions.append(button, deleteButton);
      copy.append(title, details);
      card.append(copy, actions);
      grid.append(card);
    });
  } catch {
    section.classList.add("hidden");
  }
}

async function deleteSavedBatch(batch, button) {
  const names = batch.map((project) => project.originalName);
  const label = names.length === 1 ? names[0] : `this batch of ${names.length} videos`;
  if (!confirm(`Permanently delete ${label} and every rendered klip? This cannot be undone.`)) return;
  button.disabled = true;
  button.textContent = "Deleting…";
  const batchId = batch[0]?.batchId || batch[0]?.id;
  const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) {
    button.disabled = false;
    button.textContent = "Delete";
    return toast(data.error || "Could not delete that batch.");
  }
  toast("Batch and stored videos deleted.");
  loadRecentProjects();
}

async function deleteSourceProject(project, button) {
  const warning = Number(project.batchSize || 1) > 1
    ? `Permanently delete ${project.originalName}? Its rendered klips and the batch Auto-Mix will also be deleted.`
    : `Permanently delete ${project.originalName} and every rendered klip?`;
  if (!confirm(`${warning} This cannot be undone.`)) return;
  button.disabled = true;
  button.textContent = "Deleting…";
  const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) {
    button.disabled = false;
    button.textContent = "Delete video";
    return toast(data.error || "Could not delete that video.");
  }
  currentProjects = currentProjects.filter((id) => id !== project.id);
  toast(`${project.originalName} deleted.`);
  await refreshCurrentResults();
}

async function deleteClipExport(project, clip, card, button) {
  if (!confirm(`Delete the rendered MP4 for “${clip.title}”? You can render it again later.`)) return;
  button.disabled = true;
  button.textContent = "Deleting…";
  const response = await fetch(`/api/projects/${project.id}/clips/${clip.id}/export`, { method: "DELETE" });
  const data = await response.json();
  button.disabled = false;
  button.textContent = "Delete rendered MP4";
  if (!response.ok) return toast(data.error || "Could not delete that MP4.");
  clip.renderStatus = "idle";
  delete clip.downloadUrl;
  card.querySelector(".download").classList.add("hidden");
  card.querySelector(".tiktok-export").classList.add("hidden");
  card.querySelector(".youtube-export").classList.add("hidden");
  const finalPreview = card.querySelector(".final-render-preview");
  const finalPreviewVideo = card.querySelector(".final-render-video");
  finalPreview.classList.add("hidden");
  finalPreviewVideo.pause();
  finalPreviewVideo.removeAttribute("src");
  finalPreviewVideo.load();
  button.classList.add("hidden");
  const render = card.querySelector(".render");
  render.classList.remove("hidden");
  render.disabled = false;
  render.textContent = "Build exact final preview";
  toast("Rendered MP4 deleted.");
}

async function deleteMontageExport(owner, button) {
  if (!confirm("Delete this Auto-Mix MP4? This cannot be undone.")) return;
  button.disabled = true;
  button.textContent = "Deleting…";
  const response = await fetch(`/api/projects/${owner.id}/montage/export`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) {
    button.disabled = false;
    button.textContent = "Delete Auto-Mix MP4";
    return toast(data.error || "Could not delete that Auto-Mix.");
  }
  toast("Auto-Mix MP4 deleted.");
  await refreshCurrentResults();
}

async function refreshCurrentResults() {
  if (!currentProjects.length) {
    setView("upload");
    loadRecentProjects();
    return;
  }
  const projects = await Promise.all(currentProjects.map((id) => fetch(`/api/projects/${id}`).then(async (response) => {
    if (response.status === 404) return null;
    const project = await response.json();
    if (!response.ok) throw new Error(project.error || "Could not refresh this project.");
    return project;
  })));
  const available = projects.filter(Boolean);
  currentProjects = available.map((project) => project.id);
  if (!available.length) {
    setView("upload");
    loadRecentProjects();
    return;
  }
  renderResults(available);
}

async function openSavedBatch(ids, button) {
  button.disabled = true;
  button.textContent = "Opening…";
  try {
    const projects = await Promise.all(ids.map((id) => fetch(`/api/projects/${id}`).then(async (response) => {
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "Could not open this project.");
      return project;
    })));
    currentProjects = ids;
    renderResults(projects);
    setView("results");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Open results";
    toast(error.message || "Could not open this saved project.");
  }
}

function installTrimmer(project, clip, card) {
  const video = card.querySelector(".preview-video");
  const placeholder = card.querySelector(".preview-placeholder");
  const previewMessage = card.querySelector(".preview-message");
  const previewDetail = card.querySelector(".preview-detail");
  const retryPreview = card.querySelector(".retry-preview");
  const previewButton = card.querySelector(".preview-cut");
  const startInput = card.querySelector(".trim-start");
  const endInput = card.querySelector(".trim-end");
  const startTime = card.querySelector(".start-time");
  const endTime = card.querySelector(".end-time");
  const selectionLength = card.querySelector(".selection-length");
  const durationBadge = card.querySelector(".duration");
  const resetButton = card.querySelector(".reset-cut");
  const renderButton = card.querySelector(".render");
  const download = card.querySelector(".download");
  const finalPreview = card.querySelector(".final-render-preview");
  const finalPreviewVideo = card.querySelector(".final-render-video");
  const captionsEnabled = card.querySelector(".captions-enabled");
  const captionText = card.querySelector(".caption-text");
  const captionStyle = card.querySelector(".caption-style");
  const captionPosition = card.querySelector(".caption-position");
  const watermarkText = card.querySelector(".watermark-text");
  const watermarkPosition = card.querySelector(".watermark-position");
  const memeStudio = card.querySelector("[data-meme-studio]");
  const memeProLock = card.querySelector("[data-meme-pro-lock]");
  const memeEnabled = card.querySelector(".meme-enabled");
  const memeHeadline = card.querySelector(".meme-headline");
  const memeTemplate = card.querySelector(".meme-template");
  const memePosition = card.querySelector(".meme-position");
  const memeFontSize = card.querySelector(".meme-font-size");
  const memeTextColor = card.querySelector(".meme-text-color");
  const memeTextColorValue = card.querySelector(".meme-text-color-value");
  const memeBoxColor = card.querySelector(".meme-box-color");
  const memeBackground = card.querySelector(".meme-background");
  const memeImageInput = card.querySelector(".meme-image-input");
  const memeImageName = card.querySelector(".meme-image-name");
  const memeImageRemove = card.querySelector(".meme-image-remove");
  const memeStart = card.querySelector(".meme-start");
  const memeEnd = card.querySelector(".meme-end");
  const memeStartLabel = card.querySelector(".meme-start-label");
  const memeEndLabel = card.querySelector(".meme-end-label");
  const memePreviewLayer = card.querySelector(".meme-preview-layer");
  const memePreviewImage = card.querySelector(".meme-preview-image");
  const memePreviewHeadline = card.querySelector(".meme-preview-headline");
  const captionPreviewLayer = card.querySelector(".caption-preview-layer");
  const captionPreviewText = card.querySelector(".caption-preview-text");
  const customWatermarkPreview = card.querySelector(".custom-watermark-preview");
  const brandWatermarkPreview = card.querySelector(".brand-watermark-preview");
  const focusInput = card.querySelector(".focus-x");
  const focusLabel = card.querySelector(".focus-label");
  const focusPresets = [...card.querySelectorAll(".focus-presets button")];
  const overlaySaveState = card.querySelector(".overlay-save-state");
  const sourceVolume = card.querySelector(".clip-source-volume");
  const sourceVolumeValue = card.querySelector(".clip-source-volume-value");
  const addedAudioVolume = card.querySelector(".clip-added-audio-volume");
  const addedAudioVolumeValue = card.querySelector(".clip-added-audio-volume-value");
  const audioStart = card.querySelector(".clip-audio-start");
  const audioFadeIn = card.querySelector(".clip-audio-fade-in");
  const audioFadeOut = card.querySelector(".clip-audio-fade-out");
  const audioLoop = card.querySelector(".clip-audio-loop");
  const autoDuck = card.querySelector(".clip-auto-duck");
  const audioInput = card.querySelector(".clip-audio-upload input");
  const audioUploadLabel = card.querySelector(".clip-audio-upload span");
  const audioRemove = card.querySelector(".clip-audio-remove");
  const audioName = card.querySelector(".clip-audio-name");
  const audioPreview = card.querySelector(".clip-audio-preview");
  const audioTranslation = card.querySelector(".clip-audio-translation");
  const translationLanguage = card.querySelector(".clip-translation-language");
  const dubVoice = card.querySelector(".clip-dub-voice");
  const dubStatus = card.querySelector(".clip-dub-status strong");
  const original = { start: Number(clip.start), end: Number(clip.end) };
  const transcriptForSelection = (start, end) => (project.segments || [])
    .filter((segment) => Number(segment.end) > start && Number(segment.start) < end)
    .map((segment) => String(segment.text || "").trim())
    .filter(Boolean)
    .join(" ");
  let captionCustomized = Object.hasOwn(clip, "captionText");
  const state = {
    start: original.start,
    end: original.end,
    captionsEnabled: typeof clip.captionsEnabled === "boolean" ? clip.captionsEnabled : !clip.manual,
    captionText: captionCustomized ? String(clip.captionText || "") : transcriptForSelection(original.start, original.end),
    captionStyle: clip.captionStyle || "bold",
    captionPosition: clip.captionPosition || "bottom",
    watermarkText: clip.watermarkText ?? project.watermarkText ?? "",
    watermarkPosition: clip.watermarkPosition || project.watermarkPosition || "top-right",
    focusX: Number.isFinite(Number(clip.focusX)) ? Number(clip.focusX) : 50,
    memeEnabled: hasCreativeAccess() && clip.memeEnabled === true,
    memeHeadline: String(clip.memeHeadline || ""),
    memeTemplate: clip.memeTemplate || "headline",
    memePosition: clip.memePosition || "middle",
    memeFontSize: clip.memeFontSize || "medium",
    memeTextColor: normalizeClientColor(clip.memeTextColor),
    memeBoxColor: clip.memeBoxColor || "black",
    memeBackground: clip.memeBackground || "solid",
    memeStart: Number.isFinite(Number(clip.memeStart)) ? Number(clip.memeStart) : 0,
    memeEnd: Number.isFinite(Number(clip.memeEnd)) ? Number(clip.memeEnd) : Math.max(1, original.end - original.start),
    memeImageUrl: clip.memeImageUrl || "",
    sourceVolume: Number.isFinite(Number(clip.sourceVolume)) ? Number(clip.sourceVolume) : (project.audioTranslation === "dubbed" ? 16 : 100),
    addedAudioVolume: Number.isFinite(Number(clip.addedAudioVolume)) ? Number(clip.addedAudioVolume) : 35,
    audioStart: Number.isFinite(Number(clip.audioStart)) ? Number(clip.audioStart) : 0,
    audioFadeIn: Number.isFinite(Number(clip.audioFadeIn)) ? Number(clip.audioFadeIn) : 1,
    audioFadeOut: Number.isFinite(Number(clip.audioFadeOut)) ? Number(clip.audioFadeOut) : 1,
    audioLoop: clip.audioLoop !== false,
    autoDuck: clip.autoDuck !== false,
    audioTranslation: clip.audioTranslation || project.audioTranslation || "original",
    translationLanguage: clip.translationLanguage || project.translationLanguage || "original",
    dubVoice: clip.dubVoice || project.dubVoice || "coral",
    audioUrl: clip.audioUrl || "",
    audioName: clip.audioName || "",
  };
  const initialSelectedDuration = Math.max(0.1, state.end - state.start);
  if (state.memeEnabled && state.memeEnd - state.memeStart <= 0.5) {
    state.memeStart = 0;
    state.memeEnd = initialSelectedDuration;
  }
  const mediaDuration = Math.max(Number(project.duration) || state.end, state.end);
  const signature = () => JSON.stringify(state);
  let lastSaved = signature();
  let previewingSelection = false;
  let previewReady = false;
  let saveTimer;

  startInput.max = String(Math.max(1, mediaDuration));
  endInput.max = String(Math.max(1, mediaDuration));
  captionsEnabled.checked = state.captionsEnabled;
  captionText.value = state.captionText;
  captionStyle.value = state.captionStyle;
  captionPosition.value = state.captionPosition;
  watermarkText.value = state.watermarkText;
  watermarkPosition.value = state.watermarkPosition;
  focusInput.value = String(state.focusX);
  const proEnabled = hasCreativeAccess();
  memeStudio.classList.toggle("pro-active", proEnabled);
  memeProLock.classList.toggle("hidden", proEnabled);
  memeStudio.querySelector("[data-pro-badge]").textContent = proEnabled ? "PRO ACTIVE" : "PRO";
  memeStudio.querySelectorAll(".meme-studio-controls input,.meme-studio-controls select,.meme-studio-controls textarea,.meme-toggle input").forEach((control) => {
    control.disabled = !proEnabled;
  });
  memeEnabled.checked = state.memeEnabled;
  memeHeadline.value = state.memeHeadline;
  memeTemplate.value = state.memeTemplate;
  memePosition.value = state.memePosition;
  memeFontSize.value = state.memeFontSize;
  memeTextColor.value = state.memeTextColor;
  memeTextColorValue.textContent = state.memeTextColor.toUpperCase();
  memeBoxColor.value = state.memeBoxColor;
  memeBackground.value = state.memeBackground;
  memeImageName.textContent = state.memeImageUrl ? "Overlay image added" : "No image added";
  memeImageRemove.classList.toggle("hidden", !state.memeImageUrl);
  sourceVolume.value = String(state.sourceVolume);
  addedAudioVolume.value = String(state.addedAudioVolume);
  audioStart.value = String(state.audioStart);
  audioFadeIn.value = String(state.audioFadeIn);
  audioFadeOut.value = String(state.audioFadeOut);
  audioLoop.checked = state.audioLoop;
  autoDuck.checked = state.autoDuck;
  audioTranslation.value = state.audioTranslation;
  translationLanguage.value = state.translationLanguage;
  dubVoice.value = state.dubVoice;

  function paintAudioControls() {
    sourceVolumeValue.textContent = `${Math.round(state.sourceVolume)}%`;
    addedAudioVolumeValue.textContent = `${Math.round(state.addedAudioVolume)}%`;
    audioName.textContent = state.audioName || "No sound uploaded";
    audioRemove.classList.toggle("hidden", !state.audioUrl);
    audioPreview.classList.toggle("hidden", !state.audioUrl);
    if (state.audioUrl && audioPreview.src !== new URL(state.audioUrl, window.location.href).href) audioPreview.src = state.audioUrl;
    if (!state.audioUrl) {
      audioPreview.removeAttribute("src");
      audioPreview.load();
    }
    const dubbed = state.audioTranslation === "dubbed" && state.translationLanguage !== "original";
    translationLanguage.disabled = state.audioTranslation !== "dubbed";
    dubVoice.disabled = !dubbed;
    const languageLabel = translationLanguage.selectedOptions[0]?.textContent || state.translationLanguage;
    dubStatus.textContent = dubbed
      ? `${languageLabel.toUpperCase()} DUB • ${state.dubVoice.toUpperCase()}`
      : "ORIGINAL VOICE";
    video.volume = Math.min(1, Math.max(0, state.sourceVolume / 100));
  }
  paintAudioControls();

  function showPreviewMessage(message, detail, canRetry = true) {
    previewReady = false;
    video.classList.add("hidden");
    placeholder.classList.remove("hidden");
    previewButton.disabled = true;
    previewButton.textContent = "Preview unavailable";
    previewMessage.textContent = message;
    previewDetail.textContent = detail;
    retryPreview.classList.toggle("hidden", !canRetry);
  }

  function activatePreview(url) {
    previewReady = true;
    video.src = url;
    video.style.objectPosition = `${state.focusX}% center`;
    video.classList.remove("hidden");
    placeholder.classList.add("hidden");
    previewButton.disabled = false;
    previewButton.innerHTML = "<span>▶</span> Preview selected cut";
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(state.start)) video.currentTime = state.start;
    }, { once: true });
  }

  function paintMemePreview(currentTime = state.start) {
    const selectedDuration = Math.max(1, state.end - state.start);
    state.memeStart = Math.max(0, Math.min(Number(state.memeStart) || 0, selectedDuration - 0.1));
    state.memeEnd = Math.max(state.memeStart + 0.1, Math.min(Number(state.memeEnd) || selectedDuration, selectedDuration));
    memeStart.max = String(selectedDuration);
    memeEnd.max = String(selectedDuration);
    memeStart.value = String(state.memeStart);
    memeEnd.value = String(state.memeEnd);
    memeStartLabel.textContent = preciseClock(state.memeStart);
    memeEndLabel.textContent = preciseClock(state.memeEnd);
    const relativeTime = Math.max(0, Number(currentTime) - state.start);
    const visible = proEnabled && state.memeEnabled && relativeTime >= state.memeStart && relativeTime <= state.memeEnd;
    memePreviewLayer.classList.toggle("hidden", !visible);
    memePreviewLayer.className = `meme-preview-layer ${visible ? "" : "hidden"} ${state.memeTemplate}`.trim();
    memePreviewHeadline.textContent = state.memeHeadline;
    memePreviewHeadline.className = [
      "meme-preview-headline",
      state.memeHeadline ? "" : "hidden",
      `position-${state.memePosition}`,
      `size-${state.memeFontSize}`,
      `bg-${state.memeBackground}`,
    ].filter(Boolean).join(" ");
    const boxIsWhite = state.memeBoxColor === "white";
    memePreviewHeadline.style.color = state.memeTextColor;
    memePreviewHeadline.style.background = state.memeBackground === "none"
      ? "transparent"
      : boxIsWhite
        ? (state.memeBackground === "transparent" ? "rgba(255,255,255,.72)" : "#ffffff")
        : (state.memeBackground === "transparent" ? "rgba(0,0,0,.66)" : "#000000");
    memePreviewHeadline.style.textShadow = state.memeBackground === "none"
      ? "0 2px 5px #000, 0 0 2px #000"
      : "none";
    memePreviewImage.classList.toggle("hidden", !state.memeImageUrl);
    if (state.memeImageUrl && memePreviewImage.src !== new URL(state.memeImageUrl, window.location.href).href) {
      memePreviewImage.src = state.memeImageUrl;
    }
  }

  function paintCaptionAndWatermarkPreview(currentTime = state.start) {
    const selectedDuration = Math.max(0.1, state.end - state.start);
    const relativeTime = Math.max(0, Math.min(selectedDuration, Number(currentTime) - state.start));
    const words = String(state.captionText || "").trim().split(/\s+/).filter(Boolean);
    let visibleCaption = "";
    if (words.length) {
      const maxCues = Math.max(1, Math.floor(Math.max(1, selectedDuration) / 1.2));
      const chunkSize = Math.max(4, Math.ceil(words.length / maxCues));
      const chunks = [];
      for (let index = 0; index < words.length; index += chunkSize) {
        chunks.push(words.slice(index, index + chunkSize).join(" "));
      }
      const cueDuration = Math.max(0.4, selectedDuration / chunks.length);
      const cueIndex = Math.min(chunks.length - 1, Math.floor(relativeTime / cueDuration));
      visibleCaption = chunks[Math.max(0, cueIndex)] || "";
    }
    const showCaption = state.captionsEnabled && Boolean(visibleCaption);
    captionPreviewLayer.className = `caption-preview-layer position-${state.captionPosition} ${showCaption ? "" : "hidden"}`.trim();
    captionPreviewText.className = `caption-preview-text style-${state.captionStyle}`;
    captionPreviewText.textContent = visibleCaption;

    const customWatermark = String(state.watermarkText || "").trim();
    customWatermarkPreview.textContent = customWatermark;
    customWatermarkPreview.className = `watermark-preview custom-watermark-preview position-${state.watermarkPosition} ${customWatermark ? "" : "hidden"}`.trim();
    brandWatermarkPreview.className = `watermark-preview brand-watermark-preview position-top-left ${isPaidPlan() ? "hidden" : ""}`.trim();
  }

  function paintCompositePreview(currentTime = state.start) {
    paintMemePreview(currentTime);
    paintCaptionAndWatermarkPreview(currentTime);
  }

  async function recoverPreview() {
    retryPreview.disabled = true;
    retryPreview.textContent = "Converting…";
    showPreviewMessage("Building a browser-safe MP4 preview…", "This happens locally and does not use OpenAI credits.", true);
    retryPreview.disabled = true;
    retryPreview.textContent = "Converting…";
    try {
      const data = await requestCompatiblePreview(project);
      project.previewUrl = data.previewUrl;
      activatePreview(project.previewUrl);
      if (data.previewHasAudio === false) toast("Video preview recovered without audio. Your rendered klip will still use the source audio.");
    } catch (error) {
      showPreviewMessage("This camera format still needs attention.", error.message || "KlipPharma could not convert the preview.", true);
      retryPreview.disabled = false;
      retryPreview.textContent = "Retry preview";
    }
  }

  retryPreview.addEventListener("click", recoverPreview);

  if (project.previewUrl) {
    activatePreview(project.previewUrl);
  } else if (project.sourceUrl) {
    activatePreview(project.sourceUrl);
    video.addEventListener("error", () => {
      showPreviewMessage("Converting this video for your browser…", "The original file is safe. KlipPharma is making a compatible preview now.", true);
      recoverPreview();
    }, { once: true });
  } else {
    showPreviewMessage("No video preview for this audio-only source.", "You can still use its transcript and create an audio-led klip.", false);
  }

  function paint(seekTo) {
    state.start = Math.max(0, Math.min(state.start, mediaDuration - 1));
    state.end = Math.max(state.start + 1, Math.min(state.end, mediaDuration));
    if (state.end - state.start > 90) state.end = Math.min(mediaDuration, state.start + 90);
    startInput.value = String(state.start);
    endInput.value = String(state.end);
    startTime.textContent = preciseClock(state.start);
    endTime.textContent = preciseClock(state.end);
    selectionLength.textContent = `${preciseClock(state.end - state.start)} selected`;
    durationBadge.textContent = `${clock(state.start)}–${clock(state.end)}`;
    video.style.objectPosition = `${state.focusX}% center`;
    focusInput.value = String(state.focusX);
    focusLabel.textContent = state.focusX < 35 ? "Left" : state.focusX > 65 ? "Right" : "Center";
    focusPresets.forEach((button) => button.classList.toggle("active", Number(button.dataset.focus) === Number(state.focusX)));
    paintCompositePreview(video.currentTime || state.start);
    if (previewReady && Number.isFinite(seekTo)) {
      previewingSelection = false;
      video.pause();
      video.currentTime = Math.min(Math.max(0, seekTo), mediaDuration);
    }
  }

  function markCutChanged() {
    renderButton.classList.remove("hidden");
    renderButton.disabled = false;
    renderButton.textContent = "Rebuild exact final preview";
    download.classList.add("hidden");
    finalPreview.classList.add("hidden");
    finalPreviewVideo.pause();
    finalPreviewVideo.removeAttribute("src");
    finalPreviewVideo.load();
    paintCompositePreview(video.currentTime || state.start);
  }

  async function save() {
    clearTimeout(saveTimer);
    const nextSignature = signature();
    if (nextSignature === lastSaved) return;
    overlaySaveState.textContent = "Saving changes…";
    overlaySaveState.classList.add("saving");
    overlaySaveState.classList.remove("saved");
    const response = await fetch(`/api/projects/${project.id}/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save this cut.");
    state.start = Number(data.clip.start);
    state.end = Number(data.clip.end);
    clip.start = state.start;
    clip.end = state.end;
    Object.assign(clip, {
      captionsEnabled: state.captionsEnabled,
      captionText: state.captionText,
      captionStyle: state.captionStyle,
      captionPosition: state.captionPosition,
      watermarkText: state.watermarkText,
      watermarkPosition: state.watermarkPosition,
      focusX: state.focusX,
      memeEnabled: state.memeEnabled,
      memeHeadline: state.memeHeadline,
      memeTemplate: state.memeTemplate,
      memePosition: state.memePosition,
      memeFontSize: state.memeFontSize,
      memeTextColor: state.memeTextColor,
      memeBoxColor: state.memeBoxColor,
      memeBackground: state.memeBackground,
      memeStart: state.memeStart,
      memeEnd: state.memeEnd,
      memeImageUrl: state.memeImageUrl,
      sourceVolume: state.sourceVolume,
      addedAudioVolume: state.addedAudioVolume,
      audioStart: state.audioStart,
      audioFadeIn: state.audioFadeIn,
      audioFadeOut: state.audioFadeOut,
      audioLoop: state.audioLoop,
      autoDuck: state.autoDuck,
      audioTranslation: state.audioTranslation,
      translationLanguage: state.translationLanguage,
      dubVoice: state.dubVoice,
      audioUrl: state.audioUrl,
      audioName: state.audioName,
    });
    lastSaved = signature();
    overlaySaveState.textContent = "Saved";
    overlaySaveState.classList.remove("saving");
    overlaySaveState.classList.add("saved");
    paint();
  }

  function queueSave() {
    clearTimeout(saveTimer);
    overlaySaveState.textContent = "Waiting to save…";
    overlaySaveState.classList.remove("saved");
    saveTimer = setTimeout(() => save().catch((error) => toast(error.message)), 450);
  }

  function refreshAutomaticCaption() {
    if (captionCustomized) return;
    state.captionText = transcriptForSelection(state.start, state.end);
    captionText.value = state.captionText;
  }

  startInput.addEventListener("input", () => {
    state.start = Number(startInput.value);
    if (state.start >= state.end) state.end = Math.min(mediaDuration, state.start + 1);
    if (state.end - state.start > 90) state.end = Math.min(mediaDuration, state.start + 90);
    refreshAutomaticCaption();
    markCutChanged();
    paint(state.start);
    queueSave();
  });

  endInput.addEventListener("input", () => {
    state.end = Number(endInput.value);
    if (state.end <= state.start) state.start = Math.max(0, state.end - 1);
    if (state.end - state.start > 90) state.start = Math.max(0, state.end - 90);
    refreshAutomaticCaption();
    markCutChanged();
    paint(state.end);
    queueSave();
  });

  captionsEnabled.addEventListener("change", () => {
    state.captionsEnabled = captionsEnabled.checked;
    markCutChanged();
    queueSave();
  });
  captionText.addEventListener("input", () => {
    captionCustomized = true;
    state.captionText = captionText.value;
    markCutChanged();
    queueSave();
  });
  captionStyle.addEventListener("change", () => {
    state.captionStyle = captionStyle.value;
    markCutChanged();
    queueSave();
  });
  captionPosition.addEventListener("change", () => {
    state.captionPosition = captionPosition.value;
    markCutChanged();
    queueSave();
  });
  watermarkText.addEventListener("input", () => {
    state.watermarkText = watermarkText.value;
    markCutChanged();
    queueSave();
  });
  watermarkPosition.addEventListener("change", () => {
    state.watermarkPosition = watermarkPosition.value;
    markCutChanged();
    queueSave();
  });
  [
    [sourceVolume, "input", () => { state.sourceVolume = Number(sourceVolume.value); }],
    [addedAudioVolume, "input", () => { state.addedAudioVolume = Number(addedAudioVolume.value); }],
    [audioStart, "input", () => { state.audioStart = Number(audioStart.value); }],
    [audioFadeIn, "input", () => { state.audioFadeIn = Number(audioFadeIn.value); }],
    [audioFadeOut, "input", () => { state.audioFadeOut = Number(audioFadeOut.value); }],
    [audioLoop, "change", () => { state.audioLoop = audioLoop.checked; }],
    [autoDuck, "change", () => { state.autoDuck = autoDuck.checked; }],
    [audioTranslation, "change", () => {
      state.audioTranslation = audioTranslation.value;
      if (state.audioTranslation === "dubbed" && state.translationLanguage === "original") {
        state.translationLanguage = project.translationLanguage && project.translationLanguage !== "original"
          ? project.translationLanguage
          : "es";
        translationLanguage.value = state.translationLanguage;
      }
    }],
    [translationLanguage, "change", () => {
      state.translationLanguage = translationLanguage.value;
      if (state.translationLanguage === "original") {
        state.audioTranslation = "original";
        audioTranslation.value = "original";
      }
    }],
    [dubVoice, "change", () => { state.dubVoice = dubVoice.value; }],
  ].forEach(([control, eventName, update]) => control.addEventListener(eventName, () => {
    update();
    paintAudioControls();
    markCutChanged();
    queueSave();
  }));

  audioInput.addEventListener("change", async () => {
    const sound = audioInput.files?.[0];
    if (!sound) return;
    audioInput.disabled = true;
    audioUploadLabel.textContent = "Uploading…";
    try {
      await save();
      const formData = new FormData();
      formData.append("audio", sound);
      const response = await fetch(`/api/projects/${project.id}/clips/${clip.id}/audio`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not upload that sound.");
      state.audioUrl = `${data.audioUrl}?v=${Date.now()}`;
      state.audioName = data.audioName || sound.name;
      clip.audioUrl = state.audioUrl;
      clip.audioName = state.audioName;
      lastSaved = signature();
      paintAudioControls();
      markCutChanged();
      toast("Sound added to this klip.");
    } catch (error) {
      toast(error.message || "Could not upload that sound.");
    } finally {
      audioInput.disabled = false;
      audioUploadLabel.textContent = "Upload sound";
      audioInput.value = "";
    }
  });

  audioRemove.addEventListener("click", async () => {
    if (!state.audioUrl) return;
    audioRemove.disabled = true;
    const response = await fetch(`/api/projects/${project.id}/clips/${clip.id}/audio`, { method: "DELETE" });
    const data = await response.json();
    audioRemove.disabled = false;
    if (!response.ok) return toast(data.error || "Could not remove that sound.");
    state.audioUrl = "";
    state.audioName = "";
    clip.audioUrl = "";
    clip.audioName = "";
    lastSaved = signature();
    paintAudioControls();
    markCutChanged();
    toast("Added sound removed.");
  });
  [
    [memeEnabled, "change", () => {
      state.memeEnabled = memeEnabled.checked;
      if (state.memeEnabled && state.memeEnd - state.memeStart <= 0.5) {
        state.memeStart = 0;
        state.memeEnd = Math.max(0.1, state.end - state.start);
      }
    }],
    [memeHeadline, "input", () => { state.memeHeadline = memeHeadline.value; }],
    [memeTemplate, "change", () => { state.memeTemplate = memeTemplate.value; }],
    [memePosition, "change", () => { state.memePosition = memePosition.value; }],
    [memeFontSize, "change", () => { state.memeFontSize = memeFontSize.value; }],
    [memeTextColor, "input", () => {
      state.memeTextColor = memeTextColor.value;
      memeTextColorValue.textContent = state.memeTextColor.toUpperCase();
    }],
    [memeBoxColor, "change", () => { state.memeBoxColor = memeBoxColor.value; }],
    [memeBackground, "change", () => { state.memeBackground = memeBackground.value; }],
    [memeStart, "input", () => {
      state.memeStart = Number(memeStart.value);
      if (state.memeStart >= state.memeEnd) state.memeEnd = Math.min(state.end - state.start, state.memeStart + 0.5);
    }],
    [memeEnd, "input", () => {
      state.memeEnd = Number(memeEnd.value);
      if (state.memeEnd <= state.memeStart) state.memeStart = Math.max(0, state.memeEnd - 0.5);
    }],
  ].forEach(([control, eventName, update]) => control.addEventListener(eventName, () => {
    update();
    markCutChanged();
    paintCompositePreview(video.currentTime || state.start);
    queueSave();
  }));

  memeImageInput.addEventListener("change", async () => {
    const image = memeImageInput.files?.[0];
    if (!image) return;
    if (!proEnabled) return toast("Meme & Overlay Studio is available on Pro.");
    try {
      await save();
      const formData = new FormData();
      formData.append("image", image);
      memeImageName.textContent = "Uploading image…";
      const response = await fetch(`/api/projects/${project.id}/clips/${clip.id}/overlay-image`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not upload that overlay image.");
      state.memeImageUrl = `${data.memeImageUrl}?v=${Date.now()}`;
      clip.memeImageUrl = state.memeImageUrl;
      memeImageName.textContent = image.name;
      memeImageRemove.classList.remove("hidden");
      memeImageInput.value = "";
      lastSaved = signature();
      markCutChanged();
      paintCompositePreview(video.currentTime || state.start);
      toast("Overlay image added.");
    } catch (error) {
      memeImageName.textContent = state.memeImageUrl ? "Overlay image added" : "No image added";
      toast(error.message || "Could not upload that overlay image.");
    }
  });

  memeImageRemove.addEventListener("click", async () => {
    if (!state.memeImageUrl) return;
    const response = await fetch(`/api/projects/${project.id}/clips/${clip.id}/overlay-image`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) return toast(data.error || "Could not remove that overlay image.");
    state.memeImageUrl = "";
    clip.memeImageUrl = "";
    memePreviewImage.removeAttribute("src");
    memeImageName.textContent = "No image added";
    memeImageRemove.classList.add("hidden");
    lastSaved = signature();
    markCutChanged();
    paintCompositePreview(video.currentTime || state.start);
  });
  focusInput.addEventListener("input", () => {
    state.focusX = Number(focusInput.value);
    markCutChanged();
    paint();
    queueSave();
  });
  focusPresets.forEach((button) => button.addEventListener("click", () => {
    state.focusX = Number(button.dataset.focus);
    markCutChanged();
    paint();
    queueSave();
  }));

  previewButton.addEventListener("click", async () => {
    if (!previewReady) return;
    previewingSelection = true;
    video.currentTime = state.start;
    try {
      await video.play();
    } catch {
      previewingSelection = false;
      toast("Press play in the video preview to hear this cut.");
    }
  });

  video.addEventListener("timeupdate", () => {
    paintCompositePreview(video.currentTime);
    if (previewingSelection && video.currentTime >= state.end) {
      video.pause();
      video.currentTime = state.start;
      previewingSelection = false;
    }
  });
  video.addEventListener("pause", () => { previewingSelection = false; });

  resetButton.addEventListener("click", () => {
    state.start = original.start;
    state.end = original.end;
    markCutChanged();
    paint(state.start);
    queueSave();
  });

  card.trimController = { save, state };
  paint();
}

function requestCompatiblePreview(project) {
  if (project.previewUrl) return Promise.resolve({ previewUrl: project.previewUrl, previewHasAudio: project.previewHasAudio !== false });
  if (previewRecovery.has(project.id)) return previewRecovery.get(project.id);
  const task = previewRecoveryQueue.catch(() => {}).then(async () => {
    const response = await fetch(`/api/projects/${project.id}/preview`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create the preview.");
    return data;
  });
  previewRecoveryQueue = task.catch(() => {});
  previewRecovery.set(project.id, task);
  task.then(() => previewRecovery.delete(project.id), () => previewRecovery.delete(project.id));
  return task;
}

  async function renderVideo(projectId, clipId, button, card) {
  button.disabled = true;
  button.textContent = "Building exact preview…";
  const response = await fetch(`/api/projects/${projectId}/clips/${clipId}/render`, { method: "POST" });
  if (!response.ok) { button.disabled = false; button.textContent = "Try again"; return toast("Could not start render."); }
  const check = async () => {
    const project = await fetch(`/api/projects/${projectId}`).then((r) => r.json());
    const clip = project.clips.find((item) => item.id === clipId);
    if (clip.renderStatus === "ready") {
      button.classList.add("hidden");
      const link = card.querySelector(".download");
      link.href = clip.downloadUrl;
      link.classList.remove("hidden");
      card.querySelector(".tiktok-export").classList.remove("hidden");
      card.querySelector(".youtube-export").classList.remove("hidden");
      const finalPreview = card.querySelector(".final-render-preview");
      const finalPreviewVideo = card.querySelector(".final-render-video");
      finalPreviewVideo.src = clip.downloadUrl;
      finalPreview.classList.remove("hidden");
      finalPreview.scrollIntoView({ behavior: "smooth", block: "center" });
      card.querySelector(".delete-export").classList.remove("hidden");
      toast("Exact final preview is ready. Review it before downloading.");
    } else if (clip.renderStatus === "failed") {
      button.disabled = false; button.textContent = "Try again"; toast(clip.renderError || "Render failed.");
    } else setTimeout(check, 2000);
  };
  setTimeout(check, 1200);
}

async function rate(projectId, clipId, button) {
  await fetch(`/api/projects/${projectId}/clips/${clipId}/feedback`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({rating:button.dataset.rating}) });
  button.closest(".feedback").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
  toast("Feedback saved. This will train your taste profile.");
}

$("#newProject").addEventListener("click", () => { clearTimeout(pollTimer); currentProjects = []; form.reset(); paintAutoMixControls(); clearSelectedFiles(); $("#batchStatus").innerHTML = ""; setView("upload"); loadRecentProjects(); });
deleteBatchButton.addEventListener("click", async () => {
  if (!currentProjects.length) return;
  const projects = await Promise.all(currentProjects.map((id) => fetch(`/api/projects/${id}`).then((response) => response.json())));
  const batchId = projects[0]?.batchId || projects[0]?.id;
  if (!batchId || !confirm(`Permanently delete this batch of ${projects.length} ${projects.length === 1 ? "video" : "videos"} and every rendered file? This cannot be undone.`)) return;
  deleteBatchButton.disabled = true;
  deleteBatchButton.textContent = "Deleting…";
  const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  const data = await response.json();
  deleteBatchButton.disabled = false;
  deleteBatchButton.textContent = "Delete batch";
  if (!response.ok) return toast(data.error || "Could not delete this batch.");
  currentProjects = [];
  setView("upload");
  loadRecentProjects();
  toast("Batch and every stored video deleted.");
});
function setView(view) {
  uploadView.classList.toggle("hidden", view !== "upload");
  processingView.classList.toggle("hidden", view !== "processing");
  resultsView.classList.toggle("hidden", view !== "results");
  if (view === "processing") {
    processingView.setAttribute("aria-busy", "true");
    processingBack.classList.add("hidden");
  }
}
function clock(seconds) { const m=Math.floor(seconds/60); return `${m}:${String(Math.floor(seconds%60)).padStart(2,"0")}`; }
function preciseClock(seconds) { const m=Math.floor(seconds/60); return `${m}:${String((seconds%60).toFixed(1)).padStart(4,"0")}`; }
function normalizeClientColor(value) {
  const legacy = { white: "#ffffff", lime: "#b8ef3c", black: "#000000" };
  const color = legacy[String(value || "").toLowerCase()] || String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#ffffff";
}
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),4000); }

authSwitch.addEventListener("click", () => {
  creatingAccount = !creatingAccount;
  $("#authSubmit span").textContent = creatingAccount ? "Create private workspace" : "Sign in";
  authSwitch.textContent = creatingAccount ? "Already have an account? Sign in" : "New to KlipPharma? Create an account";
  $("#authIntro").textContent = creatingAccount
    ? "Create your private creator workspace. Projects and exports will only be visible to your account."
    : "Sign in to your private video studio. Your projects stay separated from every other creator.";
  $("#authPassword").autocomplete = creatingAccount ? "new-password" : "current-password";
  authError.classList.add("hidden");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#authSubmit");
  submit.disabled = true;
  authError.classList.add("hidden");
  try {
    const response = await fetch(creatingAccount ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("#authEmail").value, password: $("#authPassword").value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not access your account.");
    showApplication(data.user);
    loadBillingStatus();
    authForm.reset();
    if (await acceptPendingInvitation()) return;
    await loadRecentProjects();
  } catch (error) {
    authError.textContent = error.message || "Could not access your account.";
    authError.classList.remove("hidden");
  } finally {
    submit.disabled = false;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  clearTimeout(pollTimer);
  currentProjects = [];
  clearSelectedFiles();
  showAuthentication();
});

$("#billingButton").addEventListener("click", openBilling);
$("#dashboardButton").addEventListener("click", openDashboard);
$("#incomingButton").addEventListener("click", () => openDashboard({ focusIncoming: true }));
$("#settingsButton").addEventListener("click", openSettings);
$("#billingClose").addEventListener("click", closeBilling);
$("#dashboardClose").addEventListener("click", closeDashboard);
$("#settingsClose").addEventListener("click", closeSettings);
$("#tiktokPublishClose").addEventListener("click", closeTikTokPublish);
$("#youtubePublishClose").addEventListener("click", closeYouTubePublish);
billingModal.addEventListener("click", (event) => {
  if (event.target === billingModal) closeBilling();
});
dashboardModal.addEventListener("click", (event) => {
  if (event.target === dashboardModal) closeDashboard();
});
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});
tiktokPublishModal.addEventListener("click", (event) => {
  if (event.target === tiktokPublishModal) closeTikTokPublish();
});
youtubePublishModal.addEventListener("click", (event) => {
  if (event.target === youtubePublishModal) closeYouTubePublish();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !billingModal.classList.contains("hidden")) closeBilling();
  if (event.key === "Escape" && !dashboardModal.classList.contains("hidden")) closeDashboard();
  if (event.key === "Escape" && !settingsModal.classList.contains("hidden")) closeSettings();
  if (event.key === "Escape" && !tiktokPublishModal.classList.contains("hidden")) closeTikTokPublish();
  if (event.key === "Escape" && !youtubePublishModal.classList.contains("hidden")) closeYouTubePublish();
});
checkoutAgreement.addEventListener("change", () => {
  $("#checkoutButton").disabled = !billingState?.configured
    || billingState?.canManageBilling === false
    || !checkoutAgreement.checked;
});
cancelAgreement.addEventListener("change", () => {
  $("#cancelSubscriptionButton").disabled = billingState?.canManageBilling === false || !cancelAgreement.checked;
});
tiktokConsent.addEventListener("change", paintTikTokPublishButton);
$("#tiktokPostMode").addEventListener("change", () => {
  paintTikTokPublishMode();
  paintTikTokPublishButton();
});
$("#tiktokPrivacy").addEventListener("change", paintTikTokPublishButton);
$("#tiktokSubmitButton").addEventListener("click", submitTikTokPublish);
youtubeConsent.addEventListener("change", paintYouTubePublishButton);
$("#youtubeTitle").addEventListener("input", paintYouTubePublishButton);
$("#youtubeSubmitButton").addEventListener("click", submitYouTubePublish);
$("#checkoutButton").addEventListener("click", async () => {
  if (!checkoutAgreement.checked) return;
  const activeUpgrade = Boolean(
    billingState?.subscription?.active
    && new Set(["creator", "pro"]).has(String(billingState.subscription.planTier || "").toLowerCase()),
  );
  const data = await billingPost(activeUpgrade ? "/api/billing/upgrade" : "/api/billing/checkout", {
    planKey: selectedBillingPlanKey,
    recurringAuthorizationAccepted: true,
  });
  if (data?.url) window.location.assign(data.url);
  if (data?.subscription) {
    billingState.subscription = data.subscription;
    currentUser.planTier = data.subscription.planTier;
    renderBilling();
    toast(selectedBillingPlanKey === "pro_monthly"
      ? "Pro activated. Your 15% first-month upgrade offer was applied."
      : "Your upgraded plan is active.");
  }
});
$("#upgradeProButton").addEventListener("click", () => {
  const tier = String(billingState?.subscription?.planTier || "free").toLowerCase();
  selectedBillingPlanKey = tier === "pro" ? "business_monthly" : "pro_monthly";
  renderBilling();
  checkoutAgreement.focus();
  toast(tier === "pro"
    ? "Business selected with five included team seats."
    : "Monthly Pro selected. Accept the authorization below to apply your 15% first-month offer.");
});
$("#portalButton").addEventListener("click", async () => {
  const data = await billingPost("/api/billing/portal");
  if (data?.url) window.location.assign(data.url);
});
$("#cancelSubscriptionButton").addEventListener("click", async () => {
  if (!cancelAgreement.checked) return;
  const data = await billingPost("/api/billing/cancel", { agreementAccepted: true });
  if (data?.subscription) {
    billingState.subscription = data.subscription;
    renderBilling();
    toast("Recurring renewal cancelled. Your plan remains active through the current billing period.");
  }
});
$("#resumeSubscriptionButton").addEventListener("click", async () => {
  const data = await billingPost("/api/billing/resume");
  if (data?.subscription) {
    billingState.subscription = data.subscription;
    renderBilling();
    toast("Your KlipPharma renewal is active.");
  }
});

$("#dashboardUpgradeButton").addEventListener("click", () => {
  closeDashboard();
  openBilling();
});

function closeBilling() {
  billingModal.classList.add("hidden");
}

function closeDashboard() {
  dashboardModal.classList.add("hidden");
  clearInterval(dashboardRefreshTimer);
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

function closeTikTokPublish() {
  tiktokPublishModal.classList.add("hidden");
}

function closeYouTubePublish() {
  youtubePublishModal.classList.add("hidden");
}

async function openDashboard(options = {}) {
  dashboardModal.classList.remove("hidden");
  $("#dashboardHistory").innerHTML = '<div class="dashboard-empty">Loading your account history…</div>';
  $("#dashboardPublishingDestinations").innerHTML = '<div class="dashboard-empty">Checking publishing destinations…</div>';
  $("#incomingList").innerHTML = '<div class="dashboard-empty">Loading incoming projects…</div>';
  $("#dashboardError").classList.add("hidden");
  await loadDashboardData(options);
  clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = setInterval(() => {
    if (!dashboardModal.classList.contains("hidden")) loadDashboardData({ quiet: true });
  }, 20000);
}

async function loadDashboardData(options = {}) {
  try {
    const [dashboardResponse, integrationsResponse] = await Promise.all([
      fetch("/api/account/dashboard"),
      fetch("/api/integrations/status"),
    ]);
    const data = await dashboardResponse.json();
    if (!dashboardResponse.ok) throw new Error(data.error || "Could not load your dashboard.");
    const integrations = await integrationsResponse.json().catch(() => ({}));
    if (!integrationsResponse.ok) {
      const error = integrations.error || "Could not load integrations.";
      integrations.tiktok = { connected: false, error };
      integrations.youtube = { connected: false, error };
    }
    integrationsState = integrations;
    renderDashboard(data, integrations);
    try {
      await loadIncomingKlipdoseData();
    } catch (incomingError) {
      $("#dashboardError").textContent = incomingError.message || "Could not load incoming Klipdose projects.";
      $("#dashboardError").classList.remove("hidden");
      $("#incomingList").innerHTML = `<div class="dashboard-empty">${incomingError.message || "Could not load incoming Klipdose projects."}</div>`;
    }
    if (options.focusIncoming) $("#incomingPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#dashboardError").textContent = error.message;
    $("#dashboardError").classList.remove("hidden");
    $("#incomingList").innerHTML = `<div class="dashboard-empty">${error.message || "Could not load incoming projects."}</div>`;
  }
}

async function loadIncomingKlipdoseData() {
  const fetchUrl = "/api/incoming/klipdose";
  const response = await fetch(fetchUrl, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  logIncomingDashboardFetch({
    fetchUrl,
    httpStatus: response.status,
    responseBody: data,
    projectCount: Array.isArray(data?.projects) ? data.projects.length : null,
    stats: data?.stats || null,
  });
  if (!response.ok) throw new Error(data?.error || "Could not load incoming Klipdose projects.");
  if (!data || !Array.isArray(data.projects)) throw new Error("Incoming Projects response missing projects array.");
  if (!data.stats || typeof data.stats !== "object") throw new Error("Incoming Projects response missing stats.");
  renderIncomingKlipdose(data.projects, {
    new: Number(data.stats.new ?? 0),
    processing: Number(data.stats.processing ?? 0),
    ready: Number(data.stats.ready ?? 0),
    failed: Number(data.stats.failed ?? 0),
  });
}

function renderDashboard(data, integrations = integrationsState || {}) {
  const user = data.user || currentUser || {};
  const subscription = data.subscription || {};
  const stats = data.stats || {};
  const projects = data.projects || [];
  currentDashboardProjects = projects;
  $("#dashboardEmail").textContent = user.email || "Local owner";
  $("#dashboardMemberSince").textContent = user.createdAt
    ? `Member since ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(user.createdAt))}`
    : "Private creator workspace";
  $("#dashboardPlan").textContent = subscription.active ? subscription.planName : "Free";
  const periodDate = subscription.currentPeriodEnd
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(subscription.currentPeriodEnd))
    : null;
  $("#dashboardRenewal").textContent = subscription.active
    ? subscription.cancelAtPeriodEnd ? `Access ends ${periodDate}` : `Renews ${periodDate || "automatically"}`
    : "No renewal scheduled";
  $("#dashboardUploads").textContent = stats.uploads || 0;
  $("#dashboardClips").textContent = stats.clips || 0;
  $("#dashboardCompleted").textContent = stats.completed || 0;
  renderDashboardPublishing(integrations, projects);
  const tier = String(subscription.planTier || user.planTier || "free").toLowerCase();
  $("#dashboardUpgrade").classList.toggle("hidden", tier === "business");
  $("#dashboardUpgradeTitle").textContent = new Set(["pro", "studio"]).has(tier)
    ? "Bring your team to Business"
    : tier === "creator"
    ? "Move from Creator to Pro"
    : "Build toward the $79 Pro studio";
  $("#dashboardUpgradeCopy").textContent = new Set(["pro", "studio"]).has(tier)
    ? "Business is $199/month and includes five accounts, shared project history, roles, invitations, and centralized billing."
    : tier === "creator"
    ? "Upgrade from the $29 plan and receive 15% off your first $79 Pro month."
    : "Start with Creator or unlock Pro creative tools. Annual plans include a built-in discount.";
  $("#dashboardTeam").classList.toggle("hidden", tier !== "business");
  $("#dashboardHistoryScope").textContent = tier === "business" ? "Shared workspace history" : "Account-only history";
  if (tier === "business") loadTeamPanel();
  const history = $("#dashboardHistory");
  history.innerHTML = "";
  if (!projects.length) {
    history.innerHTML = '<div class="dashboard-empty">Your uploads will appear here after your first harvest.</div>';
    return;
  }
  projects.slice(0, 12).forEach((project) => {
    const row = document.createElement("div");
    row.className = "dashboard-upload";
    const name = document.createElement("strong");
    name.textContent = project.originalName || "Untitled upload";
    const detail = document.createElement("span");
    const date = project.createdAt ? new Date(project.createdAt).toLocaleDateString() : "Saved";
    detail.textContent = `${date} · ${project.clipCount || 0} klips · ${project.status}`;
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open";
    open.disabled = project.status !== "ready";
    open.addEventListener("click", async () => {
      closeDashboard();
      await openSavedBatch([project.id], open);
    });
    row.append(name, detail, open);
    history.append(row);
  });
}

function renderDashboardPublishing(integrations = integrationsState || {}, projects = []) {
  const root = $("#dashboardPublishingDestinations");
  root.innerHTML = "";
  root.append(renderTikTokDashboardDestination(integrations.tiktok, projects));
  root.append(renderYouTubeDashboardDestination(integrations.youtube, projects));
}

function renderTikTokDashboardDestination(tiktok, projects = []) {
  const card = document.createElement("article");
  card.className = "dashboard-destination-card";
  const connected = Boolean(tiktok?.connected);
  const scopes = tiktok?.scopes || [];
  const canDirect = scopes.includes("video.publish");
  const canInbox = scopes.includes("video.upload");
  const readyProject = projects.find((project) => project.status === "ready");
  const profile = tiktok?.profile || {};

  const head = document.createElement("div");
  head.className = "dashboard-destination-head";
  const icon = document.createElement("span");
  icon.className = "integration-logo tiktok-logo";
  icon.textContent = "♪";
  const title = document.createElement("div");
  title.innerHTML = `<h4>TikTok</h4><span class="status-badge ${connected ? "connected" : "muted"}"></span>`;
  title.querySelector(".status-badge").textContent = connected ? "Connected" : "Not connected";
  head.append(icon, title);
  card.append(head);

  if (!connected) {
    const empty = document.createElement("p");
    empty.textContent = "Connect TikTok to show creator profile details and publishing readiness on your dashboard.";
    const actions = document.createElement("div");
    actions.className = "dashboard-destination-actions";
    const connect = dashboardAction("Connect TikTok", () => {
      closeDashboard();
      openSettings();
    }, "primary");
    actions.append(connect);
    card.append(empty, actions);
    return card;
  }

  const account = document.createElement("div");
  account.className = "dashboard-destination-account";
  const avatar = document.createElement("div");
  avatar.className = "dashboard-destination-avatar";
  if (profile.avatarUrl) {
    const image = document.createElement("img");
    image.src = profile.avatarUrl;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = "♪";
  }
  const copy = document.createElement("div");
  copy.className = "dashboard-destination-copy";
  const name = document.createElement("strong");
  name.textContent = profile.displayName || "TikTok creator";
  const username = document.createElement("small");
  username.textContent = profile.username ? `@${profile.username}` : "Creator account connected";
  copy.append(name, username);
  if (profile.bio) {
    const bio = document.createElement("p");
    bio.textContent = profile.bio;
    copy.append(bio);
  }
  account.append(avatar, copy);
  card.append(account);

  const readiness = document.createElement("div");
  readiness.className = "dashboard-readiness";
  if (canDirect) readiness.append(readinessBadge("Direct Post ready"));
  if (canInbox) readiness.append(readinessBadge("Inbox Upload ready"));
  if (!canDirect && !canInbox) readiness.append(readinessBadge("Reconnect to enable publishing", true));
  card.append(readiness);

  const actions = document.createElement("div");
  actions.className = "dashboard-destination-actions";
  actions.append(dashboardAction("Manage Integration", () => {
    closeDashboard();
    openSettings();
  }));
  if (profile.profileUrl) {
    actions.append(dashboardAction("View TikTok Profile", () => window.open(profile.profileUrl, "_blank", "noopener,noreferrer")));
  }
  const publish = dashboardAction(readyProject ? "Publish to TikTok" : "Create a clip to publish", () => {
    if (!readyProject) {
      closeDashboard();
      toast("Create and render a klip before publishing to TikTok.");
      return;
    }
    publishReadyDashboardProjectToTikTok(readyProject.id);
  }, readyProject ? "primary" : "");
  actions.append(publish);
  card.append(actions);
  return card;
}

function renderYouTubeDashboardDestination(youtube, projects = []) {
  const card = document.createElement("article");
  card.className = "dashboard-destination-card";
  const connected = Boolean(youtube?.connected);
  const scopes = youtube?.scopes || [];
  const canUpload = scopes.includes("https://www.googleapis.com/auth/youtube.upload");
  const readyProject = projects.find((project) => project.status === "ready");
  const channel = youtube?.channel || {};

  const head = document.createElement("div");
  head.className = "dashboard-destination-head";
  const icon = document.createElement("span");
  icon.className = "integration-logo youtube-logo";
  icon.textContent = "▶";
  const title = document.createElement("div");
  title.innerHTML = `<h4>YouTube</h4><span class="status-badge ${connected ? "connected" : "muted"}"></span>`;
  title.querySelector(".status-badge").textContent = connected ? "Connected" : "Not connected";
  head.append(icon, title);
  card.append(head);

  if (!connected) {
    const empty = document.createElement("p");
    empty.textContent = "Connect YouTube to show channel details and upload readiness on your dashboard.";
    const actions = document.createElement("div");
    actions.className = "dashboard-destination-actions";
    actions.append(dashboardAction("Connect YouTube", () => {
      closeDashboard();
      openSettings();
    }, "primary"));
    card.append(empty, actions);
    return card;
  }

  const account = document.createElement("div");
  account.className = "dashboard-destination-account";
  const avatar = document.createElement("div");
  avatar.className = "dashboard-destination-avatar youtube-avatar";
  if (channel.avatarUrl) {
    const image = document.createElement("img");
    image.src = channel.avatarUrl;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = "▶";
  }
  const copy = document.createElement("div");
  copy.className = "dashboard-destination-copy";
  const name = document.createElement("strong");
  name.textContent = channel.title || "YouTube channel";
  const handle = document.createElement("small");
  handle.textContent = channel.handle || "Channel connected";
  copy.append(name, handle);
  if (channel.description) {
    const description = document.createElement("p");
    description.textContent = channel.description;
    copy.append(description);
  }
  account.append(avatar, copy);
  card.append(account);

  const readiness = document.createElement("div");
  readiness.className = "dashboard-readiness";
  if (canUpload) readiness.append(readinessBadge("Upload ready"));
  else readiness.append(readinessBadge("Reconnect to enable uploads", true));
  card.append(readiness);

  const actions = document.createElement("div");
  actions.className = "dashboard-destination-actions";
  actions.append(dashboardAction("Manage Integration", () => {
    closeDashboard();
    openSettings();
  }));
  if (channel.channelUrl) {
    actions.append(dashboardAction("View YouTube Channel", () => window.open(channel.channelUrl, "_blank", "noopener,noreferrer")));
  }
  const publish = dashboardAction(readyProject ? "Publish to YouTube" : "Create a clip to publish", () => {
    if (!readyProject) {
      closeDashboard();
      toast("Create and render a klip before publishing to YouTube.");
      return;
    }
    publishReadyDashboardProjectToYouTube(readyProject.id);
  }, readyProject && canUpload ? "primary" : "");
  publish.disabled = !canUpload && Boolean(readyProject);
  actions.append(publish);
  card.append(actions);
  return card;
}

function dashboardAction(label, handler, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (variant) button.className = variant;
  button.addEventListener("click", handler);
  return button;
}

function readinessBadge(label, muted = false) {
  const badge = document.createElement("span");
  badge.className = `readiness-badge${muted ? " muted" : ""}`;
  badge.textContent = label;
  return badge;
}

async function publishReadyDashboardProjectToTikTok(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}`);
    const project = await response.json();
    if (!response.ok) throw new Error(project.error || "Could not open this project.");
    const target = firstRenderedPublishTarget(project);
    if (!target) {
      toast("Render a final MP4 preview before publishing to TikTok.");
      return;
    }
    closeDashboard();
    openTikTokPublish(target);
  } catch (error) {
    toast(error.message || "Could not prepare TikTok publishing.");
  }
}

async function publishReadyDashboardProjectToYouTube(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}`);
    const project = await response.json();
    if (!response.ok) throw new Error(project.error || "Could not open this project.");
    const target = firstRenderedPublishTarget(project);
    if (!target) {
      toast("Render a final MP4 preview before publishing to YouTube.");
      return;
    }
    closeDashboard();
    openYouTubePublish(target);
  } catch (error) {
    toast(error.message || "Could not prepare YouTube publishing.");
  }
}

function firstRenderedPublishTarget(project) {
  const montage = project.montage?.status === "ready" && project.montage.downloadUrl
    ? {
      targetType: "montage",
      projectId: project.id,
      title: project.montage.title || "KlipPharma Auto-Mix",
    }
    : null;
  const clip = (project.clips || []).find((item) => item.renderStatus === "ready" && item.downloadUrl);
  return montage || (clip ? {
    targetType: "clip",
    projectId: project.id,
    clipId: clip.id,
    title: clip.title || "KlipPharma klip",
  } : null);
}

function renderIncomingKlipdose(projects, stats) {
  const normalizedStats = {
    new: Number(stats?.new ?? 0),
    processing: Number(stats?.processing ?? 0),
    ready: Number(stats?.ready ?? 0),
    failed: Number(stats?.failed ?? 0),
  };
  const normalizedProjects = Array.isArray(projects) ? projects : [];
  logIncomingDashboardFetch({
    render: true,
    projectCount: normalizedProjects.length,
    stats: normalizedStats,
  });
  $("#incomingNew").textContent = normalizedStats.new;
  $("#incomingProcessing").textContent = normalizedStats.processing;
  $("#incomingReady").textContent = normalizedStats.ready;
  $("#incomingFailed").textContent = normalizedStats.failed;
  const root = $("#incomingList");
  root.innerHTML = "";
  if (!normalizedProjects.length) {
    root.innerHTML = '<div class="dashboard-empty">No active Klipdose handoffs have been received for this account yet.</div>';
    return;
  }
  normalizedProjects.forEach((project) => {
    const card = document.createElement("article");
    card.className = "incoming-card";
    const thumb = document.createElement("div");
    thumb.className = "incoming-thumb";
    if (project.thumbnailUrl) thumb.style.backgroundImage = `url(${project.thumbnailUrl})`;
    else thumb.textContent = "KP";
    const body = document.createElement("div");
    body.className = "incoming-body";
    const meta = document.createElement("div");
    meta.className = "incoming-meta";
    [project.platformBadge || "EXTERNAL", "KLIPDOSE", String(project.status || "new").toUpperCase()].forEach((label) => {
      const badge = document.createElement("span");
      badge.textContent = label;
      meta.append(badge);
    });
    const title = document.createElement("h4");
    title.textContent = project.title || "Klipdose project";
    const creator = document.createElement("p");
    creator.textContent = project.creatorName || "Klipdose creator";
    const details = document.createElement("small");
    const received = project.receivedAt ? new Date(project.receivedAt).toLocaleString() : "Received time unavailable";
    details.textContent = `${received} · Opportunity ${project.opportunityScore ?? "N/A"} · Confidence ${project.confidence ?? "N/A"}%`;
    const action = document.createElement("p");
    action.textContent = project.recommendedAction || "Review source";
    const state = document.createElement("small");
    state.textContent = `Source state: ${project.sourceState || project.stage || project.status || "new"}`;
    body.append(meta, title, creator, details, state, action);
    if (project.error || project.status === "source_auth_required") {
      const error = document.createElement("p");
      error.className = "incoming-error";
      error.textContent = project.error || "YouTube requires authenticated access for this source.";
      body.append(error);
    }
    const controls = document.createElement("div");
    controls.className = "incoming-actions";
    const open = actionButton("OPEN IN EDITOR", () => openIncomingProject(project, open));
    open.disabled = !(project.canOpenEditor || project.sourceReady || project.status === "ready");
    const canRetry = project.canRetryImport || project.status === "failed" || project.status === "source_auth_required" || project.status === "awaiting_vod" || project.status === "source_unavailable";
    const start = actionButton(canRetry ? "RETRY IMPORT" : "START PROCESSING", () => startIncomingProject(project, start));
    start.disabled = project.status === "processing" || project.status === "queued" || project.status === "ready" || project.status === "importing" || project.status === "link_only" || !canRetry && project.status !== "new";
    const review = document.createElement("a");
    review.className = "incoming-link";
    review.href = project.sourceUrl || "#";
    review.target = "_blank";
    review.rel = "noreferrer";
    review.textContent = "OPEN SOURCE";
    if (!project.sourceUrl) review.setAttribute("aria-disabled", "true");
    const upload = actionButton("UPLOAD AUTHORIZED SOURCE", () => uploadIncomingSource(project, upload));
    const archive = actionButton("ARCHIVE", () => archiveIncomingProject(project, archive));
    controls.append(open, review, start, upload, archive);
    card.append(thumb, body, controls);
    root.append(card);
  });
}

function actionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function openIncomingProject(project, button) {
  button.disabled = true;
  button.textContent = "OPENING…";
  try {
    closeDashboard();
    const response = await fetch(`/api/projects/${project.id}`);
    const loaded = await response.json();
    if (!response.ok) throw new Error(loaded.error || "Could not open this Klipdose project.");
    currentProjects = [project.id];
    if (loaded.status === "ready") {
      renderResults([loaded]);
      setView("results");
    } else {
      setView("processing");
      pollProjects();
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = "OPEN IN EDITOR";
    toast(error.message || "Could not open this Klipdose project.");
    openDashboard({ focusIncoming: true });
  }
}

async function startIncomingProject(project, button) {
  button.disabled = true;
  button.textContent = "STARTING…";
  try {
    const response = await fetch(`/api/incoming/klipdose/${project.id}/start`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start processing.");
    await loadDashboardData({ quiet: true });
  } catch (error) {
    button.disabled = false;
    button.textContent = project.status === "failed" || project.status === "source_auth_required" ? "RETRY IMPORT" : "START PROCESSING";
    toast(error.message || "Could not start processing.");
  }
}

async function uploadIncomingSource(project, button) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/mp4,video/quicktime,.mp4,.mov,.m4v";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    button.disabled = true;
    button.textContent = "UPLOADING…";
    try {
      const formData = new FormData();
      formData.append("source", file);
      const response = await fetch(`/api/incoming/klipdose/${project.id}/source`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not attach this source.");
      toast("Authorized source attached. KlipPharma is processing it now.");
      await loadDashboardData({ quiet: true });
    } catch (error) {
      button.disabled = false;
      button.textContent = "UPLOAD AUTHORIZED SOURCE";
      toast(error.message || "Could not attach this source.");
    }
  }, { once: true });
  input.click();
}

async function archiveIncomingProject(project, button) {
  button.disabled = true;
  button.textContent = "ARCHIVING…";
  try {
    const response = await fetch(`/api/incoming/klipdose/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not archive project.");
    await loadDashboardData({ quiet: true });
  } catch (error) {
    button.disabled = false;
    button.textContent = "ARCHIVE";
    toast(error.message || "Could not archive project.");
  }
}

async function loadTeamPanel() {
  try {
    const response = await fetch("/api/team");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the Business workspace.");
    renderTeamPanel(data);
  } catch (error) {
    $("#dashboardError").textContent = error.message;
    $("#dashboardError").classList.remove("hidden");
  }
}

function renderTeamPanel(data) {
  const workspace = data.workspace || {};
  const members = workspace.members || [];
  const invitations = data.invitations || [];
  $("#teamWorkspaceName").textContent = workspace.name || "Business workspace";
  $("#teamSeatCount").textContent = `${members.length + invitations.length} of ${workspace.seatLimit || 5} seats assigned`;
  $("#teamInviteForm").classList.toggle("hidden", !workspace.canManageTeam);
  const memberRoot = $("#teamMembers");
  memberRoot.innerHTML = "";
  members.forEach((member) => {
    const row = document.createElement("div");
    row.className = "team-row";
    const copy = document.createElement("div");
    copy.innerHTML = `<strong></strong><span></span>`;
    copy.querySelector("strong").textContent = member.email;
    copy.querySelector("span").textContent = member.role;
    row.append(copy);
    if (workspace.canManageTeam && member.role !== "owner") {
      const role = document.createElement("select");
      ["admin", "editor", "viewer"].forEach((value) => role.add(new Option(value, value)));
      role.value = member.role;
      role.addEventListener("change", async () => {
        await teamRequest(`/api/team/members/${member.userId}`, "PATCH", { role: role.value });
        loadTeamPanel();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
        await teamRequest(`/api/team/members/${member.userId}`, "DELETE");
        loadTeamPanel();
      });
      row.append(role, remove);
    }
    memberRoot.append(row);
  });
  const inviteRoot = $("#teamInvitations");
  inviteRoot.innerHTML = invitations.length ? '<h4>Pending invitations</h4>' : "";
  invitations.forEach((invite) => {
    const row = document.createElement("div");
    row.className = "team-row";
    const copy = document.createElement("div");
    copy.innerHTML = `<strong></strong><span></span>`;
    copy.querySelector("strong").textContent = invite.email;
    copy.querySelector("span").textContent = `${invite.role} · pending`;
    row.append(copy);
    if (workspace.canManageTeam) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", async () => {
        await teamRequest(`/api/team/invitations/${invite.id}`, "DELETE");
        loadTeamPanel();
      });
      row.append(revoke);
    }
    inviteRoot.append(row);
  });
}

$("#teamInviteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await teamRequest("/api/team/invitations", "POST", {
    email: $("#teamInviteEmail").value,
    role: $("#teamInviteRole").value,
  });
  if (!data?.invitation) return;
  $("#teamInviteEmail").value = "";
  await navigator.clipboard?.writeText(data.invitation.inviteUrl).catch(() => {});
  window.prompt("Copy this secure invitation link and send it to your teammate:", data.invitation.inviteUrl);
  loadTeamPanel();
});

async function teamRequest(url, method, body = null) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    toast(data.error || "The team request could not be completed.");
    return null;
  }
  return data;
}

async function openSettings() {
  settingsModal.classList.remove("hidden");
  $("#settingsError").classList.add("hidden");
  $("#tiktokIntegrationBody").textContent = "Checking TikTok connection…";
  $("#tiktokIntegrationActions").innerHTML = "";
  $("#youtubeIntegrationBody").textContent = "Checking YouTube connection…";
  $("#youtubeIntegrationActions").innerHTML = "";
  await loadIntegrationsStatus();
}

async function loadIntegrationsStatus() {
  try {
    const response = await fetch("/api/integrations/status");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load integrations.");
    integrationsState = data;
    renderTikTokIntegration(data.tiktok);
    renderYouTubeIntegration(data.youtube);
    if (!dashboardModal.classList.contains("hidden")) renderDashboardPublishing(data, currentDashboardProjects);
  } catch (error) {
    $("#settingsError").textContent = error.message || "Could not load integrations.";
    $("#settingsError").classList.remove("hidden");
  }
}

function renderTikTokIntegration(tiktok) {
  const body = $("#tiktokIntegrationBody");
  const actions = $("#tiktokIntegrationActions");
  body.innerHTML = "";
  actions.innerHTML = "";
  if (!tiktok?.connected) {
    body.innerHTML = `<span class="status-badge muted">Not connected</span><p>Use a real TikTok sandbox or creator account. KlipPharma stores tokens server-side and never in browser storage.</p>`;
    const connect = document.createElement("button");
    connect.className = "primary integration-primary";
    connect.type = "button";
    connect.textContent = "Connect TikTok →";
    connect.addEventListener("click", () => {
      window.location.assign("/api/integrations/tiktok/oauth/start?returnTo=%2F%3Fsettings%3Dintegrations");
    });
    actions.append(connect);
    return;
  }
  const profile = tiktok.profile || {};
  const scopes = tiktok.scopes || [];
  const hasProfile = scopes.includes("user.info.profile");
  const hasStats = scopes.includes("user.info.stats");
  const hasVideos = scopes.includes("video.list");
  body.innerHTML = `
    <span class="status-badge connected">Connected</span>
    <div class="connected-profile tiktok-profile-card">
      <div class="tiktok-avatar-slot"></div>
      <div class="tiktok-profile-main">
        <div class="tiktok-name-line"><strong></strong><span class="verified-badge hidden">Verified</span></div>
        <small class="tiktok-username"></small>
        <p class="tiktok-bio hidden"></p>
        <a class="tiktok-profile-link hidden" target="_blank" rel="noopener noreferrer">View TikTok Profile</a>
        <small class="tiktok-open-id"></small>
      </div>
    </div>
    <div class="tiktok-stats-row hidden"></div>
    <div class="recent-tiktok-videos hidden">
      <div class="section-mini-head"><strong>Recent TikTok Videos</strong><small></small></div>
      <div class="tiktok-video-list">Loading recent videos…</div>
    </div>
    <p class="scope-list"></p>
  `;
  const avatarSlot = body.querySelector(".tiktok-avatar-slot");
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
    list.innerHTML = "<p>No public TikTok videos were returned for this sandbox account.</p>";
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
    $("#tiktokPublishConnection").innerHTML = 'TikTok is not connected. Open Settings > Integrations and authorize a sandbox account first.';
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
  if (tiktokResult === "connected") toast("TikTok connected. The reviewer can now see the connected state.");
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
