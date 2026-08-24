import test from "node:test";
import assert from "node:assert/strict";
import {
  pendingUploadSessions,
  selectUploadSessionNeedingDevice,
  serverSessionsConfirmedByBrowser,
  uploadFileNeedsDevice,
  uploadSessionNeedsDevice,
  uploadSnapshotBelongsToUser,
} from "../public/upload-manager-state.js";

test("completed upload sessions do not keep the global banner visible", () => {
  const completed = {
    id: "complete",
    files: [
      { id: "one", status: "queued_for_processing", projectId: "project-one" },
      { id: "two", status: "queued_for_processing", projectId: "project-two" },
    ],
  };

  assert.equal(uploadSessionNeedsDevice(completed), false);
  assert.equal(selectUploadSessionNeedingDevice([completed], completed.id), null);
});

test("an interrupted or uploading file keeps its session actionable", () => {
  const completed = {
    id: "older-complete",
    updatedAt: "2026-08-24T10:00:00.000Z",
    files: [{ id: "done", status: "queued_for_processing", projectId: "project-done" }],
  };
  const interrupted = {
    id: "newer-interrupted",
    updatedAt: "2026-08-24T11:00:00.000Z",
    files: [{ id: "pending", status: "interrupted" }],
  };

  assert.equal(uploadFileNeedsDevice(interrupted.files[0]), true);
  assert.equal(uploadSessionNeedsDevice(interrupted), true);
  assert.equal(selectUploadSessionNeedingDevice([completed, interrupted], completed.id)?.id, interrupted.id);
});

test("the preferred pending session wins over another pending session", () => {
  const first = { id: "first", updatedAt: "2026-08-24T11:00:00.000Z", files: [{ status: "uploading" }] };
  const preferred = { id: "preferred", updatedAt: "2026-08-24T10:00:00.000Z", files: [{ status: "paused" }] };

  assert.equal(selectUploadSessionNeedingDevice([first, preferred], preferred.id)?.id, preferred.id);
});

test("only sessions that still need the browser are persisted", () => {
  const pending = { id: "pending", files: [{ status: "interrupted" }] };
  const completed = { id: "completed", files: [{ status: "queued_for_processing", projectId: "project" }] };
  const cancelled = { id: "cancelled", files: [{ status: "cancelled" }] };

  assert.deepEqual(pendingUploadSessions([completed, pending, cancelled]), [pending]);
});

test("a browser upload snapshot is restored only for its authenticated owner", () => {
  const snapshot = { version: 2, userId: "creator-one", sessions: [] };

  assert.equal(uploadSnapshotBelongsToUser(snapshot, "creator-one"), true);
  assert.equal(uploadSnapshotBelongsToUser(snapshot, "creator-two"), false);
  assert.equal(uploadSnapshotBelongsToUser({ sessions: [] }, "creator-one"), false);
  assert.equal(uploadSnapshotBelongsToUser(snapshot, null), false);
});

test("old server sessions cannot resurrect after their legacy browser snapshot is discarded", () => {
  const stale = { id: "stale-upload", files: [{ status: "ready_to_upload" }] };
  const current = { id: "current-upload", files: [{ status: "uploading" }] };

  assert.deepEqual(serverSessionsConfirmedByBrowser([stale, current], [current.id]), [current]);
  assert.deepEqual(serverSessionsConfirmedByBrowser([stale], []), []);
});
