import { nowIso } from "./campaign-constants.js";
import { writeAudit } from "./campaign-audit.js";
import { stableHash } from "./campaign-hash.js";

export const RIGHTS_MATERIAL_FIELDS = Object.freeze([
  "contentOwnershipDeclaration",
  "usagePermissions",
  "musicAudioRightsDeclaration",
  "allowedEditingRules",
  "brandGuidelines",
  "prohibitedUses",
  "campaignExpiration",
  "contentTakedownProcedure",
  "disclosureRequirements",
  "territoryRestrictions",
]);

export function rightsFingerprint(rights = {}) {
  return stableHash(Object.fromEntries(
    RIGHTS_MATERIAL_FIELDS.map((field) => [field, String(rights[field] || "").trim()]),
  ));
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
    && rights.acknowledgedAt
    && rights.acknowledgedHash
    && rights.acknowledgedHash === rights.contentHash
    && rights.acknowledgedVersion === rights.rightsVersion,
  );
}

export function publicRights(rights) {
  if (!rights) return null;
  return {
    campaignId: rights.campaignId,
    contentOwnershipDeclaration: rights.contentOwnershipDeclaration,
    usagePermissions: rights.usagePermissions,
    musicAudioRightsDeclaration: rights.musicAudioRightsDeclaration,
    allowedEditingRules: rights.allowedEditingRules,
    brandGuidelines: rights.brandGuidelines,
    prohibitedUses: rights.prohibitedUses,
    campaignExpiration: rights.campaignExpiration,
    contentTakedownProcedure: rights.contentTakedownProcedure,
    disclosureRequirements: rights.disclosureRequirements,
    territoryRestrictions: rights.territoryRestrictions,
    rightsVersion: rights.rightsVersion || 1,
    contentHash: rights.contentHash || null,
    acknowledgedVersion: rights.acknowledgedVersion || null,
    acknowledgedHash: rights.acknowledgedHash || null,
    acknowledgedAt: rights.acknowledgedAt,
    acknowledgedBy: rights.acknowledgedBy || null,
  };
}

function materialFieldsFrom(input, existing) {
  return Object.fromEntries(RIGHTS_MATERIAL_FIELDS.map((field) => [
    field,
    String(input[field] ?? existing?.[field] ?? "").trim(),
  ]));
}

export async function saveCampaignRights(store, { campaign, input, actorId, acknowledge = false }) {
  const existing = await store.getRights(campaign.workspaceId, campaign.id);
  const fields = materialFieldsFrom(input || {}, existing);
  const contentHash = rightsFingerprint(fields);
  const materialChanged = Boolean(existing?.contentHash && existing.contentHash !== contentHash)
    || Boolean(existing && RIGHTS_MATERIAL_FIELDS.some((field) => String(existing[field] || "").trim() !== fields[field]));
  const rightsVersion = existing
    ? (materialChanged ? Number(existing.rightsVersion || 1) + 1 : Number(existing.rightsVersion || 1))
    : 1;
  const keepAck = existing && !materialChanged && existing.acknowledgedHash === contentHash;
  const saved = await store.saveRights({
    id: campaign.id,
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    ...fields,
    rightsVersion,
    contentHash,
    acknowledgedBy: acknowledge ? actorId : (keepAck ? existing.acknowledgedBy : null),
    acknowledgedAt: acknowledge ? nowIso() : (keepAck ? existing.acknowledgedAt : null),
    acknowledgedVersion: acknowledge ? rightsVersion : (keepAck ? existing.acknowledgedVersion : null),
    acknowledgedHash: acknowledge ? contentHash : (keepAck ? existing.acknowledgedHash : null),
    createdAt: existing?.createdAt || nowIso(),
  });
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId,
    action: acknowledge ? "rights.acknowledged" : (materialChanged ? "rights.updated" : "rights.saved"),
    entityType: "rights",
    entityId: campaign.id,
    details: {
      rightsVersion,
      contentHash,
      acknowledgmentInvalidated: Boolean(materialChanged && existing?.acknowledgedAt && !acknowledge),
    },
  });
  return saved;
}
