import { historicalSignals, performanceScoreFromHistory } from "./clip-features.js";

export async function buildAutoklipFeedbackContext(store, {
  workspaceId, creatorId, campaignId = null, allowAggregated = false,
}) {
  const observations = await store.listObservations(workspaceId, { creatorId, campaignId });
  const scoped = allowAggregated
    ? observations
    : observations.filter((item) => item.workspaceId === workspaceId && item.creatorId === creatorId);
  const signals = historicalSignals(scoped);
  return {
    workspaceId,
    creatorId,
    campaignId,
    aggregatedLearningAuthorized: Boolean(allowAggregated),
    historicalSignal: signals,
    promptBlock: formatPromptBlock(signals),
  };
}

export function formatPromptBlock(signals) {
  if (!signals?.sampleSize) {
    return "HISTORICAL SIGNAL: none yet for this workspace/creator. Rank from transcript quality only. Do not claim virality.";
  }
  const line = (label, rows) => rows?.length
    ? `${label}: ${rows.map((row) => `${row.key} (${row.count} verified, ${row.views} views)`).join("; ")}`
    : `${label}: insufficient history`;
  return [
    "HISTORICAL SIGNAL (workspace-scoped, not a virality prediction)",
    line("High-performing hook types", signals.successfulHookTypes),
    line("High-performing pacing", signals.pacing),
    line("Caption styles", signals.captionStyles),
    line("Topics", signals.topics),
    "Use these only as ranking hints after transcript-grounded selection. Human approval is still required.",
  ].join("\n");
}

export function rankCandidatesWithHistory(candidates = [], observations = []) {
  return candidates
    .map((clip, index) => {
      const scored = performanceScoreFromHistory({
        hookCategory: clip.hookCategory || clip.strategy,
        pacing: clip.pacing,
        captionStyle: clip.captionStyle,
        performanceScore: clip.overallScore,
      }, observations);
      return {
        ...clip,
        historicalSignal: scored.historicalSignal || "HISTORICAL SIGNAL",
        performanceScore: scored.score,
        rankingReason: scored.reason,
        originalRank: index + 1,
      };
    })
    .sort((a, b) => Number(b.performanceScore || 0) - Number(a.performanceScore || 0));
}
