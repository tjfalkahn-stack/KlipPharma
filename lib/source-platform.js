import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";

export const DIRECT_MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".m3u8"]);

export function detectSourcePlatform(sourceUrl) {
  const url = new URL(sourceUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.toLowerCase();
  const extension = path.extname(pathname);

  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    return { sourcePlatform: "youtube", sourceType: "youtube", canonicalUrl: sourceUrl };
  }

  if (host === "kick.com" || host.endsWith(".kick.com")) {
    const segments = pathname.split("/").filter(Boolean);
    const vodByChannel = segments.length >= 3 && segments[1] === "videos";
    const vodByVideoPath = segments[0] === "video" || segments[0] === "videos";
    return {
      sourcePlatform: "kick",
      sourceType: vodByChannel || vodByVideoPath ? "kick_vod" : "kick_live",
      canonicalUrl: sourceUrl,
      kickChannel: segments[0] && !new Set(["video", "videos"]).has(segments[0]) ? segments[0] : null,
      kickVideoId: vodByChannel ? segments[2] : vodByVideoPath ? segments[1] || null : null,
    };
  }

  if (DIRECT_MEDIA_EXTENSIONS.has(extension)) {
    return { sourcePlatform: "direct", sourceType: "direct_media", canonicalUrl: sourceUrl, extension };
  }

  return { sourcePlatform: "external", sourceType: "external_link", canonicalUrl: sourceUrl };
}

export function platformBadgeForSource(sourcePlatform) {
  const platform = String(sourcePlatform || "").toLowerCase();
  if (platform === "kick") return "KICK";
  if (platform === "youtube") return "YOUTUBE";
  if (platform === "direct") return "DIRECT";
  return "EXTERNAL";
}

export function isRetryableSourceStatus(status) {
  return new Set(["awaiting_vod", "source_auth_required", "source_unavailable", "failed"]).has(status);
}

export function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((part) => Number(part));
    const [a, b] = parts;
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a === 0;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe80:")
      || normalized === "::"
      || normalized.startsWith("::ffff:127.")
      || normalized.startsWith("::ffff:10.")
      || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

export async function assertSafePublicUrl(sourceUrl, resolver = dns.lookup) {
  const url = new URL(sourceUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Only http and https source URLs are supported.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Local source URLs are not allowed.");
  const records = await resolver(host, { all: true, verbatim: true });
  const addresses = Array.isArray(records) ? records : [records];
  if (!addresses.length || addresses.some((record) => isPrivateIp(record.address))) {
    throw new Error("That source URL resolves to a private network address.");
  }
  return url;
}

export function classifyKickImportError(error) {
  const message = String(error?.message || "");
  if (error?.code === "KICK_AWAITING_VOD" || /currently live|awaiting vod/i.test(message)) {
    return {
      status: "awaiting_vod",
      phase: "awaiting_vod",
      stage: "Kick stream is live · waiting for VOD",
      error: "This Kick stream is still live. Retry import after the VOD is available.",
    };
  }
  if (error?.code === "SOURCE_UNAVAILABLE" || /expired|unavailable|not found|no playback/i.test(message)) {
    return {
      status: "source_unavailable",
      phase: "source_unavailable",
      stage: "Source media unavailable",
      error: "The source VOD is unavailable or expired. The original source link is still saved.",
    };
  }
  return null;
}

export function extractM3u8Url(text) {
  const value = String(text || "").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  const direct = value.match(/https?:\/\/[^"' <>)]+\.m3u8[^"' <>)\\]*/i);
  if (direct) return direct[0];
  const jsonLike = value.match(/"([^"]+\.m3u8[^"]*)"/i);
  return jsonLike ? jsonLike[1].replace(/\\\//g, "/") : null;
}
