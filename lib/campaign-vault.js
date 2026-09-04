import { CampaignError, nowIso } from "./campaign-constants.js";
import { extractClipFeatures } from "./clip-features.js";
import { writeAudit } from "./campaign-engine.js";

export function vaultClipForClient(clip, { includePrivate = false } = {}) {
  if (!clip) return null;
  const view = {
    id: clip.id,
    campaignId: clip.campaignId,
    duration: clip.duration,
    aspectRatio: clip.aspectRatio,
    hook: clip.hook,
    title: clip.title,
    description: clip.description,
    thumbnail: clip.thumbnail,
    processingVersion: clip.processingVersion,
    approvalStatus: clip.approvalStatus,
    performanceScore: clip.performanceScore,
    usageCount: clip.usageCount,
    sourceTimestamps: clip.sourceTimestamps,
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
  };
  if (includePrivate || clip.approvalStatus === "APPROVED") {
    view.transcript = clip.transcript;
    view.captionPackage = clip.captionPackage;
    view.sourceProjectId = clip.sourceProjectId;
    view.sourceMediaId = clip.sourceMediaId;
    view.sourceClipId = clip.sourceClipId;
  }
  return view;
}

export function candidateFromProjectClip(job, clip) {
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || start;
  return {
    sourceProjectId: job.id,
    sourceMediaId: job.id,
    sourceClipId: clip.id,
    sourceTimestamps: { start, end },
    duration: Math.max(0, end - start),
    aspectRatio: "9:16",
    transcript: clip.captionText || clip.caption || job.transcript || "",
    captionPackage: {
      enabled: clip.captionsEnabled !== false,
      text: clip.captionText || clip.caption || "",
      style: clip.captionStyle || "bold",
      position: clip.captionPosition || "bottom",
    },
    hook: clip.hook || "",
    title: clip.title || "Untitled klip",
    description: clip.whyChosen || clip.caption || "",
    thumbnail: null,
    processingVersion: job.processingVersion || "autoklip-v1",
    performanceScore: Number.isFinite(Number(clip.overallScore)) ? Math.round(Number(clip.overallScore)) : null,
  };
}

export async function importProjectCandidates(store, {
  campaign, job, clipIds = [], actorId,
}) {
  if (!job?.clips?.length) throw new CampaignError("That project has no clips to import.");
  const selected = clipIds.length
    ? job.clips.filter((clip) => clipIds.includes(clip.id))
    : job.clips;
  if (!selected.length) throw new CampaignError("No matching clips were found on that project.");
  const imported = [];
  for (const clip of selected) {
    const existing = await store.findClipBySource(campaign.workspaceId, campaign.id, job.id, clip.id);
    const payload = candidateFromProjectClip(job, clip);
    const saved = await store.saveClip({
      id: existing?.id || store.createId(),
      campaignId: campaign.id,
      workspaceId: campaign.workspaceId,
      approvalStatus: existing?.approvalStatus === "APPROVED" ? "APPROVED" : "CANDIDATE",
      usageCount: existing?.usageCount || 0,
      createdAt: existing?.createdAt || nowIso(),
      ...payload,
    });
    const features = extractClipFeatures({
      clip: saved,
      job,
      campaign,
    });
    const existingFeatures = await store.getFeaturesForClip(saved.id);
    await store.saveFeatures({
      id: existingFeatures?.id || store.createId(),
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      clipId: saved.id,
      features,
      createdAt: existingFeatures?.createdAt || nowIso(),
    });
    imported.push(saved);
  }
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId,
    action: "vault.imported",
    entityType: "campaign_clip",
    entityId: campaign.id,
    details: { projectId: job.id, count: imported.length },
  });
  return imported;
}

export async function reviewVaultClip(store, { clip, decision, actorId }) {
  const approvalStatus = String(decision || "").toUpperCase();
  if (!["APPROVED", "REJECTED", "ARCHIVED"].includes(approvalStatus)) {
    throw new CampaignError("Vault review must be APPROVED, REJECTED, or ARCHIVED.");
  }
  const saved = await store.saveClip({
    ...clip,
    approvalStatus,
    approvedBy: actorId,
    approvedAt: nowIso(),
  });
  await writeAudit(store, {
    workspaceId: clip.workspaceId,
    campaignId: clip.campaignId,
    actorId,
    action: `vault.${approvalStatus.toLowerCase()}`,
    entityType: "campaign_clip",
    entityId: clip.id,
  });
  return saved;
}

export async function incrementClipUsage(store, clip) {
  return store.saveClip({ ...clip, usageCount: Number(clip.usageCount || 0) + 1 });
}
