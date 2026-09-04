import { nowIso } from "./campaign-constants.js";

export async function writeAudit(store, {
  workspaceId, campaignId, actorId, action, entityType, entityId, details = {},
}) {
  return store.saveAudit({
    id: store.createId(),
    workspaceId,
    campaignId: campaignId || null,
    actorId,
    action,
    entityType,
    entityId: entityId || null,
    details,
    createdAt: nowIso(),
  });
}
