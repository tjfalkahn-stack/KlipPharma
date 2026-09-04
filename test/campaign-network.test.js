import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryCampaignStore } from "../lib/campaign-store.js";
import {
  assertReadyForLive,
  createCampaign,
  transitionCampaign,
} from "../lib/campaign-engine.js";
import { canTransitionCampaignStatus } from "../lib/campaign-constants.js";
import { candidateFromProjectClip, importProjectCandidates, reviewVaultClip } from "../lib/campaign-vault.js";
import { joinCampaign, upsertKlipperProfile } from "../lib/campaign-network.js";
import { createSubmission, reviewSubmission, validateSubmissionUrl } from "../lib/campaign-submissions.js";
import { payoutAmount, reviewPayout, summarizeLedger } from "../lib/campaign-ledger.js";
import { PayoutProvider } from "../lib/campaign-ledger.js";
import { classifyHook, extractClipFeatures, historicalSignals } from "../lib/clip-features.js";
import { formatPromptBlock } from "../lib/autoklip-feedback.js";
import { createMetricsRegistry } from "../lib/social-metrics.js";
import { resolveWorkspaceCompute } from "../lib/workspace-compute.js";
import { campaignNetworkSchemaSql } from "../lib/campaign-schema.js";
import { fpaiAdapterCatalog } from "../lib/fpai-adapters.js";
import { LOCAL_WORKSPACE_ID } from "../lib/campaign-constants.js";
import { saveCampaignRights } from "../lib/campaign-rights.js";
import { suspiciousViewPattern } from "../lib/campaign-fraud.js";

function publicResolver(address = "93.184.216.34") {
  return async () => [{ address }];
}

async function seedLiveCampaign(store, { approvalRequired = false, payoutModel = "CPM", payoutRate = 2 } = {}) {
  const campaign = await createCampaign(store, {
    workspaceId: LOCAL_WORKSPACE_ID,
    userId: "creator-1",
    input: {
      title: "Launch clips",
      description: "Distribute approved verticals",
      targetPlatforms: ["tiktok"],
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-12-01T00:00:00.000Z",
      payoutModel,
      payoutRate,
      budget: 500,
      approvalRequired,
    },
  });
  const rights = await saveCampaignRights(store, {
    campaign,
    actorId: "creator-1",
    acknowledge: true,
    input: {
      contentOwnershipDeclaration: "Creator owns the source.",
      usagePermissions: "Approved clips may be posted to listed platforms.",
      musicAudioRightsDeclaration: "Only cleared audio.",
      allowedEditingRules: "Captions and safe trims only.",
      brandGuidelines: "Keep the KlipPharma look; do not copy third-party brands.",
      prohibitedUses: "No hate or scraped content.",
      contentTakedownProcedure: "Email the campaign owner.",
      disclosureRequirements: "Disclose paid partnership when required.",
    },
  });
  const live = await transitionCampaign(store, campaign, "READY", "creator-1", rights);
  return transitionCampaign(store, live, "LIVE", "creator-1", rights);
}

test("campaign status machine rejects illegal jumps", () => {
  assert.equal(canTransitionCampaignStatus("DRAFT", "LIVE"), false);
  assert.equal(canTransitionCampaignStatus("DRAFT", "READY"), true);
  assert.equal(canTransitionCampaignStatus("LIVE", "DRAFT"), false);
});

test("live campaigns require rights acknowledgement", () => {
  assert.throws(
    () => assertReadyForLive({ targetPlatforms: ["tiktok"], startDate: "a", endDate: "b", payoutModel: "NONE" }, null),
    /Acknowledge campaign rights/,
  );
});

test("vault candidates stay unapproved until a human reviews them", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await createCampaign(store, {
    workspaceId: LOCAL_WORKSPACE_ID,
    userId: "creator-1",
    input: { title: "Vault test" },
  });
  const job = {
    id: "project-1",
    transcript: "hello world",
    clips: [{ id: "clip-1", start: 2, end: 18, title: "Hook", hook: "Wait for it", overallScore: 88, captionText: "hello world", captionStyle: "bold" }],
  };
  const imported = await importProjectCandidates(store, { campaign, job, actorId: "creator-1" });
  assert.equal(imported[0].approvalStatus, "CANDIDATE");
  const approved = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "editor-1" });
  assert.equal(approved.approvalStatus, "APPROVED");
});

test("candidate import copies caption package and timestamps from AutoKlip", () => {
  const payload = candidateFromProjectClip(
    { id: "job", transcript: "full" },
    { id: "clip-1", start: 10, end: 25, title: "Cut", hook: "Stop scrolling", captionText: "exact words", captionsEnabled: true, captionStyle: "karaoke" },
  );
  assert.equal(payload.sourceTimestamps.start, 10);
  assert.equal(payload.duration, 15);
  assert.equal(payload.captionPackage.style, "karaoke");
});

test("klipper join and public URL validation", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store);
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1",
    workspaceId: LOCAL_WORKSPACE_ID,
    input: { displayName: "Ada", username: "ada_clips" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  assert.equal(participant.status, "ACTIVE");
  const validated = await validateSubmissionUrl("https://www.tiktok.com/@ada/video/123", "tiktok", publicResolver());
  assert.equal(validated.platform, "tiktok");
  await assert.rejects(
    () => validateSubmissionUrl("https://localhost/secret", "tiktok", publicResolver("127.0.0.1")),
    /Local source URLs|private network/,
  );
});

test("submissions require approved vault clips and calculate ledger without paying", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store);
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-1",
    workspaceId: LOCAL_WORKSPACE_ID,
    input: { displayName: "Ada", username: "ada_clips" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-1", profile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p1", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Why this works", overallScore: 90 }] },
    actorId: "creator-1",
  });
  await assert.rejects(
    () => createSubmission(store, {
      campaign, participant, profile, clip: imported[0],
      platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/1", actorId: "klipper-1",
      resolver: publicResolver(),
    }),
    /approved campaign klip/,
  );
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-1" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/99", actorId: "klipper-1",
    resolver: publicResolver(),
    metricsProvider: createMetricsRegistry(),
  });
  assert.equal(submission.verificationStatus, "PENDING");
  const verified = await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 20000, likes: 400, comments: 20, shares: 10 },
    evidence: { source: "manual" }, actorId: "reviewer-1",
  });
  assert.equal(verified.verificationStatus, "VERIFIED");
  const ledger = await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id });
  const eligible = ledger.find((entry) => entry.entryType === "eligible_payout");
  assert.equal(eligible.payoutStatus, "CALCULATED");
  assert.equal(eligible.amount, payoutAmount(campaign, { views: 20000 }));
  const payouts = new PayoutProvider();
  await assert.rejects(() => payouts.createTransfer(), /Automatic payouts are disabled/);
  const approved = await reviewPayout(store, { entry: eligible, campaign, decision: "APPROVED", actorId: "creator-1" });
  assert.equal(approved.payoutStatus, "APPROVED");
  const summary = summarizeLedger(await store.listLedger(LOCAL_WORKSPACE_ID, { campaignId: campaign.id }), campaign);
  assert.equal(summary.automaticPayouts, false);
  assert.ok(summary.approvedPayouts > 0);
});

test("feature store and historical signals never claim virality", () => {
  const features = extractClipFeatures({
    clip: { hook: "Stop doing this", duration: 18, captionPackage: { style: "bold", text: "one two three four" }, performanceScore: 80 },
    campaign: { campaignType: "launch" },
  });
  assert.equal(features.hookCategory, "hot_take");
  assert.equal(features.notes.includes("virality prediction"), true);
  const signals = historicalSignals([{
    featureSnapshot: features,
    outcomes: { views: 12000 },
  }]);
  assert.equal(signals.label, "HISTORICAL SIGNAL");
  assert.match(signals.disclaimer, /do not predict virality/i);
  assert.match(formatPromptBlock(signals), /not a virality prediction/i);
  assert.equal(classifyHook("link in bio now"), "cta");
});

test("workspace compute never hard-codes a Mac volume and falls back", () => {
  const missing = resolveWorkspaceCompute({ KLIPPHARMA_WORKSPACE_ROOT: "/Volumes/NotARealDrive/FPAI/media/klippharma" }, { defaultStorageRoot: "/tmp/klippharma-cloud" });
  assert.equal(missing.usingExternalWorkspace, false);
  assert.equal(missing.activeRoot, "/tmp/klippharma-cloud");
  assert.match(missing.fallbackReason, /unavailable/);
  const unset = resolveWorkspaceCompute({}, { defaultStorageRoot: "/app/storage" });
  assert.equal(unset.activeRoot, "/app/storage");
});

test("schema SQL and FPAI adapters stay loosely coupled", () => {
  const sql = campaignNetworkSchemaSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS campaigns/);
  assert.match(sql, /campaign_ledger_entries/);
  const catalog = fpaiAdapterCatalog();
  assert.equal(catalog.every((item) => item.coupled === false), true);
  assert.ok(catalog.some((item) => item.id === "fpai_forge"));
});

test("suspicious patterns flag for review instead of accusing fraud", () => {
  const signal = suspiciousViewPattern({ views: 250000, likes: 0, comments: 0 });
  assert.equal(signal.code, "suspicious_view_pattern");
  assert.match(signal.message, /not an automatic fraud finding/i);
});
