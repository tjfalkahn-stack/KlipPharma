import { costPerEngagement, costPerThousandViews, summarizeLedger } from "./campaign-ledger.js";
import { viewVelocity } from "./campaign-submissions.js";
import { historicalSignals } from "./clip-features.js";

function metricsOf(submission) {
  return submission.latestMetrics || submission.initialMetrics || {};
}

export async function campaignAnalytics(store, { campaign, includeFinancials = false }) {
  const [clips, submissions, participants, ledger, observations, flags] = await Promise.all([
    store.listClips(campaign.workspaceId, campaign.id),
    store.listSubmissions(campaign.workspaceId, { campaignId: campaign.id }),
    store.listParticipants(campaign.workspaceId, campaign.id),
    includeFinancials ? store.listLedger(campaign.workspaceId, { campaignId: campaign.id }) : Promise.resolve([]),
    store.listObservations(campaign.workspaceId, { campaignId: campaign.id, creatorId: campaign.creatorId }),
    store.listFlags(campaign.workspaceId, { campaignId: campaign.id }),
  ]);
  const verified = submissions.filter((item) => item.verificationStatus === "VERIFIED");
  const totals = verified.reduce((acc, item) => {
    const metrics = metricsOf(item);
    acc.views += Number(metrics.views || 0);
    acc.likes += Number(metrics.likes || 0);
    acc.comments += Number(metrics.comments || 0);
    acc.shares += Number(metrics.shares || 0);
    acc.saves += Number(metrics.saves || 0);
    acc.engagements += Number(metrics.engagements || 0);
    return acc;
  }, { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagements: 0 });
  const financials = includeFinancials ? summarizeLedger(ledger, campaign) : null;
  const spend = financials ? financials.approvedPayouts + financials.platformServiceFees : 0;
  const platformBreakdown = {};
  for (const submission of verified) {
    const bucket = platformBreakdown[submission.platform] || { platform: submission.platform, posts: 0, views: 0, engagements: 0 };
    bucket.posts += 1;
    bucket.views += Number(metricsOf(submission).views || 0);
    bucket.engagements += Number(metricsOf(submission).engagements || 0);
    platformBreakdown[submission.platform] = bucket;
  }
  const clipStats = {};
  for (const submission of verified) {
    if (!submission.clipId) continue;
    const bucket = clipStats[submission.clipId] || { clipId: submission.clipId, views: 0, posts: 0 };
    bucket.posts += 1;
    bucket.views += Number(metricsOf(submission).views || 0);
    clipStats[submission.clipId] = bucket;
  }
  const klipperStats = {};
  for (const submission of verified) {
    const key = submission.klipperId || submission.userId;
    const bucket = klipperStats[key] || { klipperId: submission.klipperId, userId: submission.userId, views: 0, posts: 0 };
    bucket.posts += 1;
    bucket.views += Number(metricsOf(submission).views || 0);
    klipperStats[key] = bucket;
  }
  const topClipId = Object.values(clipStats).sort((a, b) => b.views - a.views)[0];
  const topClip = topClipId ? clips.find((clip) => clip.id === topClipId.clipId) : null;
  const topKlipper = Object.values(klipperStats).sort((a, b) => b.views - a.views)[0] || null;
  const hookSignals = historicalSignals(observations);
  const timeline = verified
    .map((item) => ({
      at: item.reviewedAt || item.submittedAt,
      views: Number(metricsOf(item).views || 0),
      platform: item.platform,
      submissionId: item.id,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return {
    overview: {
      status: campaign.status,
      verifiedViews: totals.views,
      likes: totals.likes,
      comments: totals.comments,
      shares: totals.shares,
      saves: totals.saves,
      engagementRate: totals.views ? totals.engagements / totals.views : 0,
      submissions: submissions.length,
      verifiedSubmissions: verified.length,
      activeKlippers: participants.filter((item) => item.role === "KLIPPER" && item.status === "ACTIVE").length,
      klipsDistributed: clips.filter((clip) => clip.approvalStatus === "APPROVED").reduce((sum, clip) => sum + Number(clip.usageCount || 0), 0),
      approvedKlips: clips.filter((clip) => clip.approvalStatus === "APPROVED").length,
      flagsNeedingReview: flags.length,
    },
    goalProgress: {
      views: { target: campaign.targetViews, actual: totals.views },
      posts: { target: campaign.targetPosts, actual: verified.length },
    },
    financials: financials ? {
      ...financials,
      costPer1kVerifiedViews: costPerThousandViews(spend, totals.views),
      costPerEngagement: costPerEngagement(spend, totals.engagements),
    } : null,
    platformBreakdown: Object.values(platformBreakdown),
    topKlips: Object.values(clipStats).sort((a, b) => b.views - a.views).slice(0, 8).map((item) => ({
      ...item,
      title: clips.find((clip) => clip.id === item.clipId)?.title || "Klip",
      hook: clips.find((clip) => clip.id === item.clipId)?.hook || "",
    })),
    topKlippers: Object.values(klipperStats).sort((a, b) => b.views - a.views).slice(0, 8),
    topKlip: topClip ? { id: topClip.id, title: topClip.title, hook: topClip.hook, views: topClipId.views } : null,
    topKlipper,
    trendingHook: hookSignals.successfulHookTypes[0] || null,
    performanceTimeline: timeline,
    historicalSignal: hookSignals,
  };
}

export async function commandCenter(store, { workspaceId: _workspaceId, campaigns, includeFinancials = true }) {
  const live = campaigns.filter((item) => ["LIVE", "PAUSED"].includes(item.status));
  const reports = [];
  for (const campaign of live) {
    reports.push({ campaign, analytics: await campaignAnalytics(store, { campaign, includeFinancials }) });
  }
  const totals = reports.reduce((acc, item) => {
    acc.verifiedViews += item.analytics.overview.verifiedViews;
    acc.activeKlippers += item.analytics.overview.activeKlippers;
    acc.klipsDistributed += item.analytics.overview.klipsDistributed;
    acc.spend += Number(item.analytics.financials?.approvedPayouts || 0);
    return acc;
  }, { verifiedViews: 0, activeKlippers: 0, klipsDistributed: 0, spend: 0 });
  const topKlip = reports.flatMap((item) => item.analytics.topKlips.map((clip) => ({ ...clip, campaignTitle: item.campaign.title })))
    .sort((a, b) => b.views - a.views)[0] || null;
  const topKlipper = reports.flatMap((item) => item.analytics.topKlippers)
    .sort((a, b) => b.views - a.views)[0] || null;
  const trendingHook = reports.flatMap((item) => item.analytics.historicalSignal.successfulHookTypes || [])
    .sort((a, b) => b.views - a.views)[0] || null;
  return {
    activeCampaigns: live.filter((item) => item.status === "LIVE").length,
    totalVerifiedViews: totals.verifiedViews,
    activeKlippers: totals.activeKlippers,
    klipsDistributed: totals.klipsDistributed,
    campaignSpend: totals.spend,
    costPer1kViews: costPerThousandViews(totals.spend, totals.verifiedViews),
    topKlip,
    topKlipper,
    trendingHook,
    campaigns: reports.map((item) => ({
      id: item.campaign.id,
      title: item.campaign.title,
      status: item.campaign.status,
      verifiedViews: item.analytics.overview.verifiedViews,
      spend: item.analytics.financials?.approvedPayouts || 0,
    })),
  };
}

export async function submissionVelocity(store, submission) {
  const snapshots = await store.listSnapshots(submission.id);
  return {
    viewVelocity: viewVelocity(snapshots),
    snapshots: snapshots.length,
  };
}
