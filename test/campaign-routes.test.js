import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createMemoryCampaignStore } from "../lib/campaign-store.js";
import { createCampaignRouter } from "../lib/campaign-routes.js";
import { createMetricsRegistry } from "../lib/social-metrics.js";
import { LOCAL_WORKSPACE_ID } from "../lib/campaign-constants.js";

function testApp(store) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "local-owner", email: "local@klippharma.test", local: true, planTier: "pro" };
    req.team = { id: LOCAL_WORKSPACE_ID, role: "owner", businessActive: false, memberIds: ["local-owner"] };
    next();
  });
  app.use("/api/campaigns", createCampaignRouter({
    store,
    metricsRegistry: createMetricsRegistry(),
    getAccessibleJob: () => ({
      id: "project-1",
      status: "ready",
      originalName: "Interview.mp4",
      clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "Listen", overallScore: 91, captionText: "hello" }],
    }),
    listAccessibleJobs: () => [{
      id: "project-1",
      status: "ready",
      title: "Interview.mp4",
      originalName: "Interview.mp4",
      clips: [{ id: "clip-1" }],
    }],
    compute: { usingExternalWorkspace: false, activeRoot: "/tmp" },
  }));
  return app;
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
