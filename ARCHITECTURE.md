# KlipPharma Campaign Architecture

## Product loop

```
Raw media
  → AutoKlip candidate generation (existing)
  → Feature extraction
  → Historical performance context (workspace-scoped)
  → Candidate ranking (Performance Score / Historical Signal)
  → Human approval
  → Campaign Klip Vault
  → Klipper distribution
  → Submission + verification
  → Performance collection
  → Ledger (calculated, not paid automatically)
  → Learning dataset
  → Next generation
```

Language used in product copy and APIs:

- **Performance Score** — observed or historically weighted quality, not a virality prediction
- **Historical Signal** — patterns from verified posts in the same workspace/creator/campaign
- **Recommended** — ranking hint for editors
- **High-performing pattern** — descriptive cluster, not a guarantee

## Runtime topology

```
Browser (vanilla JS)
  → Express (server.js)
      → existing studio routes (unchanged)
      → /api/campaigns, /api/marketplace, /api/klippers, /api/ledger, …
          → campaign store (PostgreSQL or local JSON)
          → SocialMetricsProvider adapters
          → PayoutProvider adapters (no-op in v1)
          → FPAI adapters (events only)
  → FFmpeg + OpenAI (existing processing pipeline)
  → Cloudflare R2 (optional source objects)
  → PostgreSQL (accounts + campaign tables)
```

## Module map

| Module | Responsibility |
| --- | --- |
| `lib/campaign-constants.js` | Statuses, roles, payout models |
| `lib/campaign-store.js` | Tenant-scoped persistence |
| `lib/campaign-engine.js` | Campaign lifecycle and validation |
| `lib/campaign-vault.js` | Candidate → approved vault clips |
| `lib/campaign-network.js` | Klipper profiles, participants, marketplace |
| `lib/campaign-submissions.js` | Submission workflow |
| `lib/social-metrics.js` | Provider adapters + manual evidence |
| `lib/campaign-performance.js` | Aggregates, timelines, CPV |
| `lib/clip-features.js` | Why-it-performed feature store |
| `lib/autoklip-feedback.js` | Ranking context for future AutoKlip runs |
| `lib/campaign-ledger.js` | Budget, reservations, payout reviews |
| `lib/campaign-fraud.js` | Suspicion flags, never auto-accusation |
| `lib/campaign-rights.js` | Brand safety + audit trail |
| `lib/fpai-adapters.js` | Loose FPAI/Forge event boundaries |
| `lib/workspace-compute.js` | Configurable local/cloud media roots |
| `lib/campaign-audit.js` | Append-only audit events |
| `lib/campaign-routes.js` | HTTP API |

## Tenancy

Every campaign row is keyed by `workspace_id` plus `creator_id`.

- Local owner mode uses workspace `local-workspace` and user `local-owner`.
- Business workspaces share campaigns among members according to campaign role + workspace role.
- Klippers may join a campaign without becoming a five-seat Business member.
- Historical observations are **never** mixed across workspaces unless `KLIPPHARMA_AGGREGATED_LEARNING=true` is set by an operator who has legal authority to do so.

## Existing pipeline (unchanged)

`processProject()` still transcribes, translates, and calls `chooseClips()`. The only additive hook is optional historical-signal context injected into the AutoKlip prompt. AI clips remain unpublished until a human approves them into a Campaign Klip Vault.

## Provider boundaries

```
SocialMetricsProvider
  getProfile(connection)     → identity + optional official stats
  getPublicPost(url, auth)   → metrics if the official API allows it
  health()                   → configured | unavailable | manual-only

PayoutProvider
  createTransfer()           → throws in v1 (ledger only)
  health()                   → not_enabled
```

If an official API is missing, restricted, or would require bypassing platform protections, the adapter returns `manual_required` and reviewers attach evidence.

## Local compute

`KLIPPHARMA_WORKSPACE_ROOT` may point at an external SSD. Paths are never hard-coded to a Mac volume. When the configured root is missing, KlipPharma uses `STORAGE_ROOT` / `/app/storage`.
