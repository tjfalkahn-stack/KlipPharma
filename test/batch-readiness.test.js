import test from "node:test";
import assert from "node:assert/strict";
import { batchSourcesSettled, fitClipToRequestedLength, takeMontageSegmentsRoundRobin } from "../lib/batch-readiness.js";

function job(id, batchSize = 5) {
  return { id, batchSize, status: "ready" };
}

function uploadFile(id, status = "queued_for_processing", projectId = id) {
  return { id: `file-${id}`, status, projectId };
}

test("does not finalize a five-source batch after only three sources created projects", () => {
  const group = [job("one"), job("two"), job("three")];
  const session = {
    files: [
      uploadFile("one"), uploadFile("two"), uploadFile("three"),
      uploadFile("four", "uploading", null), uploadFile("five", "ready_to_upload", null),
    ],
  };
  assert.equal(batchSourcesSettled(group, session), false);
});

test("finalizes only after every successfully uploaded source has a project", () => {
  const group = [job("one"), job("two"), job("three"), job("four"), job("five")];
  const session = { files: group.map((item) => uploadFile(item.id)) };
  assert.equal(batchSourcesSettled(group, session), true);
});

test("allows a batch to finish after an unuploaded source is explicitly cancelled", () => {
  const group = [job("one"), job("two"), job("three"), job("four")];
  const session = {
    files: [
      ...group.map((item) => uploadFile(item.id)),
      uploadFile("five", "cancelled", null),
    ],
  };
  assert.equal(batchSourcesSettled(group, session), true);
});

test("direct upload batches still require the declared batch size", () => {
  assert.equal(batchSourcesSettled([job("one"), job("two"), job("three")]), false);
  assert.equal(batchSourcesSettled([job("one", 1)]), true);
});

test("an explicit one-minute choice expands a short AI suggestion to sixty seconds", () => {
  assert.deepEqual(fitClipToRequestedLength(20, 35, 180, 60), { start: 20, end: 80 });
});

test("an explicit length shifts backward near the end and uses the whole source when shorter", () => {
  assert.deepEqual(fitClipToRequestedLength(150, 165, 180, 60), { start: 120, end: 180 });
  assert.deepEqual(fitClipToRequestedLength(0, 15, 42, 60), { start: 0, end: 42 });
});

test("a sixty-second Auto-Mix includes all five sources and fills the requested duration", () => {
  const queues = Array.from({ length: 5 }, (_, sourceIndex) => (
    Array.from({ length: 4 }, (_, pieceIndex) => ({ sourceIndex, pieceIndex, duration: 3 }))
  ));
  const segments = takeMontageSegmentsRoundRobin(queues, 60);
  assert.equal(segments.reduce((sum, segment) => sum + segment.duration, 0), 60);
  assert.deepEqual([...new Set(segments.map((segment) => segment.sourceIndex))], [0, 1, 2, 3, 4]);
});
