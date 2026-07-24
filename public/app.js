const $ = (selector) => document.querySelector(selector);
const form = $("#uploadForm");
const appShell = $("#appShell");
const authView = $("#authView");
const authForm = $("#authForm");
const authSwitch = $("#authSwitch");
const authError = $("#authError");
const accountMenu = $("#accountMenu");
const videoInput = $("#video");
const dropzone = $("#dropzone");
const youtubeUrl = $("#youtubeUrl");
const youtubeMode = $("#youtubeMode");
const youtubeOwnership = $("#youtubeOwnership");
const youtubeImportButton = $("#youtubeImportButton");
const youtubeImportStatus = $("#youtubeImportStatus");
const uploadView = $("#uploadView");
const processingView = $("#processingView");
const resultsView = $("#resultsView");
const autoMixBuilder = $("#autoMixBuilder");
const autoMixToggle = $("#createMontage");
const deleteBatchButton = $("#deleteBatch");
const translationLanguage = $("#translationLanguage");
const audioTranslation = $("#audioTranslation");
const dubVoice = $("#dubVoice");
const audioTranslationHelp = $("#audioTranslationHelp");
let selectedFiles = [];
const fileModes = new Map();
let currentProjects = [];
let pollTimer;
const previewRecovery = new Map();
let previewRecoveryQueue = Promise.resolve();
let creatingAccount = false;
let uploadMode = "local";
let currentUser = null;
const paidPlanTiers = new Set(["paid", "pro", "creator", "studio", "business"]);
const creatorModeCopy = {
  auto: ["Smart Detect", "Balanced selection for mixed or general content."],
  artist: ["Artist / Music", "Protects complete lyrical phrases, favors memorable song and artist-story moments, and renders final audio at a higher bitrate."],
  podcast: ["Podcast / Interview", "Keeps essential questions and answers together while finding insights, debates, stories, humor, and reactions."],
  monologue: ["Monologue / Talking Head", "Cuts slow introductions and prioritizes cold opens, lessons, hot takes, personal stories, and direct calls to action."],
};
const languageNames = {
  en: "English", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", it: "Italian",
  ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic", hi: "Hindi",
};

function isPaidPlan(user = currentUser) {
  return paidPlanTiers.has(String(user?.planTier || "free").trim().toLowerCase());
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
  const result = addSelectedFiles([...videoInput.files]);
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
        watermarkText: settings.get("watermarkText"),
        watermarkPosition: settings.get("watermarkPosition"),
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
    const fileOptions = selectedFiles.map((file) => ({ transcribe: fileModes.get(fileKey(file)) !== false }));
    formData.set("fileOptions", JSON.stringify(fileOptions));
    const response = uploadMode === "direct"
      ? await uploadBatchDirectly(formData, fileOptions)
      : await fetch("/api/projects", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    currentProjects = data.ids || [data.id];
    await pollProjects();
  } catch (error) {
    toast(error.message || "Upload failed.");
    setView("upload");
  }
});

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

  let completed = 0;
  await Promise.all(prepared.uploads.map(async (upload, index) => {
    const response = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": upload.type || selectedFiles[index].type || "application/octet-stream" },
      body: selectedFiles[index],
    });
    if (!response.ok) throw new Error(`Cloud upload failed for ${selectedFiles[index].name}. Check the R2 CORS policy.`);
    completed += 1;
    const progress = 8 + Math.round((completed / selectedFiles.length) * 72);
    $("#stage").textContent = `Uploaded ${completed} of ${selectedFiles.length} sources`;
    $("#progressBar").style.width = `${progress}%`;
    $("#progressText").textContent = `${progress}% · private R2 transfer`;
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
  };
  return fetch("/api/projects/cloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
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
    const sourcesFinished = projects.every((project) => project.status === "ready" || project.status === "failed");
    const montage = projects.find((project) => project.montage)?.montage;
    const montageFinished = !montage || montage.status === "ready" || montage.status === "failed";
    const finished = sourcesFinished && montageFinished;
    if (finished) {
      const successful = projects.filter((project) => project.status === "ready");
      if (!successful.length) {
        toast(projects[0]?.error || "The batch could not be processed.");
        setView("upload");
        return;
      }
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
  const average = Math.round(projects.reduce((sum, project) => sum + Number(project.progress || 0), 0) / projects.length);
  const ready = projects.filter((project) => project.status === "ready").length;
  const active = projects.filter((project) => project.status === "processing").length;
  const montage = projects.find((project) => project.montage)?.montage;
  const buildingMontage = montage && (montage.status === "waiting" || montage.status === "rendering");
  $("#stage").textContent = buildingMontage
    ? montage.status === "rendering" ? "Building one Auto-Mix from your batch" : "Auto-Mix is waiting for every source"
    : ready
    ? `${ready} of ${projects.length} videos ready`
    : active
      ? `Processing ${projects.length} ${projects.length === 1 ? "video" : "videos"}`
      : "Your batch is queued";
  $("#progressBar").style.width = `${average}%`;
  $("#progressText").textContent = buildingMontage ? "Individual klips ready · assembling Auto-Mix" : `${average}% total`;
  const statusBox = $("#batchStatus");
  statusBox.innerHTML = "";
  projects.forEach((project) => {
    const row = document.createElement("div");
    row.className = `batch-row ${project.status}`;
    const name = document.createElement("span");
    name.textContent = project.originalName;
    const detail = document.createElement("strong");
    detail.textContent = project.status === "ready"
      ? `${project.clips?.length || 0} klips ready`
      : project.status === "failed"
        ? "Needs attention"
        : project.status === "queued"
          ? "Queued"
          : `${project.progress || 0}% · ${project.stage}`;
    row.append(name, detail);
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
    const deleteOutput = document.createElement("button");
    deleteOutput.type = "button";
    deleteOutput.className = "automix-delete";
    deleteOutput.textContent = "Delete Auto-Mix MP4";
    deleteOutput.addEventListener("click", () => deleteMontageExport(owner, deleteOutput));
    actions.append(badge, review, download, deleteOutput);
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
    const deleteExport = node.querySelector(".delete-export");
    if (clip.renderStatus === "ready" && clip.downloadUrl) {
      renderButton.classList.add("hidden");
      download.href = clip.downloadUrl;
      download.classList.remove("hidden");
      deleteExport.classList.remove("hidden");
    }
    renderButton.addEventListener("click", async (event) => {
      try {
        await card.trimController.save();
        await renderVideo(project.id, clip.id, event.currentTarget, card);
      } catch (error) {
        toast(error.message || "Could not save this cut.");
      }
    });
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
  const transfer = new DataTransfer();
  selectedFiles.forEach((file) => transfer.items.add(file));
  videoInput.files = transfer.files;
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
  button.classList.add("hidden");
  const render = card.querySelector(".render");
  render.classList.remove("hidden");
  render.disabled = false;
  render.textContent = "Create vertical clip";
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
  const captionsEnabled = card.querySelector(".captions-enabled");
  const captionText = card.querySelector(".caption-text");
  const captionStyle = card.querySelector(".caption-style");
  const captionPosition = card.querySelector(".caption-position");
  const watermarkText = card.querySelector(".watermark-text");
  const watermarkPosition = card.querySelector(".watermark-position");
  const focusInput = card.querySelector(".focus-x");
  const focusLabel = card.querySelector(".focus-label");
  const focusPresets = [...card.querySelectorAll(".focus-presets button")];
  const overlaySaveState = card.querySelector(".overlay-save-state");
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
  };
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
    if (previewReady && Number.isFinite(seekTo)) {
      previewingSelection = false;
      video.pause();
      video.currentTime = Math.min(Math.max(0, seekTo), mediaDuration);
    }
  }

  function markCutChanged() {
    renderButton.classList.remove("hidden");
    renderButton.disabled = false;
    renderButton.textContent = "Create vertical clip";
    download.classList.add("hidden");
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
  button.textContent = "Rendering…";
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
      card.querySelector(".delete-export").classList.remove("hidden");
      toast("Vertical clip is ready.");
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
function setView(view) { uploadView.classList.toggle("hidden", view !== "upload"); processingView.classList.toggle("hidden", view !== "processing"); resultsView.classList.toggle("hidden", view !== "results"); }
function clock(seconds) { const m=Math.floor(seconds/60); return `${m}:${String(Math.floor(seconds%60)).padStart(2,"0")}`; }
function preciseClock(seconds) { const m=Math.floor(seconds/60); return `${m}:${String((seconds%60).toFixed(1)).padStart(4,"0")}`; }
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
    authForm.reset();
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

async function bootstrapApplication() {
  try {
    const [response, healthResponse] = await Promise.all([fetch("/api/auth/session"), fetch("/api/health")]);
    const data = await response.json();
    const health = healthResponse.ok ? await healthResponse.json() : {};
    uploadMode = health.uploadMode || "local";
    if (!response.ok) throw new Error(data.error);
    if (data.authenticated) {
      showApplication(data.user);
      await loadRecentProjects();
    } else {
      showAuthentication();
    }
  } catch (error) {
    showAuthentication();
    authError.textContent = error.message || "KlipPharma could not reach the account service.";
    authError.classList.remove("hidden");
  }
}

function showApplication(user) {
  currentUser = user || null;
  authView.classList.add("hidden");
  appShell.classList.remove("hidden");
  paintBrandPolicy(document);
  if (user?.local) {
    accountMenu.classList.add("hidden");
  } else {
    $("#accountEmail").textContent = user?.email || "Creator";
    accountMenu.classList.remove("hidden");
  }
}

function showAuthentication() {
  currentUser = null;
  appShell.classList.add("hidden");
  accountMenu.classList.add("hidden");
  authView.classList.remove("hidden");
  $("#authEmail").focus();
}

bootstrapApplication();
