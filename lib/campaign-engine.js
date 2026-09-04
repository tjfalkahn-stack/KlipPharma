import {
  ANALYTICS_ROLES,
  APPROVER_ROLES,
  CAMPAIGN_TYPES,
  CampaignError,
  FINANCIAL_ROLES,
  MUTATOR_ROLES,
  PAYOUT_APPROVER_ROLES,
  PAYOUT_MODELS,
  REVIEWER_ROLES,
  SUPPORTED_PLATFORMS,
  canCreateCampaignFromRequest,
  canTransitionCampaignStatus,
  money,
  nowIso,
  uniqueStrings,
  workspaceRoleToCampaignRole,
} from "./campaign-constants.js";
import { writeAudit } from "./campaign-audit.js";
import { publicRights, rightsComplete } from "./campaign-rights.js";
import { normalizeAllowedRegions } from "./campaign-regions.js";

export { publicRights, rightsComplete };
export { canCreateCampaignFromRequest };

export function publicCampaign(campaign, { includeFinancials = false } = {}) {
  if (!campaign) return null;
  const view = {
    id: campaign.id,
    workspaceId: campaign.workspaceId,
    creatorId: campaign.creatorId,
    title: campaign.title,
    description: campaign.description,
    campaignType: campaign.campaignType,
    status: campaign.status,
    currency: campaign.currency,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    targetViews: campaign.targetViews,
    targetPosts: campaign.targetPosts,
    targetPlatforms: campaign.targetPlatforms,
    allowedRegions: campaign.allowedRegions,
    campaignRules: campaign.campaignRules,
    contentRequirements: campaign.contentRequirements,
    prohibitedContent: campaign.prohibitedContent,
    payoutModel: campaign.payoutModel,
    approvalRequired: campaign.approvalRequired,
    sourceMediaIds: campaign.sourceMediaIds,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
  if (includeFinancials) {
    view.budget = campaign.budget;
    view.payoutRate = campaign.payoutRate;
    view.payoutCap = campaign.payoutCap;
    view.createdBy = campaign.createdBy;
  }
  return view;
}

export function marketplaceCampaign(campaign, rights = null) {
  return {
    ...publicCampaign(campaign),
    rights: rights ? publicRights(rights) : null,
    payoutModel: campaign.payoutModel,
    payoutRate: campaign.payoutModel === "NONE" ? null : campaign.payoutRate,
    payoutCap: campaign.payoutCap,
    currency: campaign.currency,
  };
}

export function resolveActorRole(req, campaign, participant) {
  if (participant?.status === "ACTIVE" && participant.role) return participant.role;
  if (campaign && req.user?.id === campaign.creatorId) return "CAMPAIGN_OWNER";
  const mapped = workspaceRoleToCampaignRole(req.user?.workspaceRole || req.team?.role, {
    isCreator: false,
  });
  const sameWorkspace = Boolean(
    mapped
    && campaign
    && (
      (req.team?.businessActive && req.team?.id === campaign.workspaceId)
      || (!req.team?.businessActive && (req.user?.workspaceId || req.team?.id) === campaign.workspaceId)
      || (req.user?.local && req.team?.id === campaign.workspaceId)
    ),
  );
  if (sameWorkspace) return mapped;
  if (req.user?.id === campaign?.creatorId) return "CAMPAIGN_OWNER";
  return participant?.role || null;
}

export function assertRole(role, allowed, message = "You do not have access to this campaign action.") {
  if (!allowed.has(role)) throw new CampaignError(message, 403, "forbidden");
}

export function assertCanCreateCampaign(req) {
  if (!canCreateCampaignFromRequest(req)) {
    throw new CampaignError("Only workspace owners, admins, or manager-authorized users may create campaigns.", 403, "forbidden");
  }
}

export function canMutateCampaign(role) {
  return MUTATOR_ROLES.has(role);
}

export function canApproveVault(role) {
  return APPROVER_ROLES.has(role);
}

export function canReviewSubmissions(role) {
  return REVIEWER_ROLES.has(role);
}

export function canViewFinancials(role) {
  return FINANCIAL_ROLES.has(role);
}

export function canApprovePayout(role) {
  return PAYOUT_APPROVER_ROLES.has(role);
}

export function canViewManagementAnalytics(role) {
  return ANALYTICS_ROLES.has(role);
}

export function assertCampaignScoped(record, campaign, message = "Not found.") {
  if (
    !record
    || record.workspaceId !== campaign.workspaceId
    || (record.campaignId && record.campaignId !== campaign.id)
  ) {
    throw new CampaignError(message, 404, "not_found");
  }
  return record;
}

export function normalizeCampaignInput(body = {}, { existing = null } = {}) {
  const title = String(body.title ?? existing?.title ?? "").trim();
  if (title.length < 3 || title.length > 120) {
    throw new CampaignError("Campaign title must be between 3 and 120 characters.");
  }
  const description = String(body.description ?? existing?.description ?? "").trim();
  if (description.length > 8000) throw new CampaignError("Campaign description is too long.");
  const campaignType = String(body.campaignType ?? existing?.campaignType ?? "clip_distribution").trim();
  if (!CAMPAIGN_TYPES.includes(campaignType)) throw new CampaignError("Unsupported campaign type.");
  const payoutModel = String(body.payoutModel ?? existing?.payoutModel ?? "NONE").toUpperCase();
  if (!PAYOUT_MODELS.includes(payoutModel)) throw new CampaignError("Unsupported payout model.");
  const targetPlatforms = uniqueStrings(body.targetPlatforms ?? existing?.targetPlatforms ?? [])
    .map((item) => item.toLowerCase());
  if (targetPlatforms.some((platform) => !SUPPORTED_PLATFORMS.includes(platform))) {
    throw new CampaignError("Target platforms must be tiktok, instagram, youtube, or x.");
  }
  const budget = money(body.budget ?? existing?.budget ?? 0);
  if (budget < 0) throw new CampaignError("Budget cannot be negative.");
  const payoutRate = money(body.payoutRate ?? existing?.payoutRate ?? 0);
  if (payoutRate < 0) throw new CampaignError("Payout rate cannot be negative.");
  const payoutCap = body.payoutCap == null && existing?.payoutCap == null
    ? null
    : money(body.payoutCap ?? existing?.payoutCap);
  if (payoutCap != null && payoutCap < 0) throw new CampaignError("Payout cap cannot be negative.");
  const startDate = body.startDate ?? existing?.startDate ?? null;
  const endDate = body.endDate ?? existing?.endDate ?? null;
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    throw new CampaignError("End date must be on or after the start date.");
  }
  return {
    title,
    description,
    campaignType,
    budget,
    currency: String(body.currency ?? existing?.currency ?? "USD").toUpperCase().slice(0, 8) || "USD",
    startDate,
    endDate,
    targetViews: Math.max(0, Number(body.targetViews ?? existing?.targetViews ?? 0) || 0),
    targetPosts: Math.max(0, Number(body.targetPosts ?? existing?.targetPosts ?? 0) || 0),
    targetPlatforms,
    allowedRegions: normalizeAllowedRegions(body.allowedRegions ?? existing?.allowedRegions ?? []),
    campaignRules: body.campaignRules ?? existing?.campaignRules ?? {},
    contentRequirements: body.contentRequirements ?? existing?.contentRequirements ?? {},
    prohibitedContent: body.prohibitedContent ?? existing?.prohibitedContent ?? {},
    payoutModel,
    payoutRate,
    payoutCap,
    approvalRequired: body.approvalRequired ?? existing?.approvalRequired ?? true,
    sourceMediaIds: uniqueStrings(body.sourceMediaIds ?? existing?.sourceMediaIds ?? []),
  };
}

export function assertReadyForLive(campaign, rights) {
  if (!campaign.targetPlatforms?.length) {
    throw new CampaignError("Add at least one target platform before going live.");
  }
  if (!campaign.startDate || !campaign.endDate) {
    throw new CampaignError("Set start and end dates before going live.");
  }
  if (!rightsComplete(rights)) {
    throw new CampaignError("Acknowledge campaign rights and brand-safety terms before going live.");
  }
  if (campaign.payoutModel !== "NONE" && Number(campaign.payoutRate) <= 0) {
    throw new CampaignError("Set a payout rate or choose payout model NONE.");
  }
}

export async function createCampaign(store, { workspaceId, userId, input }) {
  const fields = normalizeCampaignInput(input);
  const campaign = await store.saveCampaign({
    id: store.createId(),
    workspaceId,
    creatorId: userId,
    status: "DRAFT",
    createdBy: userId,
    createdAt: nowIso(),
    ...fields,
  });
  await store.saveParticipant({
    id: store.createId(),
    campaignId: campaign.id,
    workspaceId,
    userId,
    klipperId: null,
    role: "CAMPAIGN_OWNER",
    status: "ACTIVE",
    createdAt: nowIso(),
  });
  if (fields.budget > 0) {
    await store.saveLedgerEntry({
      id: store.createId(),
      campaignId: campaign.id,
      workspaceId,
      entryType: "budget",
      amount: fields.budget,
      currency: fields.currency,
      note: "Campaign budget",
      metadata: {},
      createdAt: nowIso(),
    });
  }
  await writeAudit(store, {
    workspaceId, campaignId: campaign.id, actorId: userId,
    action: "campaign.created", entityType: "campaign", entityId: campaign.id,
  });
  return campaign;
}

export async function updateCampaign(store, campaign, input, actorId, { committedSpend = 0 } = {}) {
  if (["COMPLETED", "ARCHIVED"].includes(campaign.status) && input.status == null) {
    throw new CampaignError("Completed or archived campaigns cannot be edited.", 409);
  }
  const fields = normalizeCampaignInput(input, { existing: campaign });
  if (fields.budget !== money(campaign.budget || 0) && fields.budget < Number(committedSpend || 0)) {
    throw new CampaignError("Budget cannot be lower than reserved, approved, and paid compensation.", 409, "budget_too_low");
  }
  const saved = await store.saveCampaign({ ...campaign, ...fields });
  if (fields.budget !== money(campaign.budget || 0)) {
    const delta = money(fields.budget - Number(campaign.budget || 0));
    await store.saveLedgerEntry({
      id: store.createId(),
      campaignId: campaign.id,
      workspaceId: campaign.workspaceId,
      entryType: "budget_adjustment",
      amount: Math.abs(delta),
      currency: fields.currency,
      note: delta >= 0 ? "Campaign budget increased" : "Campaign budget decreased",
      metadata: { from: campaign.budget, to: fields.budget, delta },
      createdAt: nowIso(),
    });
  }
  await writeAudit(store, {
    workspaceId: campaign.workspaceId, campaignId: campaign.id, actorId,
    action: "campaign.updated", entityType: "campaign", entityId: campaign.id,
    details: { budgetChanged: fields.budget !== money(campaign.budget || 0) },
  });
  return saved;
}

export async function transitionCampaign(store, campaign, nextStatus, actorId, rights = null) {
  const target = String(nextStatus || "").toUpperCase();
  if (!canTransitionCampaignStatus(campaign.status, target)) {
    throw new CampaignError(`Cannot move a ${campaign.status} campaign to ${target}.`, 409, "invalid_transition");
  }
  if (target === "LIVE") assertReadyForLive(campaign, rights);
  const saved = await store.saveCampaign({ ...campaign, status: target });
  await writeAudit(store, {
    workspaceId: campaign.workspaceId, campaignId: campaign.id, actorId,
    action: "campaign.status", entityType: "campaign", entityId: campaign.id,
    details: { from: campaign.status, to: target },
  });
  return saved;
}
