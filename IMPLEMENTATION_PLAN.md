# KlipPharma Campaign Network — Implementation Plan

This plan extends KlipPharma 0.29.x into a short-form operating loop:

**CREATE → DISTRIBUTE → MEASURE → LEARN → CREATE BETTER**

It does **not** rebuild the studio, replace AutoKlip, migrate off Railway/Cloudflare R2, or clone any third-party clipping marketplace.

## Phase 0 — Repository audit (completed)

| Area | Current state | Reuse |
| --- | --- | --- |
| Framework | Node 20+/22, Express 5, ESM, vanilla HTML/CSS/JS | Keep. Campaigns are extra modules + routes. |
| Frontend | Single-page studio in `public/index.html`, `public/app.js`, `public/styles.css` | Extend nav/views. Do not rewrite clip editor. |
| Backend | Monolithic `server.js` plus focused `lib/*` helpers | New campaign logic lives in `lib/campaign-*.js` and `lib/campaign-routes.js`. |
| Auth | Cookie sessions, scrypt passwords, `AUTH_MODE=off` local-owner fallback | Same `requireUser` / workspace membership. |
| Database | PostgreSQL `users`, `sessions`, `projects` (JSONB), workspaces, social connections, upload sessions | Additive campaign tables. JSON file fallback when DB is off. |
| Media storage | `STORAGE_ROOT` filesystem + optional Cloudflare R2 direct uploads | Campaign clips reference existing project/export paths. No new public bucket. |
| Processing | In-process queue (`maxConcurrentProjects = 2`), FFmpeg, OpenAI Whisper + chat | AutoKlip stays. Vault only copies approved clip metadata. |
| AutoKlip | `chooseClips()` ranks transcript moments with six scores | Additive historical-signal context. Human approval still required. |
| Captions / reframing / exports | Caption studio, 9:16 crop, H.264/AAC MP4 | Unchanged. Vault stores caption package + timestamps. |
| Team/workspace | Business 5-seat workspaces: owner/admin/editor/viewer | Tenant key remains `workspace_id`. Campaign roles are campaign-scoped. |
| Analytics | None beyond clip scores and feedback buttons | New performance engine + feature store. |
| Cloudflare | R2 object storage, CORS config | Unchanged. No Cloudflare Workers rewrite. |
| Env | `.env.example` | Additive campaign/compute/FPAI variables only. |
| Tests | `node --test` in `test/` | New campaign unit + integration tests. |
| Deploy | Dockerfile, Railway, compose example | Schema init on boot + SQL migration file. No auto production deploy. |

### Reusable components

- `assertSafePublicUrl` / `isPrivateIp` for submission URL SSRF protection
- Workspace membership (`getWorkspaceContext`) for tenant isolation
- Existing project clips, transcripts, caption packages, and exports
- TikTok/YouTube OAuth connections as **optional official-API adapters**, never as scrapers
- Stripe billing as a later Connect payout adapter (ledger-only in v1)
- Auth rate limiter pattern for campaign write APIs

### Migration risks

- `projects.data` JSONB is the source of truth for clips; vault copies must not mutate AutoKlip jobs.
- Local-owner mode has no PostgreSQL; campaign store must work in memory/files.
- Business viewers must not gain campaign spend or payout rights.
- Social metric adapters must not fabricate follower/view counts.
- AutoKlip ranking context must stay workspace-scoped unless aggregated learning is explicitly authorized.

## Build order (this release)

1. Documentation + schema + dual-mode store
2. Campaign CRUD, rights, audit, RBAC
3. Klip Vault + human approval
4. Klipper profiles, join/apply, marketplace
5. Submissions, provider adapters, manual verification
6. Performance, feature store, AutoKlip ranking context
7. Ledger without automatic payouts
8. Fraud flags + brand-safety declarations
9. UI, tests, runbook

## Out of scope for v1

- Automatic cash movement / Stripe Connect payouts
- Scraping TikTok/Instagram/YouTube/X
- Auto-publishing AI clips
- Replacing FFmpeg queue, R2, or Railway
- Cloning any competitor UI
- Claiming virality prediction
