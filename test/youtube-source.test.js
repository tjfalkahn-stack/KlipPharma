import test from "node:test";
import assert from "node:assert/strict";
import { normalizeYouTubeSource, sanitizeYouTubeTitle } from "../lib/youtube.js";

test("normalizes YouTube watch links", () => {
  assert.deepEqual(normalizeYouTubeSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
});

test("normalizes Shorts and youtu.be links", () => {
  assert.equal(normalizeYouTubeSource("https://youtube.com/shorts/dQw4w9WgXcQ").videoId, "dQw4w9WgXcQ");
  assert.equal(normalizeYouTubeSource("https://youtu.be/dQw4w9WgXcQ?t=12").videoId, "dQw4w9WgXcQ");
});

test("rejects playlists and non-YouTube links", () => {
  assert.throws(() => normalizeYouTubeSource("https://www.youtube.com/playlist?list=PL123"));
  assert.throws(() => normalizeYouTubeSource("https://example.com/watch?v=dQw4w9WgXcQ"));
});

test("sanitizes downloaded titles", () => {
  assert.equal(sanitizeYouTubeTitle('My "Video" / Test'), "My Video Test");
});
