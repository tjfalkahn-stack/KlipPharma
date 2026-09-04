import { nowIso } from "./campaign-constants.js";

const HOOK_CATEGORIES = [
  { key: "question", pattern: /\?|what if|how to|why /i },
  { key: "cta", pattern: /\b(follow|subscribe|comment|share|click|buy|shop|link in bio)\b/i },
  { key: "story", pattern: /\b(story|happened|remember when|one time)\b/i },
  { key: "hot_take", pattern: /\b(nobody|stop|never|always|unpopular|truth is)\b/i },
  { key: "lyric", pattern: /\b(chorus|verse|lyric|song)\b/i },
  { key: "lesson", pattern: /\b(tip|lesson|learn|mistake|advice)\b/i },
];

export function classifyHook(text = "") {
  const value = String(text || "");
  const match = HOOK_CATEGORIES.find((item) => item.pattern.test(value));
  return match?.key || (value.trim() ? "statement" : "unknown");
}

export function captionDensity(text = "", duration = 0) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  if (!duration) return words;
  return Math.round((words / duration) * 10) / 10;
}

export function inferPacing(duration) {
  const seconds = Number(duration) || 0;
  if (seconds <= 15) return "fast";
  if (seconds <= 35) return "social";
  if (seconds <= 60) return "story";
  return "long";
}

export function extractClipFeatures({ clip, job = null, campaign = null, extras = {} }) {
  const duration = Number(clip.duration ?? ((clip.sourceTimestamps?.end || 0) - (clip.sourceTimestamps?.start || 0))) || 0;
  const captionText = clip.captionPackage?.text || clip.transcript || "";
  return {
    hookText: clip.hook || "",
    hookCategory: classifyHook(clip.hook || clip.title || ""),
    openingVisual: extras.openingVisual || "unknown",
    firstSpeaker: extras.firstSpeaker || "unknown",
    duration,
    pacing: inferPacing(duration),
    captionStyle: clip.captionPackage?.style || "bold",
    captionDensity: captionDensity(captionText, duration),
    topic: extras.topic || campaign?.campaignType || job?.contentType || "unknown",
    sentiment: extras.sentiment || "unknown",
    musicSoundMetadata: extras.musicSoundMetadata || null,
    facePresent: extras.facePresent ?? null,
    sceneChangeFrequency: extras.sceneChangeFrequency ?? null,
    cta: /\b(follow|subscribe|comment|share|buy|shop|link)\b/i.test(`${clip.hook} ${captionText}`),
    postingPlatform: extras.postingPlatform || null,
    postingTime: extras.postingTime || null,
    campaignId: campaign?.id || clip.campaignId || null,
    audienceContext: extras.audienceContext || job?.audience || campaign?.contentRequirements?.audience || null,
    performanceScore: clip.performanceScore,
    source: "feature_extraction_v1",
    notes: "These are descriptive features, not a virality prediction.",
  };
}

export async function recordPerformanceObservation(store, {
  campaign, clip, submission, metrics,
}) {
  const existing = clip ? await store.getFeaturesForClip(clip.id) : null;
  const featureSnapshot = existing?.features || extractClipFeatures({ clip: clip || {}, campaign });
  return store.saveObservation({
    id: store.createId(),
    workspaceId: campaign.workspaceId,
    creatorId: campaign.creatorId,
    campaignId: campaign.id,
    clipId: clip?.id || null,
    submissionId: submission?.id || null,
    aggregatedLearningAuthorized: false,
    outcomes: {
      views: Number(metrics.views || 0),
      likes: Number(metrics.likes || 0),
      comments: Number(metrics.comments || 0),
      shares: Number(metrics.shares || 0),
      saves: metrics.saves == null ? null : Number(metrics.saves),
      engagementRate: Number(metrics.engagementRate || 0),
      platform: submission?.platform || null,
    },
    featureSnapshot,
    createdAt: nowIso(),
  });
}

export function historicalSignals(observations = []) {
  if (!observations.length) {
    return {
      label: "HISTORICAL SIGNAL",
      recommendedDurations: [],
      successfulHookTypes: [],
      captionStyles: [],
      topics: [],
      pacing: [],
      disclaimer: "No verified performance history is available yet. This is not a virality prediction.",
    };
  }
  const count = (pick) => {
    const totals = new Map();
    for (const item of observations) {
      const key = pick(item);
      if (!key) continue;
      const current = totals.get(key) || { key, count: 0, views: 0 };
      current.count += 1;
      current.views += Number(item.outcomes?.views || 0);
      totals.set(key, current);
    }
    return [...totals.values()].sort((a, b) => b.views - a.views || b.count - a.count).slice(0, 5);
  };
  return {
    label: "HISTORICAL SIGNAL",
    recommendedDurations: count((item) => item.featureSnapshot?.pacing),
    successfulHookTypes: count((item) => item.featureSnapshot?.hookCategory),
    captionStyles: count((item) => item.featureSnapshot?.captionStyle),
    topics: count((item) => item.featureSnapshot?.topic),
    pacing: count((item) => item.featureSnapshot?.pacing),
    sampleSize: observations.length,
    disclaimer: "High-performing patterns describe verified history in this workspace. They do not predict virality.",
  };
}

export function performanceScoreFromHistory(clipFeatures, observations = []) {
  if (!observations.length) {
    return {
      score: clipFeatures?.performanceScore ?? null,
      label: "PERFORMANCE SCORE",
      reason: "Editorial AutoKlip score only. No verified distribution history yet.",
    };
  }
  const related = observations.filter((item) => (
    item.featureSnapshot?.hookCategory === clipFeatures?.hookCategory
    || item.featureSnapshot?.pacing === clipFeatures?.pacing
  ));
  const avgViews = related.reduce((sum, item) => sum + Number(item.outcomes?.views || 0), 0) / Math.max(1, related.length);
  const baseline = observations.reduce((sum, item) => sum + Number(item.outcomes?.views || 0), 0) / observations.length;
  const lift = baseline > 0 ? avgViews / baseline : 1;
  const editorial = Number(clipFeatures?.performanceScore) || 50;
  const score = Math.round(clampScore(editorial * 0.7 + Math.min(100, lift * 40) * 0.3));
  return {
    score,
    label: "PERFORMANCE SCORE",
    historicalSignal: related.length ? "RECOMMENDED" : "LIMITED HISTORY",
    reason: related.length
      ? "Weighted from editorial quality plus historically successful patterns in this workspace."
      : "Not enough matching historical observations; editorial score used.",
  };
}

function clampScore(value) {
  return Math.min(100, Math.max(0, value));
}
