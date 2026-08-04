import test from "node:test";
import assert from "node:assert/strict";
import {
  isArchivedKlipdoseProject,
  klipdoseIncomingStats,
  klipdoseProjectForClient,
  visibleKlipdoseProjects,
} from "../lib/incoming-klipdose.js";
import { parseIncomingKlipdoseResponse } from "../lib/incoming-api-contract.js";

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
    project({ id: "auth-required", status: "source_auth_required" }),
    project({ id: "hidden", status: "ready", archivedAt: "2026-08-04T12:05:00.000Z" }),
  ]);
  assert.deepEqual(stats, { new: 1, processing: 1, ready: 1, failed: 2 });
});

test("source auth required projects remain visible with user-facing error", () => {
  const incoming = [
    project({
      id: "auth-required",
      status: "source_auth_required",
      phase: "source_auth_required",
      stage: "YouTube source requires authenticated access",
      error: "YouTube requires authenticated access for this source. Add a valid cookies file or open the source manually.",
    }),
  ];
  const visible = visibleKlipdoseProjects(incoming, () => true).map(klipdoseProjectForClient);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].status, "source_auth_required");
  assert.match(visible[0].error, /YouTube requires authenticated access/);
});

test("parses the production Incoming Projects API shape with failed projects", () => {
  const productionShape = {
    projects: ["one", "two", "three"].map((id) => ({
      id,
      batchId: id,
      title: `Failed handoff ${id}`,
      creatorName: "Kai Cenat",
      sourceUrl: "https://www.youtube.com/watch?v=abc123XYZ90",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ90/hqdefault.jpg",
      opportunityScore: 54,
      confidence: 89,
      recommendedAction: "Review the source.",
      receivedAt: "2026-08-04T12:00:00.000Z",
      status: "failed",
      stage: "Klipdose source import failed",
      progress: 3,
      sourceBadge: "KLIPDOSE",
      archivedAt: null,
      sourceContentId: "abc123XYZ90",
      idempotencyKey: `klipdose-${id}`,
    })),
    stats: { new: 0, processing: 0, ready: 0, failed: 3 },
  };
  const parsed = parseIncomingKlipdoseResponse(productionShape);
  assert.equal(parsed.stats.failed, 3);
  assert.equal(parsed.projects.length, 3);
  assert.equal(parsed.projects.every((item) => item.status === "failed"), true);
  assert.equal(parsed.projects.every((item) => item.sourceBadge === "KLIPDOSE"), true);
});

test("dashboard contract preserves five failed Klipdose projects", () => {
  const productionShape = {
    projects: Array.from({ length: 5 }, (_, index) => ({
      id: `failed-${index + 1}`,
      batchId: `failed-${index + 1}`,
      title: `Klipdose handoff ${index + 1}`,
      creatorName: "Kai Cenat",
      sourceUrl: "https://www.youtube.com/watch?v=abc123XYZ90",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123XYZ90/hqdefault.jpg",
      opportunityScore: 54,
      confidence: 89,
      recommendedAction: "Review the source.",
      receivedAt: "2026-08-04T12:00:00.000Z",
      status: "failed",
      stage: "Klipdose source import failed",
      progress: 3,
      sourceBadge: "KLIPDOSE",
      archivedAt: null,
      sourceContentId: "abc123XYZ90",
      idempotencyKey: `klipdose-failed-${index + 1}`,
    })),
    stats: { new: 0, processing: 0, ready: 0, failed: 5 },
  };

  const parsed = parseIncomingKlipdoseResponse(productionShape);
  assert.equal(parsed.projects.length, 5);
  assert.equal(parsed.stats.failed, 5);
  assert.equal(parsed.stats.new, 0);
  assert.equal(parsed.stats.processing, 0);
  assert.equal(parsed.stats.ready, 0);
  assert.deepEqual(parsed.projects.map((project) => project.status), ["failed", "failed", "failed", "failed", "failed"]);
});

test("rejects incorrect Incoming Projects nesting instead of silently zeroing", () => {
  assert.throws(() => parseIncomingKlipdoseResponse({ incoming: [], stats: { failed: 3 } }), /projects array/);
  assert.throws(() => parseIncomingKlipdoseResponse({ projects: [] }), /stats/);
});
