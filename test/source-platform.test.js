import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSafePublicUrl,
  classifyKickImportError,
  detectSourcePlatform,
  extractM3u8Url,
  isPrivateIp,
  isRetryableSourceStatus,
  platformBadgeForSource,
} from "../lib/source-platform.js";
import { applyAuthorizedSourceAttachment, authorizedSourceAttachmentPatch } from "../lib/klipdose-attachment.js";

test("detects Kick VOD URLs", () => {
  const detected = detectSourcePlatform("https://kick.com/kai/videos/123456");
  assert.equal(detected.sourcePlatform, "kick");
  assert.equal(detected.sourceType, "kick_vod");
  assert.equal(detected.kickChannel, "kai");
  assert.equal(detected.kickVideoId, "123456");
  assert.equal(platformBadgeForSource(detected.sourcePlatform), "KICK");
});

test("detects Kick live channel URLs as awaiting VOD candidates", () => {
  const detected = detectSourcePlatform("https://kick.com/kai");
  assert.equal(detected.sourcePlatform, "kick");
  assert.equal(detected.sourceType, "kick_live");
});

test("extracts Kick m3u8 manifests from public playback data", () => {
  const manifest = extractM3u8Url('{"playback_url":"https:\\/\\/stream.kick.com\\/vod\\/abc\\/master.m3u8?token=123"}');
  assert.equal(manifest, "https://stream.kick.com/vod/abc/master.m3u8?token=123");
});

test("classifies awaiting_vod status", () => {
  const error = new Error("Kick stream is currently live");
  error.code = "KICK_AWAITING_VOD";
  const patch = classifyKickImportError(error);
  assert.equal(patch.status, "awaiting_vod");
  assert.equal(isRetryableSourceStatus(patch.status), true);
});

test("classifies source_unavailable status", () => {
  const error = new Error("Kick VOD expired");
  error.code = "SOURCE_UNAVAILABLE";
  const patch = classifyKickImportError(error);
  assert.equal(patch.status, "source_unavailable");
  assert.equal(isRetryableSourceStatus(patch.status), true);
});

test("detects direct MP4 and direct M3U8 imports", () => {
  assert.equal(detectSourcePlatform("https://cdn.example.com/video.mp4").sourceType, "direct_media");
  assert.equal(detectSourcePlatform("https://cdn.example.com/live/master.m3u8").sourceType, "direct_media");
  assert.equal(platformBadgeForSource("direct"), "DIRECT");
});

test("detects YouTube and external link fallback sources", () => {
  assert.equal(detectSourcePlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ").sourceType, "youtube");
  assert.equal(detectSourcePlatform("https://example.com/post/123").sourceType, "external_link");
});

test("blocks SSRF targets before direct import", async () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.1.2.3"), true);
  assert.equal(isPrivateIp("192.168.1.10"), true);
  await assert.rejects(
    () => assertSafePublicUrl("https://localhost/video.mp4", async () => [{ address: "127.0.0.1" }]),
    /Local source URLs/,
  );
  await assert.rejects(
    () => assertSafePublicUrl("https://media.example.com/video.mp4", async () => [{ address: "10.0.0.5" }]),
    /private network/,
  );
  await assert.doesNotReject(
    () => assertSafePublicUrl("https://media.example.com/video.mp4", async () => [{ address: "93.184.216.34" }]),
  );
});

test("upload attachment updates the existing Klipdose project without changing identity", () => {
  const job = {
    id: "existing-project",
    batchId: "existing-project",
    integrationSource: "klipdose",
    status: "link_only",
    sourceReady: false,
  };
  const patched = applyAuthorizedSourceAttachment(job, authorizedSourceAttachmentPatch({
    filePath: "/tmp/existing-project.mp4",
    mimeType: "video/mp4",
    uploadedAt: "2026-08-04T12:00:00.000Z",
  }));
  assert.equal(patched, job);
  assert.equal(patched.id, "existing-project");
  assert.equal(patched.batchId, "existing-project");
  assert.equal(patched.status, "queued");
  assert.equal(patched.sourceReady, true);
  assert.equal(patched.sourceAttachmentUploadedAt, "2026-08-04T12:00:00.000Z");
});
