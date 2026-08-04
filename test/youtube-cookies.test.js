import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  YOUTUBE_AUTH_REQUIRED_MESSAGE,
  createYouTubeCookiesOption,
  hasYouTubeCookieSource,
  isYouTubeAuthRequiredError,
  youtubeImportFailurePatch,
} from "../lib/youtube-cookies.js";

const cookieText = [
  "# Netscape HTTP Cookie File",
  ".youtube.com\tTRUE\t/\tTRUE\t2147483647\tVISITOR_INFO1_LIVE\ttest-secret-cookie",
  "",
].join("\n");

test("base64 cookies decode to a strict temporary cookies file", () => {
  const option = createYouTubeCookiesOption({ YOUTUBE_COOKIES_BASE64: Buffer.from(cookieText).toString("base64") });
  try {
    assert.equal(option.source, "base64");
    assert.equal(option.args[0], "--cookies");
    const filePath = option.args[1];
    assert.equal(fs.readFileSync(filePath, "utf8"), cookieText);
    assert.equal((fs.statSync(filePath).mode & 0o777), 0o600);
  } finally {
    const filePath = option.args[1];
    option.cleanup();
    assert.equal(fs.existsSync(filePath), false);
  }
});

test("local cookie file is passed to yt-dlp without copying contents into args", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klippharma-test-cookies-"));
  const filePath = path.join(dir, "cookies.txt");
  fs.writeFileSync(filePath, cookieText, { mode: 0o600 });
  try {
    const option = createYouTubeCookiesOption({ YTDLP_COOKIES_FILE: filePath, YOUTUBE_COOKIES_BASE64: "" });
    assert.deepEqual(option.args, ["--cookies", filePath]);
    assert.equal(option.args.join(" ").includes("test-secret-cookie"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cookie source detection supports production and local configuration", () => {
  assert.equal(hasYouTubeCookieSource({}), false);
  assert.equal(hasYouTubeCookieSource({ YOUTUBE_COOKIES_BASE64: "abc" }), true);
  assert.equal(hasYouTubeCookieSource({ YTDLP_COOKIES_FILE: "/tmp/cookies.txt" }), true);
});

test("missing cookies bot challenge produces source_auth_required", () => {
  const error = new Error("yt-dlp exited 1: ERROR: [youtube] Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for authentication.");
  assert.equal(isYouTubeAuthRequiredError(error), true);
  const patch = youtubeImportFailurePatch(error);
  assert.equal(patch.status, "source_auth_required");
  assert.equal(patch.phase, "source_auth_required");
  assert.equal(patch.error, YOUTUBE_AUTH_REQUIRED_MESSAGE);
});

test("non-auth YouTube failures remain regular import failures", () => {
  const patch = youtubeImportFailurePatch(new Error("yt-dlp exited 1: unsupported URL"), "YouTube import failed");
  assert.equal(patch.status, "failed");
  assert.equal(patch.stage, "YouTube import failed");
  assert.equal(patch.error, null);
});

test("YouTube blocked downloads keep the project as source_auth_required instead of losing metadata", () => {
  const error = new Error("ERROR: [youtube] Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for authentication.");
  const patch = youtubeImportFailurePatch(error, "Klipdose source import failed");
  assert.equal(patch.status, "source_auth_required");
  assert.match(patch.error, /YouTube requires authenticated access/);
});
