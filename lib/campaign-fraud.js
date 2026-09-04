import { nowIso } from "./campaign-constants.js";

function flag(store, { workspaceId, campaignId, submissionId = null, userId = null, severity, code, message, details = {} }) {
  return store.saveFlag({
    id: store.createId(),
    workspaceId,
    campaignId,
    submissionId,
    userId,
    severity,
    code,
    message,
    details,
    status: "open",
    createdAt: nowIso(),
  });
}

export async function evaluateSubmissionRisk(store, {
  campaign, clip, participant, canonicalUrl, duplicate = null, metrics = null, previousMetrics = null,
}) {
  const created = [];
  if (duplicate) {
    created.push(await flag(store, {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      userId: participant.userId,
      severity: duplicate.campaignId === campaign.id ? "hold" : "review",
      code: duplicate.campaignId === campaign.id ? "duplicate_url" : "cross_campaign_url",
      message: duplicate.campaignId === campaign.id
        ? "This public URL was already submitted to this campaign and needs review."
        : "This public URL was already submitted to another campaign and needs review.",
      details: { existingSubmissionId: duplicate.id, existingCampaignId: duplicate.campaignId, canonicalUrl },
    }));
  }
  if (participant.userId === campaign.creatorId) {
    created.push(await flag(store, {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      userId: participant.userId,
      severity: "review",
      code: "self_referral",
      message: "The campaign creator submitted as a Klipper. This may be legitimate and needs a reviewer.",
      details: {},
    }));
  }
  if (clip && Number(clip.usageCount || 0) > 25) {
    created.push(await flag(store, {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      userId: participant.userId,
      severity: "info",
      code: "reused_media",
      message: "This approved klip has been used unusually often and should be sampled for quality.",
      details: { clipId: clip.id, usageCount: clip.usageCount },
    }));
  }
  const profile = participant.klipperId ? await store.getProfile(participant.klipperId) : null;
  if (profile && profile.rejectedSubmissions >= 5 && profile.approvedSubmissions === 0) {
    created.push(await flag(store, {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      userId: participant.userId,
      severity: "review",
      code: "repeated_rejections",
      message: "This account has repeated rejected submissions and should be reviewed before more payouts.",
      details: { rejectedSubmissions: profile.rejectedSubmissions },
    }));
  }
  if (metrics && previousMetrics && Number(previousMetrics.views) > 0) {
    const jump = Number(metrics.views || 0) / Number(previousMetrics.views || 1);
    if (jump >= 20 && Number(metrics.views) - Number(previousMetrics.views) > 50000) {
      created.push(await flag(store, {
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
        userId: participant.userId,
        severity: "review",
        code: "abnormal_metric_change",
        message: "Verified view counts changed abnormally between snapshots and need review.",
        details: { previous: previousMetrics.views, next: metrics.views },
      }));
    }
  }
  return created;
}

export function suspiciousViewPattern({ views = 0, likes = 0, comments = 0 }) {
  if (views >= 100000 && likes + comments < 5) {
    return {
      code: "suspicious_view_pattern",
      message: "Very high views with almost no engagements should be reviewed. This is not an automatic fraud finding.",
    };
  }
  return null;
}

export function unavailablePostSignal(contentStatus = "") {
  const status = String(contentStatus || "").toLowerCase();
  if (["deleted", "private", "unavailable"].includes(status)) {
    return {
      code: `${status}_post`,
      message: `The submitted post appears ${status}. Reviewers should confirm before counting metrics.`,
    };
  }
  return null;
}
