import express from "express";
import {
  CampaignError,
  FINANCIAL_ROLES,
  KLIPPER_HISTORY_STATUSES,
  MUTATOR_ROLES,
  PAYOUT_APPROVER_ROLES,
  REVIEWER_ROLES,
  workspaceRoleToCampaignRole,
} from "./campaign-constants.js";
import {
  assertCanCreateCampaign,
  assertCampaignScoped,
  assertRole,
  canApproveVault,
  canMutateCampaign,
  canReviewSubmissions,
  canViewFinancials,
  canViewManagementAnalytics,
  createCampaign,
  marketplaceCampaign,
  publicCampaign,
  publicRights,
  resolveActorRole,
  transitionCampaign,
  updateCampaign,
} from "./campaign-engine.js";
import { importProjectCandidates, reviewVaultClip, vaultClipForClient } from "./campaign-vault.js";
import {
  joinCampaign,
  publicKlipperProfile,
  recordExternalMetric,
  reviewParticipant,
  upsertKlipperProfile,
} from "./campaign-network.js";
import { createSubmission, reviewSubmission } from "./campaign-submissions.js";
import { campaignAnalytics, commandCenter } from "./campaign-performance.js";
import { publicKlipperLedgerEntries, reviewPayout, summarizeLedger } from "./campaign-ledger.js";
import { saveCampaignRights } from "./campaign-rights.js";
import { actorId, defaultWorkspaceId } from "./campaign-store.js";
import { buildAutoklipFeedbackContext } from "./autoklip-feedback.js";
import { fpaiAdapterCatalog } from "./fpai-adapters.js";
import { createBoundedRateLimiter, writeMethodsOnly } from "./rate-limit.js";
import { publicComputeCapabilities } from "./workspace-compute.js";

const writeAttempts = createBoundedRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 80,
  maxKeys: 10_000,
  message: "Too many campaign writes. Try again in a few minutes.",
}).startSweeper();
const campaignWriteLimit = writeMethodsOnly(writeAttempts);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function workspaceMappedRole(req) {
  return workspaceRoleToCampaignRole(req.user?.workspaceRole || req.team?.role, {
    isCreator: !req.team?.businessActive || req.user?.local,
  });
}

export function createCampaignRouter({
  store,
  metricsRegistry,
  getAccessibleJob,
  listAccessibleJobs,
  compute,
  allowAggregatedLearning = false,
  listConnectedPlatforms = null,
}) {
  const router = express.Router();
  router.use(campaignWriteLimit);
  const computePublic = publicComputeCapabilities(compute || {});

  async function loadCampaign(req, { allowMarketplace = false } = {}) {
    const workspaceId = defaultWorkspaceId(req);
    let campaign = await store.getCampaign(workspaceId, req.params.id);
    let participant = campaign
      ? await store.getParticipant(campaign.workspaceId, campaign.id, req.user.id)
      : await store.getParticipantByCampaignUser(req.params.id, req.user.id);

    if (!campaign && participant) {
      campaign = await store.getCampaign(participant.workspaceId, participant.campaignId);
    }

    if (!campaign && allowMarketplace) {
      const live = await store.listLiveDiscoverable();
      campaign = live.find((item) => item.id === req.params.id) || null;
    }

    if (!campaign) throw new CampaignError("Campaign not found.", 404, "not_found");

    if (!participant) {
      participant = await store.getParticipant(campaign.workspaceId, campaign.id, req.user.id);
    }

    const inWorkspace = campaign.workspaceId === workspaceId;
    const member = Boolean(participant && ["ACTIVE", "APPLIED", "INVITED"].includes(participant.status));
    const historyOk = member && KLIPPER_HISTORY_STATUSES.has(campaign.status);
    const liveDiscoverable = allowMarketplace && campaign.status === "LIVE";
    if (!inWorkspace && !historyOk && !liveDiscoverable) {
      throw new CampaignError("Campaign not found.", 404, "not_found");
    }

    const role = resolveActorRole(req, campaign, participant);
    return { campaign, participant, role, workspaceId: campaign.workspaceId, inWorkspace };
  }

  router.get("/command-center", asyncHandler(async (req, res) => {
    const workspaceId = defaultWorkspaceId(req);
    const role = workspaceMappedRole(req);
    const campaigns = await store.listCampaigns(workspaceId);
    res.json(await commandCenter(store, {
      workspaceId,
      campaigns,
      includeFinancials: canViewFinancials(role),
    }));
  }));

  router.get("/", asyncHandler(async (req, res) => {
    const workspaceId = defaultWorkspaceId(req);
    const role = workspaceMappedRole(req);
    const campaigns = await store.listCampaigns(workspaceId);
    res.json({
      campaigns: campaigns.map((item) => publicCampaign(item, { includeFinancials: canViewFinancials(role) })),
    });
  }));

  router.post("/", asyncHandler(async (req, res) => {
    assertCanCreateCampaign(req);
    const workspaceId = defaultWorkspaceId(req);
    const campaign = await createCampaign(store, {
      workspaceId,
      userId: req.user.id,
      input: req.body || {},
    });
    res.status(201).json({ campaign: publicCampaign(campaign, { includeFinancials: true }) });
  }));

  router.get("/compute", (_req, res) => {
    res.json(computePublic);
  });

  router.get("/fpai/adapters", (_req, res) => {
    res.json({ adapters: fpaiAdapterCatalog() });
  });

  router.get("/providers", (_req, res) => {
    res.json({
      socialMetrics: metricsRegistry.health(),
      payouts: { automaticPayouts: false, status: "ledger_only" },
    });
  });

  router.get("/klippers/me", asyncHandler(async (req, res) => {
    const profile = await store.getProfileByUser(req.user.id);
    const metrics = profile ? await store.listPlatformMetrics(profile.id) : [];
    res.json({ profile: publicKlipperProfile(profile, metrics) });
  }));

  router.patch("/klippers/me", asyncHandler(async (req, res) => {
    const profile = await upsertKlipperProfile(store, {
      userId: req.user.id,
      workspaceId: defaultWorkspaceId(req),
      input: req.body || {},
      listConnectedPlatforms,
    });
    res.json({ profile: publicKlipperProfile(profile) });
  }));

  router.post("/klippers/me/metrics", asyncHandler(async (req, res) => {
    const profile = await store.getProfileByUser(req.user.id);
    if (!profile) throw new CampaignError("Create a Klipper profile first.");
    const metric = await recordExternalMetric(store, {
      klipperId: profile.id,
      platform: req.body?.platform,
      handle: req.body?.handle,
      followerCount: req.body?.followerCount,
      metricsSource: req.body?.metricsSource,
      metricsEvidence: req.body?.metricsEvidence,
    });
    res.status(201).json({ metric });
  }));

  router.get("/marketplace/campaigns", asyncHandler(async (req, res) => {
    const campaigns = await store.listLiveDiscoverable({
      platform: req.query.platform,
      region: req.query.region,
    });
    const payload = [];
    for (const campaign of campaigns) {
      const rights = await store.getRights(campaign.workspaceId, campaign.id);
      payload.push(marketplaceCampaign(campaign, rights));
    }
    res.json({ campaigns: payload });
  }));

  router.get("/marketplace/my-campaigns", asyncHandler(async (req, res) => {
    const participations = await store.listParticipationsForUser(req.user.id);
    const campaigns = [];
    for (const participant of participations) {
      const campaign = await store.getCampaign(participant.workspaceId, participant.campaignId);
      if (campaign && KLIPPER_HISTORY_STATUSES.has(campaign.status)) {
        campaigns.push({ campaign: publicCampaign(campaign), participant });
      }
    }
    res.json({ campaigns });
  }));

  router.get("/marketplace/submissions", asyncHandler(async (req, res) => {
    const submissions = store.listSubmissionsForUser
      ? await store.listSubmissionsForUser(req.user.id)
      : await store.listSubmissions(defaultWorkspaceId(req), { userId: req.user.id });
    res.json({ submissions });
  }));

  router.get("/marketplace/earnings", asyncHandler(async (req, res) => {
    const profile = await store.getProfileByUser(req.user.id);
    const entries = profile && store.listLedgerForKlipper
      ? await store.listLedgerForKlipper(profile.id)
      : profile
        ? await store.listLedger(defaultWorkspaceId(req), { klipperId: profile.id })
        : [];
    res.json({
      automaticPayouts: false,
      earningsCalculated: profile?.earningsCalculated || 0,
      entries: publicKlipperLedgerEntries(entries),
    });
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req, { allowMarketplace: true });
    const rights = await store.getRights(campaign.workspaceId, campaign.id);
    res.json({
      campaign: publicCampaign(campaign, { includeFinancials: canViewFinancials(role) }),
      rights: publicRights(rights),
      role,
    });
  }));

  router.patch("/:id", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, MUTATOR_ROLES);
    const entries = await store.listLedger(campaign.workspaceId, { campaignId: campaign.id });
    const summary = summarizeLedger(entries, campaign);
    const saved = await updateCampaign(store, campaign, req.body || {}, actorId(req), {
      committedSpend: summary.committedSpend,
    });
    res.json({ campaign: publicCampaign(saved, { includeFinancials: true }) });
  }));

  router.post("/:id/status", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, MUTATOR_ROLES);
    const rights = await store.getRights(campaign.workspaceId, campaign.id);
    const saved = await transitionCampaign(store, campaign, req.body?.status, actorId(req), rights);
    res.json({ campaign: publicCampaign(saved, { includeFinancials: true }) });
  }));

  router.get("/:id/rights", asyncHandler(async (req, res) => {
    const { campaign } = await loadCampaign(req, { allowMarketplace: true });
    res.json({ rights: publicRights(await store.getRights(campaign.workspaceId, campaign.id)) });
  }));

  router.put("/:id/rights", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, MUTATOR_ROLES);
    const rights = await saveCampaignRights(store, {
      campaign,
      input: req.body || {},
      actorId: actorId(req),
      acknowledge: Boolean(req.body?.acknowledge),
    });
    res.json({ rights: publicRights(rights) });
  }));

  router.get("/:id/analytics", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    if (!canViewManagementAnalytics(role) || role === "KLIPPER") {
      throw new CampaignError("You cannot view campaign analytics.", 403, "forbidden");
    }
    res.json(await campaignAnalytics(store, { campaign, includeFinancials: canViewFinancials(role) }));
  }));

  router.get("/:id/intelligence", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, MUTATOR_ROLES);
    const context = await buildAutoklipFeedbackContext(store, {
      workspaceId: campaign.workspaceId,
      creatorId: campaign.creatorId,
      campaignId: campaign.id,
      allowAggregated: allowAggregatedLearning,
    });
    res.json(context);
  }));

  router.get("/:id/content", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    if (role === "KLIPPER" || !role) {
      throw new CampaignError("You cannot view campaign source content.", 403, "forbidden");
    }
    const clips = await store.listClips(campaign.workspaceId, campaign.id);
    const jobs = listAccessibleJobs ? listAccessibleJobs(req) : [];
    res.json({
      clips: clips.map((clip) => vaultClipForClient(clip, { includePrivate: canApproveVault(role) })),
      readyProjects: jobs.filter((job) => job.status === "ready").map((job) => ({
        id: job.id,
        title: job.originalName || job.title || "Source",
        clipCount: (job.clips || []).length,
      })),
    });
  }));

  router.get("/:id/vault", asyncHandler(async (req, res) => {
    const { campaign, role, participant } = await loadCampaign(req, { allowMarketplace: true });
    const approvedOnly = !(canApproveVault(role) || participant?.status === "ACTIVE");
    const clips = await store.listClips(campaign.workspaceId, campaign.id, {
      approvalStatus: approvedOnly ? "APPROVED" : null,
    });
    const visible = participant?.role === "KLIPPER" || role === "KLIPPER"
      ? clips.filter((clip) => clip.approvalStatus === "APPROVED")
      : clips;
    res.json({
      clips: visible.map((clip) => vaultClipForClient(clip, {
        includePrivate: canApproveVault(role) || (participant?.status === "ACTIVE" && clip.approvalStatus === "APPROVED"),
      })),
    });
  }));

  router.post("/:id/vault/from-project", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER", "EDITOR"]));
    const job = getAccessibleJob?.(req, req.body?.projectId);
    if (!job) throw new CampaignError("Project not found.", 404);
    const imported = await importProjectCandidates(store, {
      campaign,
      job,
      clipIds: req.body?.clipIds || [],
      actorId: actorId(req),
    });
    res.status(201).json({ clips: imported.map((clip) => vaultClipForClient(clip, { includePrivate: true })) });
  }));

  router.post("/:id/vault/:clipId/review", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER", "EDITOR", "REVIEWER"]));
    const clip = await store.getClip(campaign.workspaceId, req.params.clipId);
    assertCampaignScoped(clip, campaign, "Vault clip not found.");
    const saved = await reviewVaultClip(store, {
      clip,
      decision: req.body?.decision,
      actorId: actorId(req),
    });
    res.json({ clip: vaultClipForClient(saved, { includePrivate: true }) });
  }));

  router.get("/:id/participants", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    if (!canMutateCampaign(role) && role !== "REVIEWER") {
      throw new CampaignError("You cannot list campaign participants.", 403);
    }
    res.json({ participants: await store.listParticipants(campaign.workspaceId, campaign.id) });
  }));

  router.post("/:id/join", asyncHandler(async (req, res) => {
    const live = await store.listLiveDiscoverable();
    const campaign = live.find((item) => item.id === req.params.id);
    if (!campaign) throw new CampaignError("Campaign not found.", 404);
    let profile = await store.getProfileByUser(req.user.id);
    if (!profile) {
      profile = await upsertKlipperProfile(store, {
        userId: req.user.id,
        workspaceId: defaultWorkspaceId(req),
        input: {
          displayName: String(req.user.email || "Klipper").split("@")[0],
          username: `k_${String(req.user.id).replace(/[^a-z0-9]/gi, "").slice(0, 12) || "user"}`,
        },
        listConnectedPlatforms,
      });
    }
    const participant = await joinCampaign(store, {
      campaign,
      userId: req.user.id,
      profile,
      region: req.body?.region,
      actorId: actorId(req),
    });
    res.status(201).json({ participant });
  }));

  router.post("/:id/participants/:participantId/review", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, REVIEWER_ROLES);
    const participant = await store.getParticipantById(req.params.participantId);
    assertCampaignScoped(participant, campaign, "Participant not found.");
    const saved = await reviewParticipant(store, {
      participant,
      decision: req.body?.decision,
      actorId: actorId(req),
    });
    res.json({ participant: saved });
  }));

  router.get("/:id/submissions", asyncHandler(async (req, res) => {
    const { campaign, role, participant } = await loadCampaign(req);
    const userId = role === "KLIPPER" || !role ? req.user.id : null;
    const submissions = await store.listSubmissions(campaign.workspaceId, {
      campaignId: campaign.id,
      userId,
    });
    res.json({
      submissions,
      canReview: Boolean(participant && canReviewSubmissions(role)),
    });
  }));

  router.post("/:id/submissions", asyncHandler(async (req, res) => {
    const { campaign, participant } = await loadCampaign(req, { allowMarketplace: true });
    const clip = req.body?.clipId
      ? await store.getClip(campaign.workspaceId, req.body.clipId)
      : null;
    const profile = await store.getProfileByUser(req.user.id);
    const result = await createSubmission(store, {
      campaign,
      participant,
      profile,
      clip,
      platform: req.body?.platform,
      publicUrl: req.body?.publicUrl,
      actorId: actorId(req),
      metricsProvider: metricsRegistry,
    });
    res.status(201).json(result);
  }));

  router.post("/:id/submissions/:submissionId/review", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, REVIEWER_ROLES);
    const submission = await store.getSubmission(campaign.workspaceId, req.params.submissionId);
    assertCampaignScoped(submission, campaign, "Submission not found.");
    const clip = submission.clipId ? await store.getClip(campaign.workspaceId, submission.clipId) : null;
    const profile = submission.klipperId ? await store.getProfile(submission.klipperId) : null;
    const saved = await reviewSubmission(store, {
      campaign,
      submission,
      clip,
      profile,
      decision: req.body?.decision,
      metrics: req.body?.metrics || {},
      evidence: req.body?.evidence || {},
      rejectionReason: req.body?.rejectionReason,
      actorId: actorId(req),
    });
    res.json({ submission: saved });
  }));

  router.get("/:id/financials", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, FINANCIAL_ROLES);
    const entries = await store.listLedger(campaign.workspaceId, { campaignId: campaign.id });
    res.json({ financials: summarizeLedger(entries, campaign), entries });
  }));

  router.post("/:id/ledger/:entryId/review", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, PAYOUT_APPROVER_ROLES);
    const entry = await store.getLedgerEntry(campaign.workspaceId, req.params.entryId);
    assertCampaignScoped(entry, campaign, "Ledger entry not found.");
    const saved = await reviewPayout(store, {
      entry,
      campaign,
      decision: req.body?.decision,
      actorId: actorId(req),
      note: req.body?.note,
    });
    res.json({ entry: saved, payoutsDisabled: true });
  }));

  router.get("/:id/flags", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, REVIEWER_ROLES);
    res.json({ flags: await store.listFlags(campaign.workspaceId, { campaignId: campaign.id }) });
  }));

  router.get("/:id/audit", asyncHandler(async (req, res) => {
    const { campaign, role } = await loadCampaign(req);
    assertRole(role, MUTATOR_ROLES);
    res.json({ events: await store.listAudit(campaign.workspaceId, campaign.id) });
  }));

  router.use((error, _req, res, _next) => {
    if (error instanceof CampaignError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    if (error?.code === "ERR_INVALID_URL" || /Invalid URL/i.test(error?.message || "")) {
      return res.status(400).json({ error: "Enter a valid public http(s) URL." });
    }
    console.error("Campaign API error:", error);
    return res.status(500).json({ error: "Campaign service is temporarily unavailable." });
  });

  return router;
}
