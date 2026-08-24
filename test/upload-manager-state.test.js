import test from "node:test";
import assert from "node:assert/strict";
import {
  selectUploadSessionNeedingDevice,
  uploadFileNeedsDevice,
  uploadSessionNeedsDevice,
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
