import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertUploadFileIdentity,
  attachMultipartUpload,
  canAccessUploadSession,
  createUploadSession,
  markUploadFileCompleted,
  recordUploadPart,
  refreshSessionStatus,
  setUploadFileStatus,
  uploadSessionForClient,
} from "../lib/upload-sessions.js";

const files = [
  { name: "clip-a.mp4", type: "video/mp4", size: 12 * 1024 * 1024, lastModified: 1 },
  { name: "clip-b.mov", type: "video/quicktime", size: 7 * 1024 * 1024, lastModified: 2 },
];

test("creates one persistent batch id with per-file multipart state", () => {
  const session = createUploadSession({ userId: "user-1", files, partSize: 5 * 1024 * 1024 });
  assert.equal(session.files.length, 2);
  assert.equal(session.files[0].totalParts, 3);
  assert.equal(session.files[1].totalParts, 2);
  assert.equal(session.files[0].batchId, undefined);
  assert.ok(session.batchId);
});

test("records uploaded parts idempotently without restarting completed bytes", () => {
  const session = createUploadSession({ userId: "user-1", files: [files[0]], partSize: 5 * 1024 * 1024 });
  const file = session.files[0];
  attachMultipartUpload(file, { uploadId: "upload-1", objectKey: "user-1/uploads/source.mp4" });
  recordUploadPart(session, file.id, { partNumber: 1, etag: "etag-1", size: 5 * 1024 * 1024 });
  recordUploadPart(session, file.id, { partNumber: 1, etag: "etag-1b", size: 5 * 1024 * 1024 });
  recordUploadPart(session, file.id, { partNumber: 2, etag: "etag-2", size: 5 * 1024 * 1024 });
  assert.equal(file.completedParts.length, 2);
  assert.equal(file.uploadedBytes, 10 * 1024 * 1024);
});

test("marks completed files queued for processing exactly once", () => {
  const session = createUploadSession({ userId: "user-1", files: [files[1]], partSize: 5 * 1024 * 1024 });
  const file = session.files[0];
  markUploadFileCompleted(session, file.id, { projectId: "project-1" });
  markUploadFileCompleted(session, file.id, { projectId: "project-1" });
  assert.equal(file.status, "queued_for_processing");
  assert.equal(file.projectId, "project-1");
  assert.equal(session.status, "processing");
});

test("supports pause, resume, cancel, and client-safe snapshots", () => {
  const session = createUploadSession({ userId: "user-1", files: [files[0]], partSize: 5 * 1024 * 1024 });
  const file = session.files[0];
  setUploadFileStatus(session, file.id, "paused");
  assert.equal(session.status, "paused");
  setUploadFileStatus(session, file.id, "uploading");
  assert.equal(refreshSessionStatus(session), "uploading");
  setUploadFileStatus(session, file.id, "cancelled");
  assert.equal(session.status, "cancelled");
  const safe = uploadSessionForClient(session);
  assert.equal(safe.files[0].uploadId, undefined);
  assert.equal(safe.files[0].objectKey, undefined);
});

test("enforces upload-session ownership for every route action", () => {
  const session = createUploadSession({ userId: "owner-1", files: [files[0]], partSize: 5 * 1024 * 1024 });
  const owner = { id: "owner-1" };
  const stranger = { id: "owner-2" };
  const businessTeam = { businessActive: true, memberIds: ["owner-1"] };
  const inactiveTeam = { businessActive: false, memberIds: ["owner-1"] };
  const protectedActions = ["read", "upload-part", "record-part", "complete", "pause", "resume", "retry", "cancel"];
  for (const action of protectedActions) {
    assert.equal(canAccessUploadSession(owner, null, session), true, `${action} owner access`);
    assert.equal(canAccessUploadSession(stranger, null, session), false, `${action} cross-user denied`);
    assert.equal(canAccessUploadSession(stranger, inactiveTeam, session), false, `${action} inactive workspace denied`);
    assert.equal(canAccessUploadSession(stranger, businessTeam, session), true, `${action} business workspace access`);
  }
});

test("rejects batches beyond configured file and byte limits while allowing the target large batch", () => {
  const eightLargeFiles = Array.from({ length: 8 }, (_, index) => ({
    name: `large-${index}.mp4`,
    type: "video/mp4",
    size: 120 * 1024 * 1024,
    lastModified: index + 1,
  }));
  const session = createUploadSession({
    userId: "owner-1",
    files: eightLargeFiles,
    limits: { maxFiles: 10, maxFileBytes: 1024 * 1024 * 1024, maxBatchBytes: 2 * 1024 * 1024 * 1024 },
  });
  assert.equal(session.files.length, 8);
  assert.throws(() => createUploadSession({
    userId: "owner-1",
    files: [...eightLargeFiles, ...eightLargeFiles],
    limits: { maxFiles: 10 },
  }), /no more than 10 files/i);
  assert.throws(() => createUploadSession({
    userId: "owner-1",
    files: [{ name: "too-big.mp4", type: "video/mp4", size: 2 * 1024 * 1024 * 1024 }],
  }), /1 GB/i);
});

test("prevents invalid file substitution during resume", () => {
  const session = createUploadSession({ userId: "owner-1", files: [files[0]], partSize: 5 * 1024 * 1024 });
  const file = session.files[0];
  assert.equal(assertUploadFileIdentity(file, files[0]), true);
  assert.throws(() => assertUploadFileIdentity(file, { ...files[0], size: files[0].size + 1 }), /does not match/i);
  assert.throws(() => assertUploadFileIdentity(file, { ...files[0], lastModified: 999 }), /does not match/i);
  assert.throws(() => assertUploadFileIdentity(file, { ...files[0], type: "audio/mp4" }), /does not match/i);
});

test("migration contains production constraints, indexes, idempotency, and processing lease columns", () => {
  const migration = fs.readFileSync(path.resolve("migrations/202608160001_upload_sessions.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS upload_sessions/i);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /CHECK \(status IN/i);
  assert.match(migration, /upload_sessions_user_idempotency_idx/i);
  assert.match(migration, /processing_lease_owner/i);
  assert.match(migration, /processing_lease_expires_at/i);
});
