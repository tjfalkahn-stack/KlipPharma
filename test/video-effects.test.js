import test from "node:test";
import assert from "node:assert/strict";
import {
  appendChromaKeyFilter,
  buildMontageTransitionGraph,
  normalizeChromaBlend,
  normalizeChromaColor,
  normalizeChromaSimilarity,
  normalizeTransition,
  normalizeTransitionDuration,
  planMontageTransitions,
  resolveTransition,
} from "../lib/video-effects.js";

test("transition choices reject unknown FFmpeg filter names", () => {
  assert.equal(normalizeTransition("fade"), "fade");
  assert.equal(normalizeTransition("not-a-filter"), "auto");
  assert.equal(normalizeTransition("not-a-filter", "cut"), "cut");
});

test("smart transitions follow the selected editing rhythm", () => {
  assert.equal(resolveTransition("auto", "story", 0), "fade");
  assert.equal(resolveTransition("auto", "promo", 0), "fadeblack");
  assert.equal(resolveTransition("auto", "music", 0), "slideleft");
  assert.equal(resolveTransition("auto", "music", 1), "slideright");
  assert.equal(resolveTransition("cut", "story", 0), "cut");
});

test("transition duration is kept inside a safe render range", () => {
  assert.equal(normalizeTransitionDuration(0), 0.15);
  assert.equal(normalizeTransitionDuration(3), 1.25);
  assert.equal(normalizeTransitionDuration("bad"), 0.35);
});

test("transition graph supports automatic and per-moment overrides", () => {
  const graph = buildMontageTransitionGraph([
    { duration: 4, montageStyle: "story", transitionAfter: "auto" },
    { duration: 5, montageStyle: "story", transitionAfter: "slideleft" },
    { duration: 6, montageStyle: "story" },
  ], "auto", 0.4);
  assert.deepEqual(graph.transitions, ["fade", "slideleft"]);
  assert.match(graph.filterComplex, /xfade=transition=fade:duration=0\.4:offset=4\.000/);
  assert.match(graph.filterComplex, /xfade=transition=slideleft:duration=0\.4:offset=9\.000/);
  assert.match(graph.filterComplex, /acrossfade=d=0\.4:c1=tri:c2=tri/);
  assert.equal(graph.audioMap, "[ax2]");
});

test("moments using the Auto-Mix default follow an explicit batch transition", () => {
  const graph = buildMontageTransitionGraph([
    { duration: 4, montageStyle: "fast", transitionAfter: "auto" },
    { duration: 5, montageStyle: "fast" },
  ], "fadeblack", 0.35);
  assert.deepEqual(graph.transitions, ["fadeblack"]);
  assert.match(graph.filterComplex, /xfade=transition=fadeblack/);
});

test("clean-cut batches keep the fast concat path", () => {
  assert.equal(buildMontageTransitionGraph([
    { duration: 4, transitionAfter: "cut" },
    { duration: 5 },
  ], "cut"), null);
});

test("transition planning adds only the overlap needed to preserve final runtime", () => {
  const planned = planMontageTransitions([
    { duration: 20, transitionAfter: "fade" },
    { duration: 25, transitionAfter: "cut" },
    { duration: 15, transitionAfter: "slideleft" },
  ], "auto", "story", 0.4);
  assert.deepEqual(planned.map(({ transitionAfter }) => transitionAfter), ["fade", "cut", "cut"]);
  assert.deepEqual(planned.map(({ renderDuration }) => renderDuration), [20.4, 25, 15]);
  assert.equal(planned.reduce((sum, segment) => sum + segment.duration, 0), 60);
});

test("green-screen settings are normalized before entering FFmpeg", () => {
  assert.equal(normalizeChromaColor("#00FF00"), "#00ff00");
  assert.equal(normalizeChromaColor("green"), "#00ff00");
  assert.equal(normalizeChromaSimilarity(99), 0.6);
  assert.equal(normalizeChromaBlend(-2), 0);
  const filter = appendChromaKeyFilter("scale=1080:1920", {
    enabled: true,
    keyColor: "#00ff00",
    backgroundColor: "#663399",
    similarity: 0.18,
    blend: 0.04,
  });
  assert.match(filter, /chromakey=color=0x00ff00:similarity=0\.18:blend=0\.04/);
  assert.match(filter, /drawbox=.*color=0x663399:t=fill/);
});

test("green-screen filter is a no-op when disabled", () => {
  assert.equal(appendChromaKeyFilter("scale=1080:1920", { enabled: false }), "scale=1080:1920");
});
