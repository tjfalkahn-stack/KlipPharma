import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryCampaignStore } from "../lib/campaign-store.js";
import {
  createCampaign,
  transitionCampaign,
  updateCampaign,
} from "../lib/campaign-engine.js";
import { workspaceRoleToCampaignRole } from "../lib/campaign-constants.js";
import { importProjectCandidates, reviewVaultClip, clipContentFingerprint } from "../lib/campaign-vault.js";
import { joinCampaign, upsertKlipperProfile } from "../lib/campaign-network.js";
import { createSubmission, reviewSubmission } from "../lib/campaign-submissions.js";
import { payoutAmount, reviewPayout, summarizeLedger } from "../lib/campaign-ledger.js";
import { saveCampaignRights, rightsComplete } from "../lib/campaign-rights.js";
import { LOCAL_WORKSPACE_ID } from "../lib/campaign-constants.js";
import { publicComputeCapabilities } from "../lib/workspace-compute.js";
import { createBoundedRateLimiter } from "../lib/rate-limit.js";
import { TikTokOfficialAdapter, YouTubeOfficialAdapter } from "../lib/social-metrics.js";
import { COMPLETE_RIGHTS, publicResolver, seedLiveCampaign, WS_A, WS_B } from "./campaign-helpers.js";

test("workspace viewer maps to read-only VIEWER, not REVIEWER", () => {
  assert.equal(workspaceRoleToCampaignRole("viewer"), "VIEWER");
  assert.equal(workspaceRoleToCampaignRole("owner"), "ADMIN");
  assert.equal(workspaceRoleToCampaignRole("editor"), "EDITOR");
});

test("6. repeated VERIFIED review is idempotent", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_idemp" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Why this works" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/idemp",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  const first = await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 20000, likes: 400, comments: 20, shares: 10 },
    evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  const refreshed = await store.getProfile(profile.id);
  const second = await reviewSubmission(store, {
    campaign, submission: first, clip, profile: refreshed, decision: "VERIFIED",
    metrics: { views: 20000, likes: 400, comments: 20, shares: 10 },
    evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  assert.equal(second.verificationStatus, "VERIFIED");
  const ledger = await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id });
  assert.equal(ledger.filter((entry) => entry.entryType === "eligible_payout").length, 1);
  assert.equal(ledger.filter((entry) => entry.entryType === "reservation").length, 1);
  const observations = await store.listObservations(LOCAL_WORKSPACE_ID, { campaignId: campaign.id });
  assert.equal(observations.length, 1);
  const snapshots = await store.listSnapshots(first.id);
  assert.equal(snapshots.length, 1);
  const latestProfile = await store.getProfile(profile.id);
  assert.equal(latestProfile.approvedSubmissions, 1);
  assert.equal(latestProfile.verifiedViews, 20000);
});

test("concurrent verification attempts do not double-pay", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_race" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Race" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/race",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  await Promise.all([
    reviewSubmission(store, {
      campaign, submission, clip, profile, decision: "VERIFIED",
      metrics: { views: 10000, likes: 10, comments: 2 }, evidence: { source: "manual" }, actorId: "r1",
    }),
    reviewSubmission(store, {
      campaign, submission, clip, profile, decision: "VERIFIED",
      metrics: { views: 10000, likes: 10, comments: 2 }, evidence: { source: "manual" }, actorId: "r2",
    }),
  ]);
  const ledger = await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id });
  assert.equal(ledger.filter((entry) => entry.entryType === "eligible_payout").length, 1);
  assert.equal(ledger.filter((entry) => entry.entryType === "reservation" && entry.reservationStatus === "ACTIVE").length, 1);
});

test("7. payout cannot exceed remaining campaign budget", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 5, payoutRate: 50 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_budget" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Budget" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/budget",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  await assert.rejects(
    () => reviewSubmission(store, {
      campaign, submission, clip, profile, decision: "VERIFIED",
      metrics: { views: 1_000_000, likes: 10, comments: 2 },
      evidence: { source: "manual" }, actorId: "reviewer-1",
    }),
    /remaining campaign budget/,
  );
  const ledger = await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id });
  assert.equal(ledger.some((entry) => entry.entryType === "eligible_payout"), false);
});

test("8. rejected payout releases its reservation", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_rej" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Reject" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/reject",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  const verified = await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 20000, likes: 40, comments: 4 }, evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  const eligible = (await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }))
    .find((entry) => entry.entryType === "eligible_payout");
  await reviewPayout(store, { entry: eligible, campaign, decision: "REJECTED", actorId: "creator-1" });
  const summary = summarizeLedger(await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }), campaign);
  assert.equal(summary.reserved, 0);
  assert.equal(summary.approvedPayouts, 0);
  assert.ok(summary.rejectedPayouts > 0);
  assert.equal(verified.verificationStatus, "VERIFIED");
});

test("9. approved payout is not double-counted", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_appr" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Approve" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/approve",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 20000, likes: 40, comments: 4 }, evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  const eligible = (await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }))
    .find((entry) => entry.entryType === "eligible_payout");
  const amount = eligible.amount;
  await reviewPayout(store, { entry: eligible, campaign, decision: "APPROVED", actorId: "creator-1" });
  const summary = summarizeLedger(await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }), campaign);
  assert.equal(summary.reserved, 0);
  assert.equal(summary.approvedPayouts, amount);
  assert.equal(summary.committedSpend, amount);
  assert.equal(summary.remainingBudget, 500 - amount);
});

test("held payout remains reserved", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_hold" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Hold" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/hold",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 10000, likes: 10, comments: 1 }, evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  const eligible = (await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }))
    .find((entry) => entry.entryType === "eligible_payout");
  await reviewPayout(store, { entry: eligible, campaign, decision: "HELD", actorId: "creator-1" });
  const summary = summarizeLedger(await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }), campaign);
  assert.equal(summary.reserved, eligible.amount);
  assert.equal(summary.approvedPayouts, 0);
});

test("budget decrease below committed spend is rejected and writes an adjustment when allowed", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500 });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_adj" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Adj" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/adj",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 20000, likes: 40, comments: 4 }, evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  const summary = summarizeLedger(await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }), campaign);
  await assert.rejects(
    () => updateCampaign(store, campaign, { budget: 1 }, "creator-1", { committedSpend: summary.committedSpend }),
    /Budget cannot be lower/,
  );
  const increased = await updateCampaign(store, campaign, { budget: 800 }, "creator-1", { committedSpend: summary.committedSpend });
  assert.equal(increased.budget, 800);
  const entries = await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id });
  assert.ok(entries.some((entry) => entry.entryType === "budget_adjustment" && entry.metadata?.to === 800));
});

test("payout cap limits eligible compensation", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { budget: 500, payoutRate: 10, payoutModel: "CPM" });
  await store.saveCampaign({ ...campaign, payoutCap: 5 });
  const capped = await store.getCampaign(LOCAL_WORKSPACE_ID, campaign.id);
  const amount = payoutAmount(capped, { views: 1_000_000 });
  assert.ok(amount > 5);
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_cap" },
  });
  const participant = await joinCampaign(store, { campaign: capped, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign: capped,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Cap" }] },
    actorId: "creator-1",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign: capped, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/cap",
    actorId: "klipper-1", resolver: publicResolver(),
  });
  await reviewSubmission(store, {
    campaign: capped, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 1_000_000, likes: 50, comments: 5 }, evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  const eligible = (await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }))
    .find((entry) => entry.entryType === "eligible_payout");
  assert.equal(eligible.amount, 5);
});

test("10. rights changes require re-acknowledgment", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await createCampaign(store, {
    workspaceId: LOCAL_WORKSPACE_ID, userId: "creator-1", input: { title: "Rights campaign" },
  });
  const first = await saveCampaignRights(store, {
    campaign, actorId: "creator-1", acknowledge: true, input: COMPLETE_RIGHTS,
  });
  assert.equal(rightsComplete(first), true);
  const edited = await saveCampaignRights(store, {
    campaign, actorId: "creator-1", acknowledge: false,
    input: { ...COMPLETE_RIGHTS, brandGuidelines: "Completely different brand rules." },
  });
  assert.equal(edited.acknowledgedAt, null);
  assert.equal(edited.acknowledgedHash, null);
  assert.equal(rightsComplete(edited), false);
  assert.ok(edited.rightsVersion > first.rightsVersion);
  await assert.rejects(
    () => transitionCampaign(store, { ...campaign, status: "READY", targetPlatforms: ["tiktok"], startDate: "a", endDate: "b", payoutModel: "NONE" }, "LIVE", "creator-1", edited),
    /Acknowledge campaign rights/,
  );
});

test("11. changed approved clip requires reapproval", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await createCampaign(store, {
    workspaceId: LOCAL_WORKSPACE_ID, userId: "creator-1", input: { title: "Vault reimport" },
  });
  const job = {
    id: "project-1",
    clips: [{ id: "clip-1", start: 2, end: 18, title: "Hook", hook: "Wait for it", captionText: "hello world" }],
  };
  const imported = await importProjectCandidates(store, { campaign, job, actorId: "creator-1" });
  const approved = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "editor-1" });
  assert.equal(approved.approvalStatus, "APPROVED");
  const unchanged = await importProjectCandidates(store, { campaign, job, actorId: "creator-1" });
  assert.equal(unchanged[0].approvalStatus, "APPROVED");
  const changedJob = {
    id: "project-1",
    clips: [{ id: "clip-1", start: 2, end: 18, title: "Hook", hook: "Different hook now", captionText: "new transcript" }],
  };
  const reimported = await importProjectCandidates(store, { campaign, job: changedJob, actorId: "creator-1" });
  assert.equal(reimported[0].approvalStatus, "CANDIDATE");
  assert.equal(reimported[0].approvedBy, null);
  assert.equal(reimported[0].approvedAt, null);
  assert.notEqual(reimported[0].contentFingerprint, clipContentFingerprint(approved));
});

test("12. restricted campaign requires an allowed region", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { allowedRegions: ["US"], approvalRequired: false });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1", workspaceId: LOCAL_WORKSPACE_ID, input: { displayName: "Ada", username: "ada_region" },
  });
  await assert.rejects(
    () => joinCampaign(store, { campaign, userId: "klipper-1", profile }),
    /Region is required/,
  );
  await assert.rejects(
    () => joinCampaign(store, { campaign, userId: "klipper-1", profile, region: "ZZ" }),
    /Unsupported region/,
  );
  await assert.rejects(
    () => joinCampaign(store, { campaign, userId: "klipper-1", profile, region: "CA" }),
    /not open in that region/,
  );
  const joined = await joinCampaign(store, { campaign, userId: "klipper-1", profile, region: "us" });
  assert.equal(joined.region, "US");
  assert.equal(joined.status, "ACTIVE");
});

test("TikTok and YouTube adapters resolve the submitter connection from provider context", async () => {
  let seen = null;
  const tiktok = new TikTokOfficialAdapter({
    getConnection: async (provider, context) => {
      seen = { provider, ...context };
      return { accessToken: "tok" };
    },
  });
  const result = await tiktok.getPublicPost("https://www.tiktok.com/@x/video/1", {
    userId: "klipper-1", workspaceId: WS_A, campaignId: "camp-1", submissionId: "sub-1", platform: "tiktok",
  });
  assert.equal(seen.userId, "klipper-1");
  assert.equal(seen.workspaceId, WS_A);
  assert.equal(seen.campaignId, "camp-1");
  assert.equal(result.evidence.connected, true);
  const youtube = new YouTubeOfficialAdapter({
    getConnection: async (_provider, context) => {
      assert.equal(context.userId, "klipper-1");
      return { accessToken: "yt" };
    },
  });
  const yt = await youtube.getPublicPost("https://youtu.be/abc", { userId: "klipper-1", platform: "youtube" });
  assert.equal(yt.evidence.connected, true);
});

test("rate limiter is bounded and sweeps expired keys", async () => {
  const limiter = createBoundedRateLimiter({ windowMs: 50, max: 2, maxKeys: 2, message: "slow down" });
  const responses = [];
  const res = { status: (code) => ({ json: (body) => { responses.push({ code, body }); } }) };
  const req = { ip: "10.0.0.1", user: { id: "u" }, method: "POST", path: "/x", baseUrl: "" };
  limiter(req, res, () => {});
  limiter(req, res, () => {});
  limiter(req, res, () => {});
  assert.equal(responses[0].code, 429);
  limiter.size();
  await new Promise((resolve) => setTimeout(resolve, 60));
  limiter.sweep();
  assert.ok(limiter.size() <= 2);
  limiter.reset();
  assert.equal(limiter.size(), 0);
});

test("public compute capabilities omit filesystem paths", () => {
  const published = publicComputeCapabilities({
    usingExternalWorkspace: true,
    configuredRoot: "/Volumes/Secret",
    activeRoot: "/Volumes/Secret",
    workloads: { exports: "/Volumes/Secret/exports" },
  });
  assert.deepEqual(published, {
    externalWorkspaceAvailable: true,
    fallbackActive: false,
    workloadCapabilities: ["exports"],
  });
});

test("duplicate URL evidence stays workspace-scoped", async () => {
  const store = createMemoryCampaignStore();
  const campaignA = await seedLiveCampaign(store, { workspaceId: WS_A, userId: "owner-a", title: "A dup" });
  const campaignB = await seedLiveCampaign(store, { workspaceId: WS_B, userId: "owner-b", title: "B dup" });
  async function submit(campaign, userId, username) {
    const profile = await upsertKlipperProfile(store, {
      userId, workspaceId: campaign.workspaceId, input: { displayName: username, username },
    });
    const participant = await joinCampaign(store, { campaign, userId, profile });
    const imported = await importProjectCandidates(store, {
      campaign,
      job: { id: `p-${username}`, clips: [{ id: "clip-1", start: 0, end: 9, title: "H", hook: "H" }] },
      actorId: campaign.creatorId,
    });
    const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: campaign.creatorId });
    return createSubmission(store, {
      campaign, participant, profile, clip,
      platform: "tiktok", publicUrl: "https://www.tiktok.com/@shared/video/999",
      actorId: userId, resolver: publicResolver(),
    });
  }
  await submit(campaignA, "klipper-a", "dup_a");
  const other = await submit(campaignB, "klipper-b", "dup_b");
  assert.equal(other.submission.workspaceId, WS_B);
  const flags = await store.listFlags(WS_B, { campaignId: campaignB.id, status: null });
  assert.equal(flags.some((flag) => String(JSON.stringify(flag.details)).includes(campaignA.id)), false);
});
