const transitionNames = new Set([
  "auto",
  "cut",
  "fade",
  "fadeblack",
  "slideleft",
  "slideright",
  "zoomin",
  "pixelize",
]);

export function normalizeTransition(value = "auto", fallback = "auto") {
  const key = String(value || "").trim().toLowerCase();
  return transitionNames.has(key) ? key : fallback;
}

export function resolveTransition(value = "auto", montageStyle = "fast", index = 0) {
  const selected = normalizeTransition(value);
  if (selected !== "auto") return selected;
  if (montageStyle === "story") return "fade";
  if (montageStyle === "music") return index % 2 ? "slideright" : "slideleft";
  if (montageStyle === "promo") return "fadeblack";
  return index % 3 === 2 ? "zoomin" : "cut";
}

export function normalizeTransitionDuration(value = 0.35) {
  const duration = Number(value);
  return Number.isFinite(duration)
    ? Math.round(Math.min(1.25, Math.max(0.15, duration)) * 100) / 100
    : 0.35;
}

export function transitionLabel(value = "auto") {
  return {
    auto: "Smart transitions",
    cut: "Clean cuts",
    fade: "Cross dissolve",
    fadeblack: "Dip to black",
    slideleft: "Slide left",
    slideright: "Slide right",
    zoomin: "Zoom",
    pixelize: "Digital pixel",
  }[normalizeTransition(value)] || "Smart transitions";
}

export function normalizeChromaColor(value = "#00ff00", fallback = "#00ff00") {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

export function normalizeChromaSimilarity(value = 0.12) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(Math.min(0.6, Math.max(0.01, number)) * 1000) / 1000
    : 0.12;
}

export function normalizeChromaBlend(value = 0.06) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(Math.min(0.5, Math.max(0, number)) * 1000) / 1000
    : 0.06;
}

export function appendChromaKeyFilter(filter, options = {}) {
  if (options.enabled !== true) return filter;
  const keyColor = normalizeChromaColor(options.keyColor).slice(1);
  const backgroundColor = normalizeChromaColor(options.backgroundColor, "#111111").slice(1);
  const similarity = normalizeChromaSimilarity(options.similarity);
  const blend = normalizeChromaBlend(options.blend);
  return `${filter},split=2[chroma_background][chroma_foreground];`
    + `[chroma_background]drawbox=x=0:y=0:w=iw:h=ih:color=0x${backgroundColor}:t=fill[chroma_fill];`
    + `[chroma_foreground]chromakey=color=0x${keyColor}:similarity=${similarity}:blend=${blend},format=yuva420p[chroma_subject];`
    + `[chroma_fill][chroma_subject]overlay=shortest=1:format=auto,format=yuv420p`;
}

export function planMontageTransitions(segments, transitionStyle = "auto", montageStyle = "fast", transitionDuration = 0.35) {
  const duration = normalizeTransitionDuration(transitionDuration);
  const normalizedStyle = normalizeTransition(transitionStyle);
  if (!Array.isArray(segments)) return [];
  return segments.map((segment, index) => {
    const momentChoice = normalizeTransition(segment.transitionAfter);
    const transitionAfter = index >= segments.length - 1
      ? "cut"
      : resolveTransition(
        momentChoice === "auto" ? normalizedStyle : momentChoice,
        segment.montageStyle || montageStyle,
        index,
      );
    return {
      ...segment,
      transitionAfter,
      renderDuration: Number(segment.duration) + (transitionAfter === "cut" ? 0 : duration),
    };
  });
}

export function buildMontageTransitionGraph(segments, transitionStyle = "auto", transitionDuration = 0.35) {
  if (!Array.isArray(segments) || segments.length < 2) return null;
  const duration = normalizeTransitionDuration(transitionDuration);
  const normalizedStyle = normalizeTransition(transitionStyle);
  const transitions = segments.slice(0, -1).map((segment, index) => {
    const momentChoice = normalizeTransition(segment.transitionAfter);
    return resolveTransition(
      momentChoice === "auto" ? normalizedStyle : momentChoice,
      segment.montageStyle || "fast",
      index,
    );
  });
  if (transitions.every((transition) => transition === "cut")) return null;

  const filters = [];
  segments.forEach((segment, index) => {
    filters.push(`[${index}:v]setpts=PTS-STARTPTS,fps=30[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`);
  });

  let videoLabel = "v0";
  let audioLabel = "a0";
  let elapsed = Number(segments[0].duration) || 0;
  transitions.forEach((transition, index) => {
    const videoOutput = `vx${index + 1}`;
    const audioOutput = `ax${index + 1}`;
    if (transition === "cut") {
      filters.push(`[${videoLabel}][v${index + 1}]concat=n=2:v=1:a=0[${videoOutput}]`);
      filters.push(`[${audioLabel}][a${index + 1}]concat=n=2:v=0:a=1[${audioOutput}]`);
    } else {
      filters.push(`[${videoLabel}][v${index + 1}]xfade=transition=${transition}:duration=${duration}:offset=${elapsed.toFixed(3)}[${videoOutput}]`);
      filters.push(`[${audioLabel}][a${index + 1}]acrossfade=d=${duration}:c1=tri:c2=tri[${audioOutput}]`);
    }
    videoLabel = videoOutput;
    audioLabel = audioOutput;
    elapsed += Number(segments[index + 1].duration) || 0;
  });
  return {
    filterComplex: filters.join(";"),
    videoMap: `[${videoLabel}]`,
    audioMap: `[${audioLabel}]`,
    transitions,
    duration,
  };
}
