# Campaign Network runbook

Do **not** deploy production automatically from this change. Apply the schema, set environment variables, then roll out the container as usual.

## Schema

On boot, `initializeDatabase()` creates campaign tables if PostgreSQL is configured.

Operators who apply SQL separately can run:

```bash
psql "$DATABASE_URL" -f migrations/202609040001_campaign_network.sql
psql "$DATABASE_URL" -f migrations/202609040002_campaign_network_hardening.sql
```

Boot-time `initializeCampaignNetworkSchema()` applies both files. Do not treat boot-only schema creation as the production release record.

Existing `users`, `projects`, `workspaces`, and `upload_sessions` tables are unchanged.

## Environment variables (additive)

| Variable | Required | Purpose |
| --- | --- | --- |
| `KLIPPHARMA_WORKSPACE_ROOT` | no | External SSD / local compute root. Never hard-code `/Volumes/...` |
| `KLIPPHARMA_AGGREGATED_LEARNING` | no | Default `false`. Keep AutoKlip history workspace/creator scoped |
| Existing `DATABASE_URL`, `AUTH_MODE`, `STORAGE_ROOT`, R2, Stripe, OpenAI, TikTok, YouTube | unchanged | Studio + optional official adapters |

## Local compute fallback

If `KLIPPHARMA_WORKSPACE_ROOT` is missing or unreadable, KlipPharma uses `STORAGE_ROOT` (container default `/app/storage`). Heavy workloads can later write under named subfolders: source-footage, proxies, transcripts, temporary-frames, ffmpeg-processing, render-cache, exports, model-cache.

## Campaign store

- `AUTH_MODE=off` without Postgres: `storage/campaigns/campaign-network.json`
- Production accounts: PostgreSQL campaign tables

## Provider integrations still unfinished

- Instagram official adapter
- X official adapter
- TikTok / YouTube **metric** lookups beyond connected-account presence (no scraping)
- Stripe Connect / any automatic payout provider (`PayoutProvider.createTransfer` throws)

Manual verification remains the supported v1 path.

## Health

`GET /api/health` includes `campaigns: true` and workspace-compute fallback information.
