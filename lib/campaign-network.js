import { CampaignError, clamp, nowIso, uniqueStrings } from "./campaign-constants.js";
import { writeAudit } from "./campaign-audit.js";
import { assertJoinRegion } from "./campaign-regions.js";

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export function publicKlipperProfile(profile, metrics = []) {
  if (!profile) return null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
    socialHandles: (profile.socialHandles || []).map((handle) => ({
      platform: handle.platform,
      handle: handle.handle,
    })),
    connectedPlatforms: profile.connectedPlatforms || [],
    categories: profile.categories || [],
    locationRegion: profile.locationRegion || null,
    campaignHistory: profile.campaignHistory || [],
    approvedSubmissions: profile.approvedSubmissions || 0,
    rejectedSubmissions: profile.rejectedSubmissions || 0,
    verifiedViews: profile.verifiedViews || 0,
    earningsCalculated: profile.earningsCalculated || 0,
    reliabilityScore: profile.reliabilityScore,
    platformMetrics: metrics.map((item) => ({
      platform: item.platform,
      handle: item.handle,
      followerCount: item.followerCount,
      metricsSource: item.metricsSource,
      capturedAt: item.capturedAt,
      hasEvidence: Boolean(item.metricsEvidence && Object.keys(item.metricsEvidence).length),
    })),
  };
}

export function normalizeProfileInput(body = {}, { existing = null, userId = undefined } = {}) {
  const displayName = String(body.displayName ?? existing?.displayName ?? "").trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw new CampaignError("Display name must be between 2 and 80 characters.");
  }
  const username = String(body.username ?? existing?.username ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!USERNAME_PATTERN.test(username)) {
    throw new CampaignError("Username must be 3-32 characters using letters, numbers, or underscores.");
  }
  const socialHandles = (body.socialHandles ?? existing?.socialHandles ?? []).map((item) => ({
    platform: String(item.platform || "").toLowerCase(),
    handle: String(item.handle || "").trim(),
  })).filter((item) => item.platform && item.handle);
  return {
    userId,
    displayName,
    username,
    socialHandles,
    categories: uniqueStrings(body.categories ?? existing?.categories ?? []),
    locationRegion: String(body.locationRegion ?? existing?.locationRegion ?? "").trim() || null,
  };
}

export async function deriveConnectedPlatforms(listConnectedPlatforms, userId, existing = []) {
  if (typeof listConnectedPlatforms === "function") {
    return uniqueStrings(await listConnectedPlatforms(userId));
  }
  return uniqueStrings(existing);
}

export async function upsertKlipperProfile(store, { userId, workspaceId, input, listConnectedPlatforms }) {
  const existing = await store.getProfileByUser(userId);
  const fields = normalizeProfileInput(input, { existing, userId });
  const taken = await store.getProfileByUsername(fields.username);
  if (taken && taken.userId !== userId) throw new CampaignError("That username is already taken.", 409);
  const connectedPlatforms = await deriveConnectedPlatforms(
    listConnectedPlatforms,
    userId,
    existing?.connectedPlatforms || [],
  );
  return store.saveProfile({
    id: existing?.id || store.createId(),
    workspaceId: existing?.workspaceId || workspaceId || null,
    campaignHistory: existing?.campaignHistory || [],
    approvedSubmissions: existing?.approvedSubmissions || 0,
    rejectedSubmissions: existing?.rejectedSubmissions || 0,
    verifiedViews: existing?.verifiedViews || 0,
    earningsCalculated: existing?.earningsCalculated || 0,
    reliabilityScore: existing?.reliabilityScore ?? 70,
    createdAt: existing?.createdAt || nowIso(),
    ...fields,
    connectedPlatforms,
  });
}

export async function recordExternalMetric(store, {
  klipperId, platform, handle, followerCount, metricsSource, metricsEvidence,
}) {
  if (followerCount != null && (!metricsSource || !metricsEvidence)) {
    throw new CampaignError("Follower counts require a metrics source and evidence. KlipPharma does not fabricate social metrics.");
  }
  return store.savePlatformMetric({
    id: store.createId(),
    klipperId,
    platform: String(platform || "").toLowerCase(),
    handle: handle || null,
    followerCount: followerCount == null ? null : Number(followerCount),
    metricsSource,
    metricsEvidence: metricsEvidence || {},
    capturedAt: nowIso(),
  });
}

export async function joinCampaign(store, {
  campaign, userId, profile, region = null, actorId,
}) {
  if (campaign.status !== "LIVE") {
    throw new CampaignError("Only live campaigns can be joined.", 409);
  }
  const normalizedRegion = assertJoinRegion(campaign, region);
  const existing = await store.getParticipant(campaign.workspaceId, campaign.id, userId);
  if (existing?.status === "ACTIVE") return existing;
  if (existing?.status === "REJECTED" || existing?.status === "REMOVED") {
    throw new CampaignError("This account cannot rejoin that campaign without a reviewer.", 403);
  }
  const requiresApproval = campaign.approvalRequired !== false;
  const participant = await store.saveParticipant({
    id: existing?.id || store.createId(),
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    userId,
    klipperId: profile?.id || null,
    role: "KLIPPER",
    status: requiresApproval ? "APPLIED" : "ACTIVE",
    region: normalizedRegion,
    createdAt: existing?.createdAt || nowIso(),
  });
  if (profile) {
    const history = uniqueStrings([...(profile.campaignHistory || []), campaign.id]);
    await store.saveProfile({ ...profile, campaignHistory: history });
  }
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId: actorId || userId,
    action: requiresApproval ? "participant.applied" : "participant.joined",
    entityType: "participant",
    entityId: participant.id,
  });
  return participant;
}

export async function reviewParticipant(store, { participant, decision, actorId }) {
  const status = String(decision || "").toUpperCase();
  if (!["ACTIVE", "REJECTED", "REMOVED"].includes(status)) {
    throw new CampaignError("Participant review must be ACTIVE, REJECTED, or REMOVED.");
  }
  const saved = await store.saveParticipant({ ...participant, status });
  await writeAudit(store, {
    workspaceId: participant.workspaceId,
    campaignId: participant.campaignId,
    actorId,
    action: `participant.${status.toLowerCase()}`,
    entityType: "participant",
    entityId: participant.id,
  });
  return saved;
}

export function reliabilityScore({ approved = 0, rejected = 0, flagged = 0 }) {
  const total = approved + rejected + flagged;
  if (!total) return 70;
  const raw = 100 * (approved / total) - flagged * 8;
  return Math.round(clamp(raw, 0, 100));
}
