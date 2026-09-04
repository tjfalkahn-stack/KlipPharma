import {
  CampaignError,
  PLATFORM_HOSTS,
  SUPPORTED_PLATFORMS,
  canTransitionVerification,
  nowIso,
} from "./campaign-constants.js";
import { assertSafePublicUrl } from "./source-platform.js";
import { writeAudit } from "./campaign-audit.js";
import { incrementClipUsage } from "./campaign-vault.js";
import { evaluateManualMetricReview, evaluateSubmissionRisk } from "./campaign-fraud.js";
import { calculateEligiblePayout } from "./campaign-ledger.js";
import { recordPerformanceObservation } from "./clip-features.js";

export function canonicalPublicUrl(value) {
  const url = new URL(String(value || "").trim());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.pathname.endsWith("/") && url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

export function platformFromHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return SUPPORTED_PLATFORMS.find((platform) => (
    PLATFORM_HOSTS[platform].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  )) || null;
}

export async function validateSubmissionUrl(publicUrl, declaredPlatform, resolver) {
  const url = await assertSafePublicUrl(publicUrl, resolver);
  const detected = platformFromHost(url.hostname);
  const platform = String(declaredPlatform || detected || "").toLowerCase();
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new CampaignError("Submissions must target tiktok, instagram, youtube, or x.");
  }
  if (detected && detected !== platform) {
    throw new CampaignError("That URL does not match the selected platform.");
  }
  if (!detected) {
    throw new CampaignError("That URL is not on an allowed public posting host.");
  }
  return { url, platform, canonicalUrl: canonicalPublicUrl(url.toString()) };
}

export async function createSubmission(store, {
  campaign, participant, profile, clip, platform, publicUrl, actorId, resolver = null, metricsProvider = null,
}) {
  if (campaign.status !== "LIVE") throw new CampaignError("Submissions are only accepted on live campaigns.", 409);
  if (participant?.status !== "ACTIVE" || participant?.role !== "KLIPPER") {
    throw new CampaignError("Join this campaign as an active Klipper before submitting.", 403);
  }
  if (
    !clip
    || clip.workspaceId !== campaign.workspaceId
    || clip.campaignId !== campaign.id
  ) {
    throw new CampaignError("Vault clip not found.", 404, "not_found");
  }
  if (clip.approvalStatus !== "APPROVED") {
    throw new CampaignError("Use an approved campaign klip. AI candidates cannot be distributed until a human approves them.");
  }
  const validated = await validateSubmissionUrl(publicUrl, platform, resolver);
  const duplicate = store.getSubmissionByCanonicalUrl
    ? await store.getSubmissionByCanonicalUrl(campaign.workspaceId, validated.canonicalUrl)
    : null;
  if (duplicate) {
    await evaluateSubmissionRisk(store, {
      campaign, clip, participant, canonicalUrl: validated.canonicalUrl, duplicate,
    });
    throw new CampaignError("That public post URL has already been submitted.", 409, "duplicate_url");
  }
  const flags = await evaluateSubmissionRisk(store, {
    campaign, clip, participant, canonicalUrl: validated.canonicalUrl,
  });
  let providerResult = { status: "manual_required", metrics: {}, evidence: { reason: "No automatic fetch attempted." } };
  if (metricsProvider) {
    providerResult = await metricsProvider.getPublicPost(validated.url.toString(), {
      platform: validated.platform,
      userId: participant.userId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
    });
  }
  const verificationStatus = flags.some((flag) => flag.severity === "hold")
    ? "FLAGGED"
    : providerResult.status === "verified"
      ? "VERIFYING"
      : "PENDING";
  const submission = await store.saveSubmission({
    id: store.createId(),
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    klipperId: profile?.id || participant.klipperId,
    userId: participant.userId,
    clipId: clip.id,
    platform: validated.platform,
    publicUrl: validated.url.toString(),
    canonicalUrl: validated.canonicalUrl,
    submittedAt: nowIso(),
    verificationStatus,
    verificationVersion: 1,
    contentStatus: "submitted",
    initialMetrics: providerResult.metrics || {},
    latestMetrics: providerResult.metrics || {},
    verificationEvidence: {
      provider: providerResult.provider || "manual",
      ...providerResult.evidence,
      flags: flags.map((flag) => flag.code),
    },
    createdAt: nowIso(),
  });
  await incrementClipUsage(store, clip);
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId,
    action: "submission.created",
    entityType: "submission",
    entityId: submission.id,
    details: { platform: validated.platform },
  });
  return { submission, flags };
}

async function applyVerification(store, {
  campaign, submission, clip, profile, decision, metrics, evidence, rejectionReason, actorId,
}) {
  if (
    !submission
    || submission.workspaceId !== campaign.workspaceId
    || submission.campaignId !== campaign.id
  ) {
    throw new CampaignError("Submission not found.", 404, "not_found");
  }
  const verificationStatus = String(decision || "").toUpperCase();
  if (!["VERIFIED", "REJECTED", "FLAGGED", "VERIFYING"].includes(verificationStatus)) {
    throw new CampaignError("Verification decision is invalid.");
  }
  if (!canTransitionVerification(submission.verificationStatus, verificationStatus)) {
    throw new CampaignError(
      `Cannot move a ${submission.verificationStatus} submission to ${verificationStatus}.`,
      409,
      "invalid_transition",
    );
  }
  if (submission.verificationStatus === "VERIFIED" && verificationStatus === "VERIFIED") {
    return submission;
  }

  const latestMetrics = {
    ...(submission.latestMetrics || {}),
    ...sanitizeMetrics(metrics),
  };
  const snapshots = await store.listSnapshots(submission.id);
  const previousMetrics = snapshots.length
    ? snapshots[snapshots.length - 1].metrics
    : submission.latestMetrics || submission.initialMetrics || null;
  await evaluateManualMetricReview(store, {
    campaign,
    submission,
    clip,
    metrics: latestMetrics,
    previousMetrics,
    contentStatus: evidence.contentStatus || latestMetrics.contentStatus || submission.contentStatus,
    actorId,
  });

  const saved = await store.saveSubmission({
    ...submission,
    verificationStatus,
    latestMetrics,
    contentStatus: verificationStatus === "VERIFIED"
      ? "public"
      : (evidence.contentStatus || submission.contentStatus),
    verificationEvidence: {
      ...(submission.verificationEvidence || {}),
      ...evidence,
      reviewedManually: true,
    },
    rejectionReason: verificationStatus === "REJECTED" ? String(rejectionReason || "Rejected during review") : null,
    reviewedBy: actorId,
    reviewedAt: nowIso(),
  });
  await store.saveSnapshot({
    id: store.createId(),
    submissionId: saved.id,
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    capturedAt: nowIso(),
    metrics: latestMetrics,
    source: evidence.source || "manual",
  });
  const newlyVerified = verificationStatus === "VERIFIED" && submission.verificationStatus !== "VERIFIED";
  const newlyRejected = verificationStatus === "REJECTED" && submission.verificationStatus !== "REJECTED";
  if (profile && (newlyVerified || newlyRejected)) {
    if (store.incrementProfileStats) {
      await store.incrementProfileStats(profile.id, {
        approvedSubmissions: newlyVerified ? 1 : 0,
        rejectedSubmissions: newlyRejected ? 1 : 0,
        verifiedViews: newlyVerified ? Number(latestMetrics.views || 0) : 0,
      });
    } else {
      await store.saveProfile({
        ...profile,
        approvedSubmissions: profile.approvedSubmissions + (newlyVerified ? 1 : 0),
        rejectedSubmissions: profile.rejectedSubmissions + (newlyRejected ? 1 : 0),
        verifiedViews: profile.verifiedViews + (newlyVerified ? Number(latestMetrics.views || 0) : 0),
      });
    }
  }
  if (newlyVerified) {
    await calculateEligiblePayout(store, { campaign, submission: saved, metrics: latestMetrics });
    await recordPerformanceObservation(store, {
      campaign,
      clip,
      submission: saved,
      metrics: latestMetrics,
      verificationVersion: saved.verificationVersion || 1,
    });
  }
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId,
    action: `submission.${verificationStatus.toLowerCase()}`,
    entityType: "submission",
    entityId: saved.id,
  });
  return saved;
}

export async function reviewSubmission(store, {
  campaign, submission, clip, profile, decision, metrics = {}, evidence = {}, rejectionReason = "", actorId,
}) {
  const args = { campaign, submission, clip, profile, decision, metrics, evidence, rejectionReason, actorId };
  if (store.withTransaction) {
    return store.withTransaction(async (tx) => {
      const locked = tx.lockSubmission
        ? await tx.lockSubmission(campaign.workspaceId, campaign.id, submission.id)
        : await tx.getSubmission(campaign.workspaceId, submission.id);
      return applyVerification(tx, { ...args, submission: locked || submission });
    });
  }
  return applyVerification(store, args);
}

export function sanitizeMetrics(metrics = {}) {
  const views = Math.max(0, Number(metrics.views) || 0);
  const likes = Math.max(0, Number(metrics.likes) || 0);
  const comments = Math.max(0, Number(metrics.comments) || 0);
  const shares = Math.max(0, Number(metrics.shares) || 0);
  const saves = metrics.saves == null ? null : Math.max(0, Number(metrics.saves) || 0);
  const engagements = likes + comments + shares + (saves || 0);
  const engagementRate = views > 0 ? engagements / views : 0;
  return {
    views,
    likes,
    comments,
    shares,
    saves,
    engagements,
    engagementRate,
    source: metrics.source || "manual",
    capturedAt: metrics.capturedAt || nowIso(),
    contentStatus: metrics.contentStatus || null,
  };
}

export function viewVelocity(snapshots = []) {
  if (snapshots.length < 2) return 0;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const hours = Math.max(1 / 60, (new Date(last.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / 36e5);
  const delta = Number(last.metrics?.views || 0) - Number(first.metrics?.views || 0);
  return delta / hours;
}
