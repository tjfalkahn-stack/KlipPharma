import { nowIso } from "./campaign-constants.js";
import { writeAudit } from "./campaign-engine.js";

export async function saveCampaignRights(store, { campaign, input, actorId, acknowledge = false }) {
  const existing = await store.getRights(campaign.workspaceId, campaign.id);
  const saved = await store.saveRights({
    id: campaign.id,
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    contentOwnershipDeclaration: String(input.contentOwnershipDeclaration ?? existing?.contentOwnershipDeclaration ?? "").trim(),
    usagePermissions: String(input.usagePermissions ?? existing?.usagePermissions ?? "").trim(),
    musicAudioRightsDeclaration: String(input.musicAudioRightsDeclaration ?? existing?.musicAudioRightsDeclaration ?? "").trim(),
    allowedEditingRules: String(input.allowedEditingRules ?? existing?.allowedEditingRules ?? "").trim(),
    brandGuidelines: String(input.brandGuidelines ?? existing?.brandGuidelines ?? "").trim(),
    prohibitedUses: String(input.prohibitedUses ?? existing?.prohibitedUses ?? "").trim(),
    campaignExpiration: String(input.campaignExpiration ?? existing?.campaignExpiration ?? "").trim(),
    contentTakedownProcedure: String(input.contentTakedownProcedure ?? existing?.contentTakedownProcedure ?? "").trim(),
    disclosureRequirements: String(input.disclosureRequirements ?? existing?.disclosureRequirements ?? "").trim(),
    territoryRestrictions: String(input.territoryRestrictions ?? existing?.territoryRestrictions ?? "").trim(),
    acknowledgedBy: acknowledge ? actorId : existing?.acknowledgedBy || null,
    acknowledgedAt: acknowledge ? nowIso() : existing?.acknowledgedAt || null,
    createdAt: existing?.createdAt || nowIso(),
  });
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId,
    action: acknowledge ? "rights.acknowledged" : "rights.updated",
    entityType: "rights",
    entityId: campaign.id,
  });
  return saved;
}

export function rightsComplete(rights) {
  if (!rights) return false;
  return Boolean(
    rights.contentOwnershipDeclaration
    && rights.usagePermissions
    && rights.musicAudioRightsDeclaration
    && rights.allowedEditingRules
    && rights.brandGuidelines
    && rights.prohibitedUses
    && rights.contentTakedownProcedure
    && rights.disclosureRequirements
    && rights.acknowledgedAt,
  );
}
