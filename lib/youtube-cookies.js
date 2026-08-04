import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const YOUTUBE_AUTH_REQUIRED_MESSAGE =
  "YouTube requires authenticated access for this source. Add a valid cookies file or open the source manually.";

export function hasYouTubeCookieSource(env = process.env) {
  return Boolean(String(env.YTDLP_COOKIES_FILE || "").trim() || String(env.YOUTUBE_COOKIES_BASE64 || "").trim());
}

export function createYouTubeCookiesOption(env = process.env) {
  const configuredFile = String(env.YTDLP_COOKIES_FILE || "").trim();
  if (configuredFile) {
    fs.accessSync(configuredFile, fs.constants.R_OK);
    return { args: ["--cookies", configuredFile], source: "file", cleanup: () => {} };
  }

  const encoded = String(env.YOUTUBE_COOKIES_BASE64 || "").trim();
  if (!encoded) return { args: [], source: "none", cleanup: () => {} };

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (!decoded.trim()) throw new Error("YOUTUBE_COOKIES_BASE64 decoded to an empty cookies file.");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klippharma-youtube-cookies-"));
  const filePath = path.join(dir, "cookies.txt");
  fs.writeFileSync(filePath, decoded, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);

  return {
    args: ["--cookies", filePath],
    source: "base64",
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup only. The file lives under the OS temp directory with 0600 permissions.
      }
    },
  };
}

export function isYouTubeAuthRequiredError(error) {
  const message = String(error?.message || "");
  return /sign in to confirm/i.test(message)
    || /not a bot/i.test(message)
    || /use --cookies-from-browser or --cookies/i.test(message)
    || (/cookies/i.test(message) && /authentication/i.test(message));
}

export function youtubeImportFailurePatch(error, fallbackStage = "Klipdose source import failed") {
  if (error?.code === "YOUTUBE_SOURCE_AUTH_REQUIRED" || isYouTubeAuthRequiredError(error)) {
    return {
      status: "source_auth_required",
      phase: "source_auth_required",
      stage: "YouTube source requires authenticated access",
      error: YOUTUBE_AUTH_REQUIRED_MESSAGE,
    };
  }

  return {
    status: "failed",
    phase: "failed",
    stage: fallbackStage,
    error: null,
  };
}
