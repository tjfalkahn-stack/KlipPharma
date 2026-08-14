import test from "node:test";
import assert from "node:assert/strict";
import {
  applyKlipdoseHandoffState,
  klipdoseCallbackPayload,
  parseKlipdoseHandoffPayload,
  recordKlipdoseCallbackAttempt,
  shouldRetryKlipdoseCallback,
  signKlipdoseCallbackBody,
  validateKlipdoseApiToken,
} from "../lib/klipdose-handoff.js";

test("validates KlipPharma handoff API tokens without accepting missing configuration", () => {
  assert.equal(validateKlipdoseApiToken("secret", { KLIPPHARMA_API_KEY: "secret" }), true);
  assert.equal(validateKlipdoseApiToken("secret", { KLIPDOSE_SHARED_API_KEY: "secret" }), true);
  assert.equal(validateKlipdoseApiToken("wrong", { KLIPPHARMA_API_KEY: "secret" }), false);
  assert.equal(validateKlipdoseApiToken("secret", {}), false);
});

test("parses rich KlipDose handoff payloads into persisted project metadata", () => {
  const parsed = parseKlipdoseHandoffPayload({
    idempotency_key: "handoff-123",
    source: {
      url: "https://www.youtube.com/watch?v=abc123XYZ90",
      title: "Source upload",
      platform: "youtube",
      thumbnailUrl: "https://img.youtube.com/abc.jpg",
    },
    creator: {
      id: "creator-1",
      handle: "creatorhandle",
      displayName: "Creator Name",
      profileUrl: "https://youtube.com/@creatorhandle",
    },
    viralScore: 94,
    recommendation: "Lead with the first quote.",
    clips: [{ start: 12.5, end: 36, caption: "Hook caption", hashtags: ["pharma", "#launch"] }],
    proposedCaptions: ["First caption"],
    hashtags: ["KlipPharma"],
    callback_url: "https://klipdose.example.com/status",
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.project.idempotencyKey, "handoff-123");
  assert.equal(parsed.project.creatorIdentity.handle, "creatorhandle");
  assert.equal(parsed.project.viralScore, 94);
  assert.equal(parsed.project.clips.length, 1);
  assert.deepEqual(parsed.project.clips[0].hashtags, ["pharma", "launch"]);
  assert.equal(parsed.project.callbackUrl, "https://klipdose.example.com/status");
});

test("returns structured validation issues for incomplete handoffs", () => {
  const parsed = parseKlipdoseHandoffPayload({ idempotencyKey: "", sourceUrl: "file:///tmp/source.mp4" });
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.issues.map((issue) => issue.path.join(".")), ["idempotencyKey", "sourceUrl"]);
});

test("records accept, reject, retry, and media failure lifecycle audit entries", () => {
  const job = { id: "project-1", idempotencyKey: "handoff-1", status: "new" };
  applyKlipdoseHandoffState(job, "received", { action: "accepted" });
  applyKlipdoseHandoffState(job, "importing", { action: "retry" });
  applyKlipdoseHandoffState(job, "failed", { code: "MEDIA_VALIDATION_FAILED" });
  applyKlipdoseHandoffState(job, "rejected", { reason: "Rejected in KlipPharma" });
  assert.equal(job.klipdoseHandoffStatus, "rejected");
  assert.equal(job.klipdoseAudit.length, 4);
  assert.equal(job.klipdoseAudit[2].code, "MEDIA_VALIDATION_FAILED");
  assert.ok(job.rejectedAt);
});

test("signs callback payloads and marks temporary callback statuses retryable", () => {
  const job = { id: "project-1", idempotencyKey: "handoff-1", status: "ready", progress: 100 };
  const payload = klipdoseCallbackPayload(job, "ready", { clipCount: 3 });
  const body = JSON.stringify(payload);
  const signature = signKlipdoseCallbackBody(body, "callback-secret");

  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(payload.clipCount, 3);
  assert.equal(shouldRetryKlipdoseCallback(500), true);
  assert.equal(shouldRetryKlipdoseCallback(429), true);
  assert.equal(shouldRetryKlipdoseCallback(400), false);
});

test("records callback retry attempts without leaking request internals", () => {
  const job = {};
  recordKlipdoseCallbackAttempt(job, {
    state: "ready",
    attempt: 1,
    statusCode: 503,
    delivered: false,
    final: false,
    error: "Callback request failed.",
  });
  recordKlipdoseCallbackAttempt(job, {
    state: "ready",
    attempt: 2,
    statusCode: 200,
    delivered: true,
    final: true,
  });

  assert.equal(job.klipdoseCallbackAttempts.length, 2);
  assert.equal(job.klipdoseCallbackStatus.delivered, true);
  assert.equal(job.klipdoseCallbackStatus.lastError, undefined);
});
