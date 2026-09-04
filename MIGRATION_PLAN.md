# Migration Plan

## Principle

Additive only. No table drops, no project JSON rewrites, no R2 bucket changes, no auth cookie format changes.

## Steps

1. Deploy application code that initializes new tables on boot (`initializeCampaignNetworkSchema`, which applies every `migrations/*campaign_network*.sql` file) **and** ship:
   - `migrations/202609040001_campaign_network.sql`
   - `migrations/202609040002_campaign_network_hardening.sql`
   Operators who apply SQL separately should run both files in order. Do not rely only on boot-time schema creation as the production release record.
2. Set new optional environment variables. Defaults keep the studio working if they are omitted.
3. Existing AutoKlip jobs continue to load from `storage/projects` / `projects` JSONB.
4. Creators opt in by opening **Campaigns** and creating a DRAFT campaign. No backfill is required.
5. Optional: approve existing ready clips into a vault. This copies metadata; it does not move source files.

## Rollback

Removing the campaign routes leaves the original studio intact. New tables can remain unused. Do not drop them until audit/legal retention allows it.

## Local owner mode

`AUTH_MODE=off` without `DATABASE_URL` writes campaign JSON under `storage/campaigns/`. Production (`AUTH_MODE=required`) requires PostgreSQL, same as accounts.

## Infrastructure

Stay on Railway + Cloudflare R2. A documented reason would be required to leave that stack; this release does not have one.

## Future payouts

A later migration may add Stripe Connect account IDs to `klipper_profiles`. That work is explicitly out of v1.
