import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYouTubeSource, sanitizeYouTubeTitle } from "../lib/youtube.js";

const videoId = "dQw4w9WgXcQ";

test("normalizes supported YouTube video URL shapes", () => {
  const urls = [
    `https://www.youtube.com/watch?v=${videoId}&list=ignored`,
    `https://youtu.be/${videoId}?si=ignored`,
    `https://youtube.com/shorts/${videoId}`,
    `https://m.youtube.com/watch?v=${videoId}`,
    `https://music.youtube.com/watch?v=${videoId}`,
  ];

  for (const url of urls) {
    assert.deepEqual(normalizeYouTubeSource(url), {
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
});

test("rejects non-YouTube hosts and invalid video IDs", () => {
  assert.throws(() => normalizeYouTubeSource("https://example.com/watch?v=dQw4w9WgXcQ"), /youtube\.com or youtu\.be/);
  assert.throws(() => normalizeYouTubeSource("https://youtube.com/watch?v=too-short"), /valid YouTube video ID/);
  assert.throws(() => normalizeYouTubeSource("not a URL"), /valid YouTube video link/);
});

test("sanitizes downloaded titles before using them as filenames", () => {
  assert.equal(sanitizeYouTubeTitle('My: "Video" / Final?'), "My Video Final");
  assert.equal(sanitizeYouTubeTitle("   "), "YouTube video");
  assert.equal(sanitizeYouTubeTitle("x".repeat(200)).length, 140);
});
