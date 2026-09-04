import { createMemoryCampaignStore } from "../lib/campaign-store.js";
import { createCampaign, transitionCampaign } from "../lib/campaign-engine.js";
import { saveCampaignRights } from "../lib/campaign-rights.js";
import { LOCAL_WORKSPACE_ID } from "../lib/campaign-constants.js";

export const WS_A = "11111111-1111-4111-8111-111111111111";
export const WS_B = "22222222-2222-4222-8222-222222222222";

export function publicResolver(address = "93.184.216.34") {
  return async () => [{ address }];
}

export const COMPLETE_RIGHTS = {
  contentOwnershipDeclaration: "Creator owns the source.",
  usagePermissions: "Approved clips may be posted to listed platforms.",
  musicAudioRightsDeclaration: "Only cleared audio.",
  allowedEditingRules: "Captions and safe trims only.",
  brandGuidelines: "Keep the KlipPharma look; do not copy third-party brands.",
  prohibitedUses: "No hate or scraped content.",
  contentTakedownProcedure: "Email the campaign owner.",
  disclosureRequirements: "Disclose paid partnership when required.",
};

export async function seedLiveCampaign(store, {
  workspaceId = LOCAL_WORKSPACE_ID,
  userId = "creator-1",
  approvalRequired = false,
  payoutModel = "CPM",
  payoutRate = 2,
  budget = 500,
  allowedRegions = [],
  title = "Launch clips",
} = {}) {
  const campaign = await createCampaign(store, {
    workspaceId,
    userId,
    input: {
      title,
      description: "Distribute approved verticals",
      targetPlatforms: ["tiktok"],
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-12-01T00:00:00.000Z",
      payoutModel,
      payoutRate,
      budget,
      approvalRequired,
      allowedRegions,
    },
  });
  const rights = await saveCampaignRights(store, {
    campaign,
    actorId: userId,
    acknowledge: true,
    input: COMPLETE_RIGHTS,
  });
  const ready = await transitionCampaign(store, campaign, "READY", userId, rights);
  return transitionCampaign(store, ready, "LIVE", userId, rights);
}

export function memoryStore() {
  return createMemoryCampaignStore();
}
