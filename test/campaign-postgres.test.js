import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresCampaignStore } from "../lib/campaign-postgres.js";
import { campaignNetworkSchemaSql } from "../lib/campaign-schema.js";
import { createCampaign } from "../lib/campaign-engine.js";
import { saveCampaignRights, rightsComplete } from "../lib/campaign-rights.js";
import { importProjectCandidates, reviewVaultClip } from "../lib/campaign-vault.js";
import { joinCampaign, upsertKlipperProfile } from "../lib/campaign-network.js";
import { createSubmission, reviewSubmission } from "../lib/campaign-submissions.js";
import { reviewPayout, summarizeLedger } from "../lib/campaign-ledger.js";
import { COMPLETE_RIGHTS, publicResolver, seedLiveCampaign } from "./campaign-helpers.js";

const databaseUrl = String(process.env.CAMPAIGN_TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();

function skipPostgres() {
  if (databaseUrl) return false;
  test("15. PostgreSQL store passes the same behavior tests as memory mode", { skip: "DATABASE_URL not configured" }, () => {});
  return true;
}

async function withPostgresStore(fn) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === "disable" ? false : undefined,
  });
  const schema = `s_${cryptoRandom()}`;
  const connect = async () => {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${schema}`);
    return client;
  };
  try {
    const setup = await pool.connect();
    try {
      await setup.query(`CREATE SCHEMA ${schema}`);
      await setup.query(`SET search_path TO ${schema}`);
      await setup.query(campaignNetworkSchemaSql());
    } finally {
      setup.release();
    }
    const store = createPostgresCampaignStore(async (text, params) => {
      const client = await connect();
      try {
        return await client.query(text, params);
      } finally {
        client.release();
      }
    }, { connect });
    await fn(store, {
      query: async (text, params) => {
        const client = await connect();
        try {
          return await client.query(text, params);
        } finally {
          client.release();
        }
      },
    });
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
}

function cryptoRandom() {
  return Math.random().toString(16).slice(2, 10);
}

if (!skipPostgres()) {
  test("15. PostgreSQL store passes the same behavior tests as memory mode", async () => {
    await withPostgresStore(async (store) => {
      const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const campaign = await seedLiveCampaign(store, {
        workspaceId,
        userId: "creator-pg",
        budget: 500,
        title: "Postgres live",
      });
      const profile = await upsertKlipperProfile(store, {
        userId: "klipper-pg",
        workspaceId,
        input: { displayName: "Ada", username: `ada_${cryptoRandom()}` },
      });
      const participant = await joinCampaign(store, { campaign, userId: "klipper-pg", profile });
      const imported = await importProjectCandidates(store, {
        campaign,
        job: { id: "p-pg", clips: [{ id: "clip-1", start: 0, end: 20, title: "Hook", hook: "PG" }] },
        actorId: "creator-pg",
      });
      const clip = await reviewVaultClip(store, { clip: imported[0], decision: "APPROVED", actorId: "creator-pg" });
      const { submission } = await createSubmission(store, {
        campaign, participant, profile, clip,
        platform: "tiktok",
        publicUrl: `https://www.tiktok.com/@ada/video/${cryptoRandom()}`,
        actorId: "klipper-pg",
        resolver: publicResolver(),
      });
      const verified = await reviewSubmission(store, {
        campaign, submission, clip, profile, decision: "VERIFIED",
        metrics: { views: 20000, likes: 40, comments: 4 },
        evidence: { source: "manual" }, actorId: "reviewer-pg",
      });
      assert.equal(verified.verificationStatus, "VERIFIED");
      await reviewSubmission(store, {
        campaign, submission: verified, clip, profile, decision: "VERIFIED",
        metrics: { views: 20000, likes: 40, comments: 4 },
        evidence: { source: "manual" }, actorId: "reviewer-pg",
      });
      const ledger = await store.listLedger(workspaceId, { campaignId: campaign.id });
      assert.equal(ledger.filter((entry) => entry.entryType === "eligible_payout").length, 1);
      const eligible = ledger.find((entry) => entry.entryType === "eligible_payout");
      await reviewPayout(store, { entry: eligible, campaign, decision: "APPROVED", actorId: "creator-pg" });
      const summary = summarizeLedger(await store.listLedger(workspaceId, { campaignId: campaign.id }), campaign);
      assert.equal(summary.reserved, 0);
      assert.ok(summary.approvedPayouts > 0);

      const draft = await createCampaign(store, {
        workspaceId,
        userId: "creator-pg",
        input: { title: "Rights pg" },
      });
      const rights = await saveCampaignRights(store, {
        campaign: draft, actorId: "creator-pg", acknowledge: true, input: COMPLETE_RIGHTS,
      });
      assert.equal(rightsComplete(rights), true);
      const edited = await saveCampaignRights(store, {
        campaign: draft, actorId: "creator-pg",
        input: { ...COMPLETE_RIGHTS, brandGuidelines: "Changed for postgres" },
      });
      assert.equal(rightsComplete(edited), false);
    });
  });

  test("PostgreSQL migration SQL applies uniquely scoped canonical URLs", async () => {
    await withPostgresStore(async (store, db) => {
      const sql = campaignNetworkSchemaSql();
      assert.match(sql, /campaign_submissions_workspace_url_idx/);
      assert.match(sql, /campaign_clips_source_uidx/);
      assert.match(sql, /clip_features_clip_uidx/);
      assert.match(sql, /performance_observations_submission_version_uidx/);
      assert.match(sql, /campaign_ledger_eligible_submission_uidx/);
      const indexes = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname IN (
          'campaign_submissions_workspace_url_idx',
          'campaign_clips_source_uidx',
          'clip_features_clip_uidx',
          'performance_observations_submission_version_uidx',
          'campaign_ledger_eligible_submission_uidx',
          'campaign_ledger_active_reservation_uidx'
        )
      `);
      assert.equal(indexes.rowCount, 6);
    });
  });
}
