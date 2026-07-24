export function normalizeYouTubeSource(value = "") {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Paste a valid YouTube video link.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  if (hostname === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "music.youtube.com") {
    if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v") || "";
    else {
      const match = parsed.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      videoId = match?.[1] || "";
    }
  } else {
    throw new Error("Use a youtube.com or youtu.be video link.");
  }

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("That link does not contain a valid YouTube video ID.");
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

export function sanitizeYouTubeTitle(value = "YouTube video") {
  return String(value || "YouTube video")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "YouTube video";
}
