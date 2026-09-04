import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createMemoryCampaignStore } from "../lib/campaign-store.js";
import { createCampaignRouter } from "../lib/campaign-routes.js";
import { createMetricsRegistry } from "../lib/social-metrics.js";
import { LOCAL_WORKSPACE_ID } from "../lib/campaign-constants.js";
import { importProjectCandidates, reviewVaultClip } from "../lib/campaign-vault.js";
import { joinCampaign, upsertKlipperProfile } from "../lib/campaign-network.js";
import { createSubmission, reviewSubmission } from "../lib/campaign-submissions.js";
import { WS_A, WS_B, seedLiveCampaign, publicResolver, COMPLETE_RIGHTS } from "./campaign-helpers.js";

const IDENTITIES = {
  owner: {
    user: { id: "owner-a", email: "owner@a.test", workspaceRole: "owner" },
    team: { id: WS_A, role: "owner", businessActive: true, memberIds: ["owner-a"] },
  },
  admin: {
    user: { id: "admin-a", email: "admin@a.test", workspaceRole: "admin" },
    team: { id: WS_A, role: "admin", businessActive: true, memberIds: ["owner-a", "admin-a"] },
  },
  editor: {
    user: { id: "editor-a", email: "editor@a.test", workspaceRole: "editor" },
    team: { id: WS_A, role: "editor", businessActive: true, memberIds: ["owner-a", "editor-a"] },
  },
  viewer: {
    user: { id: "viewer-a", email: "viewer@a.test", workspaceRole: "viewer" },
    team: { id: WS_A, role: "viewer", businessActive: true, memberIds: ["owner-a", "viewer-a"] },
  },
  klipperB: {
    user: { id: "klipper-b", email: "klipper@b.test", workspaceRole: "editor" },
    team: { id: WS_B, role: "owner", businessActive: false, memberIds: ["klipper-b"] },
  },
  ownerB: {
    user: { id: "owner-b", email: "owner@b.test", workspaceRole: "owner" },
    team: { id: WS_B, role: "owner", businessActive: true, memberIds: ["owner-b"] },
  },
  local: {
    user: { id: "local-owner", email: "local@klippharma.test", local: true, planTier: "pro" },
    team: { id: LOCAL_WORKSPACE_ID, role: "owner", businessActive: false, memberIds: ["local-owner"] },
  },
};

export function testApp(store, identity = IDENTITIES.local, extras = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { ...identity.user };
    req.team = { ...identity.team };
    next();
  });
  app.use("/api/campaigns", createCampaignRouter({
    store,
    metricsRegistry: extras.metricsRegistry || createMetricsRegistry({
      getConnection: extras.getConnection,
    }),
    getAccessibleJob: extras.getAccessibleJob || (() => ({
      id: "project-1",
      status: "ready",
      originalName: "Interview.mp4",
      clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Listen", overallScore: 91, captionText: "hello" }],
    })),
    listAccessibleJobs: () => [{
      id: "project-1",
      status: "ready",
      title: "Interview.mp4",
      originalName: "Interview.mp4",
      clips: [{ id: "clip-1" }],
    }],
    compute: extras.compute || {
      usingExternalWorkspace: false,
      configuredRoot: "/secret/ssd",
      activeRoot: "/tmp/klippharma-workspace",
      workloads: { exports: "/tmp/klippharma-workspace/exports" },
    },
    listConnectedPlatforms: extras.listConnectedPlatforms,
  }));
  return app;
}

export async function request(app, method, path, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function createWorkspaceCampaign(store, identity, body = { title: "HTTP campaign", description: "api" }) {
  const app = testApp(store, identity);
  return request(app, "POST", "/api/campaigns", body);
}

test("campaign HTTP API creates a draft and imports unapproved vault candidates", async () => {
  const app = testApp(createMemoryCampaignStore());
  const created = await request(app, "POST", "/api/campaigns", { title: "HTTP campaign", description: "api" });
  assert.equal(created.status, 201);
  assert.equal(created.data.campaign.status, "DRAFT");
  const campaignId = created.data.campaign.id;
  const imported = await request(app, "POST", `/api/campaigns/${campaignId}/vault/from-project`, { projectId: "project-1" });
  assert.equal(imported.status, 201);
  assert.equal(imported.data.clips[0].approvalStatus, "CANDIDATE");
  const listed = await request(app, "GET", "/api/campaigns");
  assert.equal(listed.data.campaigns.length, 1);
});

test("1. workspace viewer cannot approve or mutate", async () => {
  const store = createMemoryCampaignStore();
  const created = await createWorkspaceCampaign(store, IDENTITIES.owner);
  assert.equal(created.status, 201);
  const id = created.data.campaign.id;
  const viewer = testApp(store, IDENTITIES.viewer);
  const createDenied = await request(viewer, "POST", "/api/campaigns", { title: "Viewer campaign" });
  assert.equal(createDenied.status, 403);
  assert.equal((await request(viewer, "PATCH", `/api/campaigns/${id}`, { title: "Hacked" })).status, 403);
  assert.equal((await request(viewer, "POST", `/api/campaigns/${id}/status`, { status: "READY" })).status, 403);
  assert.equal((await request(viewer, "PUT", `/api/campaigns/${id}/rights`, { ...COMPLETE_RIGHTS, acknowledge: true })).status, 403);
  const imported = await request(testApp(store, IDENTITIES.owner), "POST", `/api/campaigns/${id}/vault/from-project`, { projectId: "project-1" });
  const clipId = imported.data.clips[0].id;
  assert.equal((await request(viewer, "POST", `/api/campaigns/${id}/vault/${clipId}/review`, { decision: "APPROVED" })).status, 403);
  assert.equal((await request(viewer, "GET", `/api/campaigns/${id}/financials`)).status, 403);
  assert.equal((await request(viewer, "GET", `/api/campaigns/${id}/audit`)).status, 403);
  assert.equal((await request(viewer, "GET", `/api/campaigns/${id}/flags`)).status, 403);
  const readable = await request(viewer, "GET", `/api/campaigns/${id}`);
  assert.equal(readable.status, 200);
  assert.equal(readable.data.campaign.budget, undefined);
  assert.equal(readable.data.role, "VIEWER");
});

test("owner/admin may create campaigns and editor cannot", async () => {
  const store = createMemoryCampaignStore();
  assert.equal((await createWorkspaceCampaign(store, IDENTITIES.owner)).status, 201);
  assert.equal((await createWorkspaceCampaign(store, IDENTITIES.admin, { title: "Admin campaign" })).status, 201);
  assert.equal((await createWorkspaceCampaign(store, IDENTITIES.editor, { title: "Editor campaign" })).status, 403);
});

test("2. foreign campaign clip cannot be submitted", async () => {
  const store = createMemoryCampaignStore();
  const campaignA = await seedLiveCampaign(store, { workspaceId: WS_A, userId: "owner-a", title: "Alpha live" });
  const campaignB = await seedLiveCampaign(store, { workspaceId: WS_B, userId: "owner-b", title: "Beta live" });
  const imported = await importProjectCandidates(store, {
    campaign: campaignB,
    job: { id: "p-b", clips: [{ id: "clip-b", start: 0, end: 12, title: "B", hook: "B" }] },
    actorId: "owner-b",
  });
  const foreignClip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "owner-b" });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-a", workspaceId: WS_A, input: { displayName: "Ada", username: "ada_a" },
  });
  const participant = await joinCampaign(store, { campaign: campaignA, userId: "klipper-a", profile });
  await assert.rejects(
    () => createSubmission(store, {
      campaign: campaignA, participant, profile, clip: foreignClip,
      platform: "tiktok", publicUrl: "https://www.tiktok.com/@ada/video/foreign",
      actorId: "klipper-a", resolver: publicResolver(),
    }),
    /Vault clip not found/,
  );
});

test("3. foreign campaign submission cannot be reviewed", async () => {
  const store = createMemoryCampaignStore();
  const created = await createWorkspaceCampaign(store, IDENTITIES.owner, { title: "Review isolation" });
  const id = created.data.campaign.id;
  const campaignB = await seedLiveCampaign(store, { workspaceId: WS_B, userId: "owner-b", title: "Other live" });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-b", workspaceId: WS_B, input: { displayName: "Bea", username: "bea_b" },
  });
  const participant = await joinCampaign(store, { campaign: campaignB, userId: "klipper-b", profile });
  const imported = await importProjectCandidates(store, {
    campaign: campaignB,
    job: { id: "p-b2", clips: [{ id: "clip-b2", start: 0, end: 10, title: "B2", hook: "B2" }] },
    actorId: "owner-b",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "owner-b" });
  const { submission } = await createSubmission(store, {
    campaign: campaignB, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@bea/video/77",
    actorId: "klipper-b", resolver: publicResolver(),
  });
  const ownerA = testApp(store, IDENTITIES.owner);
  const reviewed = await request(ownerA, "POST", `/api/campaigns/${id}/submissions/${submission.id}/review`, {
    decision: "VERIFIED",
    metrics: { views: 1000 },
  });
  assert.equal(reviewed.status, 404);
  assert.equal(reviewed.data.submission, undefined);
});

test("4. foreign workspace records are not exposed", async () => {
  const store = createMemoryCampaignStore();
  const created = await createWorkspaceCampaign(store, IDENTITIES.ownerB, { title: "Secret B" });
  const id = created.data.campaign.id;
  const ownerA = testApp(store, IDENTITIES.owner);
  assert.equal((await request(ownerA, "GET", `/api/campaigns/${id}`)).status, 404);
  assert.equal((await request(ownerA, "GET", `/api/campaigns/${id}/financials`)).status, 404);
  assert.equal((await request(ownerA, "GET", `/api/campaigns/${id}/flags`)).status, 404);
  assert.equal((await request(ownerA, "GET", `/api/campaigns/${id}/audit`)).status, 404);
  assert.equal((await request(ownerA, "PATCH", `/api/campaigns/${id}`, { title: "Nope" })).status, 404);
  const listed = await request(ownerA, "GET", "/api/campaigns");
  assert.equal((listed.data.campaigns || []).some((item) => item.id === id), false);
});

test("5. external Klipper can access only their own cross-workspace history", async () => {
  const store = createMemoryCampaignStore();
  const campaign = await seedLiveCampaign(store, { workspaceId: WS_A, userId: "owner-a", title: "Open live" });
  const other = await seedLiveCampaign(store, { workspaceId: WS_A, userId: "owner-a", title: "Second live" });
  const profile = await upsertKlipperProfile(store, {
    userId: "klipper-b", workspaceId: WS_B, input: { displayName: "Bea", username: "bea_cross" },
  });
  const otherProfile = await upsertKlipperProfile(store, {
    userId: "klipper-a2", workspaceId: WS_A, input: { displayName: "Cara", username: "cara_a" },
  });
  const participant = await joinCampaign(store, { campaign, userId: "klipper-b", profile });
  const otherParticipant = await joinCampaign(store, { campaign, userId: "klipper-a2", profile: otherProfile });
  const imported = await importProjectCandidates(store, {
    campaign,
    job: { id: "p-a", clips: [{ id: "clip-a", start: 0, end: 11, title: "A", hook: "A" }] },
    actorId: "owner-a",
  });
  const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "owner-a" });
  const { submission } = await createSubmission(store, {
    campaign, participant, profile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@bea/video/201",
    actorId: "klipper-b", resolver: publicResolver(),
  });
  await createSubmission(store, {
    campaign, participant: otherParticipant, profile: otherProfile, clip,
    platform: "tiktok", publicUrl: "https://www.tiktok.com/@cara/video/202",
    actorId: "klipper-a2", resolver: publicResolver(),
  });
  await reviewSubmission(store, {
    campaign, submission, clip, profile, decision: "VERIFIED",
    metrics: { views: 5000, likes: 20, comments: 2 }, evidence: { source: "manual" }, actorId: "owner-a",
  });
  await store.saveCampaign({ ...campaign, status: "COMPLETED" });

  const klipperApp = testApp(store, IDENTITIES.klipperB);
  const detail = await request(klipperApp, "GET", `/api/campaigns/${campaign.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.campaign.budget, undefined);
  assert.equal(detail.data.role, "KLIPPER");
  const vault = await request(klipperApp, "GET", `/api/campaigns/${campaign.id}/vault`);
  assert.equal(vault.status, 200);
  assert.equal(vault.data.clips.every((item) => item.approvalStatus === "APPROVED"), true);
  const mine = await request(klipperApp, "GET", `/api/campaigns/${campaign.id}/submissions`);
  assert.equal(mine.status, 200);
  assert.equal(mine.data.submissions.length, 1);
  assert.equal(mine.data.submissions[0].userId, "klipper-b");
  assert.equal((await request(klipperApp, "GET", `/api/campaigns/${campaign.id}/financials`)).status, 403);
  assert.equal((await request(klipperApp, "GET", `/api/campaigns/${campaign.id}/analytics`)).status, 403);
  const history = await request(klipperApp, "GET", "/api/campaigns/marketplace/my-campaigns");
  assert.equal(history.data.campaigns.some((item) => item.campaign.id === campaign.id), true);
  assert.equal(history.data.campaigns.some((item) => item.campaign.id === other.id), false);
  const earnings = await request(klipperApp, "GET", "/api/campaigns/marketplace/earnings");
  assert.equal(earnings.status, 200);
  assert.ok(earnings.data.earningsCalculated > 0);
  assert.equal(earnings.data.entries.every((entry) => entry.klipperId === profile.id), true);
});

test("13. connected platforms cannot be self-declared", async () => {
  const store = createMemoryCampaignStore();
  const app = testApp(store, IDENTITIES.klipperB, {
    listConnectedPlatforms: async () => ["youtube"],
  });
  const saved = await request(app, "PATCH", "/api/campaigns/klippers/me", {
    displayName: "Bea",
    username: "bea_platforms",
    connectedPlatforms: ["tiktok", "instagram"],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.profile.connectedPlatforms, ["youtube"]);
});

test("14. compute API never exposes absolute paths", async () => {
  const app = testApp(createMemoryCampaignStore());
  const result = await request(app, "GET", "/api/campaigns/compute");
  assert.equal(result.status, 200);
  assert.equal(result.data.configuredRoot, undefined);
  assert.equal(result.data.activeRoot, undefined);
  assert.equal(result.data.workloads, undefined);
  assert.equal(typeof result.data.externalWorkspaceAvailable, "boolean");
  assert.equal(typeof result.data.fallbackActive, "boolean");
  assert.ok(Array.isArray(result.data.workloadCapabilities));
  const serialized = JSON.stringify(result.data);
  assert.equal(serialized.includes("/tmp"), false);
  assert.equal(serialized.includes("/secret"), false);
});
