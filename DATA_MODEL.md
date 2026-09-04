# Campaign Network Data Model

Additive PostgreSQL schema. Existing `users`, `sessions`, `projects`, `workspaces`, and `upload_sessions` tables are unchanged.

## Enumerations

**Campaign status:** `DRAFT` `READY` `LIVE` `PAUSED` `COMPLETED` `ARCHIVED`

**Campaign roles:** `CAMPAIGN_OWNER` `MANAGER` `EDITOR` `KLIPPER` `REVIEWER` `ADMIN`

**Vault approval:** `CANDIDATE` `APPROVED` `REJECTED` `ARCHIVED`

**Submission verification:** `PENDING` `VERIFYING` `VERIFIED` `REJECTED` `FLAGGED`

**Payout status:** `CALCULATED` `PENDING_REVIEW` `APPROVED` `HELD` `PAID` `REJECTED`

**Payout model:** `CPM` `FLAT_PER_POST` `HYBRID` `NONE`

## Tables

### campaigns

Primary operating object. Fields match the product spec: identity, workspace, creator, budget, targets, rules, payout configuration, and `source_media_ids`.

### campaign_rights

One row per campaign: ownership declaration, usage permissions, music/audio rights, editing rules, brand guidelines, prohibited uses, expiration, takedown procedure, disclosure requirements, territory restrictions.

### campaign_participants

Membership of a campaign with a campaign-scoped role, join status (`INVITED` `APPLIED` `ACTIVE` `REJECTED` `REMOVED`), and region.

### klipper_profiles

Display name, username, categories, location/region. Social handles and follower counts are stored only with `metrics_source` + `metrics_evidence`. Missing metrics stay `null`.

### campaign_clips (Klip Vault)

Approved or candidate clips. Tracks source project/media, timestamps, duration, aspect ratio, transcript, caption package, hook, title, description, thumbnail, processing version, approval status, performance score, usage count. AI output cannot skip `CANDIDATE`.

### campaign_submissions

Public post URL, platform, clip, klipper, verification status, content status, initial/latest metrics, evidence, reviewer.

### campaign_metrics_snapshots

Time-series metrics for verified submissions. Used for velocity and anomaly detection.

### clip_features

Feature store describing *why* a clip may have performed: hook text/category, opening visual, first speaker, duration, pacing, caption style/density, topic, sentiment, music metadata (when legitimately available), face/no-face, scene-change frequency, CTA, platform, posting time, campaign, audience context.

### performance_observations

Workspace-scoped learning rows linking clip features to verified outcomes. Not mixed across tenants by default.

### campaign_ledger_entries

Budget reservations, eligible payouts, fees, campaign revenue, KlipPharma revenue. Money is never moved automatically in v1.

### fraud_flags

Suspicious activity with severity `info` `review` `hold`. Never stores an automatic fraud verdict.

### campaign_audit_events

Append-only approvals, status changes, verification decisions, payout reviews, rights acknowledgements.

## Local fallback

When `DATABASE_URL` is unset, the same documents are stored under `storage/campaigns/*.json` so `AUTH_MODE=off` keeps working.
