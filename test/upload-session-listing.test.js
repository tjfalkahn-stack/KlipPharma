import test from "node:test";
import assert from "node:assert/strict";
import {
  listUploadSessionsForClient,
  uploadSessionNeedsDeviceTransfer,
} from "../lib/upload-sessions.js";

const now = Date.parse("2026-08-24T17:30:00.000Z");

test("abandoned upload sessions are not returned to a cached dashboard", () => {
  const abandoned = {
    id: "abandoned-session",
    updatedAt: "2026-08-24T12:00:00.000Z",
    files: [{ status: "ready_to_upload", projectId: null }],
  };

  assert.equal(uploadSessionNeedsDeviceTransfer(abandoned), true);
  assert.deepEqual(listUploadSessionsForClient([abandoned], { now }), []);
});

test("recent active uploads remain visible", () => {
  const active = {
    id: "active-session",
    updatedAt: "2026-08-24T17:20:00.000Z",
    files: [{ status: "uploading", projectId: null }],
  };

  assert.deepEqual(listUploadSessionsForClient([active], { now }), [active]);
});

test("an authenticated browser can request its older resumable upload by id", () => {
  const resumable = {
    id: "resumable-session",
    updatedAt: "2026-08-23T17:00:00.000Z",
    files: [{ status: "paused", projectId: null }],
  };

  assert.deepEqual(listUploadSessionsForClient([resumable], {
    now,
    requestedIds: [resumable.id],
  }), [resumable]);
});

test("completed and cancelled sessions are never returned as device uploads", () => {
  const completed = {
    id: "complete",
    updatedAt: "2026-08-24T17:29:00.000Z",
    files: [{ status: "queued_for_processing", projectId: "project" }],
  };
  const cancelled = {
    id: "cancelled",
    updatedAt: "2026-08-24T17:29:00.000Z",
    files: [{ status: "cancelled", projectId: null }],
  };

  assert.deepEqual(listUploadSessionsForClient([completed, cancelled], {
    now,
    requestedIds: [completed.id, cancelled.id],
  }), []);
});
