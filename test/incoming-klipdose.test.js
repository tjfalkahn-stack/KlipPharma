import test from "node:test";
import assert from "node:assert/strict";
import {
  isArchivedKlipdoseProject,
  klipdoseIncomingStats,
  klipdoseProjectForClient,
  visibleKlipdoseProjects,
} from "../lib/incoming-klipdose.js";

function project(overrides = {}) {
  return {
    id: overrides.id || "cf84655e-057c-48e6-996b-a71790cb2835",
    userId: overrides.userId || "owner-1",
    integrationSource: "klipdose",
    originalName: "Kai Cenat newest upload",
    creatorName: "Kai Cenat",
    sourceUrl: "https://www.youtube.com/watch?v=abc123XYZ90",
    thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ90/hqdefault.jpg",
    opportunityScore: 91,
    confidence: 88,
    recommendedAction: "Review the first 20 minutes.",
    createdAt: "2026-08-04T12:00:00.000Z",
    status: "processing",
    ...overrides,
  };
}

test("accepted Klipdose project metadata renders for the UI", () => {
  const visible = klipdoseProjectForClient(project());
  assert.equal(visible.id, "cf84655e-057c-48e6-996b-a71790cb2835");
  assert.equal(visible.creatorName, "Kai Cenat");
  assert.equal(visible.sourceUrl, "https://www.youtube.com/watch?v=abc123XYZ90");
  assert.equal(visible.thumbnailUrl, "https://i.ytimg.com/vi/abc123XYZ90/hqdefault.jpg");
  assert.equal(visible.opportunityScore, 91);
  assert.equal(visible.confidence, 88);
  assert.equal(visible.sourceBadge, "KLIPDOSE");
});

test("open in editor uses the existing project id instead of creating a duplicate", () => {
  const original = project();
  const visible = klipdoseProjectForClient(original);
  assert.equal(visible.id, original.id);
  assert.equal(visible.batchId, original.id);
});

test("unauthorized users cannot see another owner's incoming project", () => {
  const incoming = [project({ userId: "owner-1" }), project({ id: "other", userId: "owner-2" })];
  const visible = visibleKlipdoseProjects(incoming, (job) => job.userId === "owner-1");
  assert.deepEqual(visible.map((item) => item.id), ["cf84655e-057c-48e6-996b-a71790cb2835"]);
});

test("archived project disappears from the active incoming inbox", () => {
  const incoming = [project(), project({ id: "archived", archivedAt: "2026-08-04T12:05:00.000Z" })];
  assert.equal(isArchivedKlipdoseProject(incoming[1]), true);
  const visible = visibleKlipdoseProjects(incoming, () => true);
  assert.deepEqual(visible.map((item) => item.id), ["cf84655e-057c-48e6-996b-a71790cb2835"]);
});

test("dashboard counters separate new, processing, ready, and failed handoffs", () => {
  const stats = klipdoseIncomingStats([
    project({ id: "new", status: "accepted" }),
    project({ id: "processing", status: "processing" }),
    project({ id: "ready", status: "ready" }),
    project({ id: "failed", status: "failed" }),
    project({ id: "hidden", status: "ready", archivedAt: "2026-08-04T12:05:00.000Z" }),
  ]);
  assert.deepEqual(stats, { new: 1, processing: 1, ready: 1, failed: 1 });
});
