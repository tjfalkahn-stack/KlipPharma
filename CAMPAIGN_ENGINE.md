# Campaign Engine

## Lifecycle

```
DRAFT → READY → LIVE ⇄ PAUSED → COMPLETED → ARCHIVED
```

- `DRAFT` — editable; not visible in the marketplace
- `READY` — required rights declared; vault may receive candidates
- `LIVE` — eligible Klippers can discover/join and submit
- `PAUSED` — hidden from new joins; existing submissions still reviewable
- `COMPLETED` — no new submissions; ledger remains visible
- `ARCHIVED` — retained for audit, hidden from command center defaults

Invalid transitions are rejected. Going `LIVE` requires title, dates, at least one target platform, rights acknowledgement, and payout model.

## Campaign command center

Workspace-scoped totals:

- Active campaigns
- Total verified views
- Active Klippers
- Klips distributed
- Campaign spend (approved ledger, not automatic cash)
- Cost / 1K verified views
- Top Klip / Top Klipper / Trending hook (historical signal)

## Klip Vault

Flow: upload/select source → existing AutoKlip → review candidates → human approve → vault.

A vault clip stores source identity, timestamps, duration, aspect ratio, transcript, caption package, hook/title/description, thumbnail, processing version, approval status, performance score, and usage count.

AI-generated clips enter as `CANDIDATE`. They are not marketplace-available and are not auto-published.

## Marketplace (Klipper)

1. Discover eligible `LIVE` campaigns
2. Read requirements + rights
3. Join or apply
4. Access approved vault media
5. Download/use an approved clip or create a permitted original edit
6. Post externally (outside KlipPharma)
7. Submit the public URL
8. Wait for verification
9. See verified performance
10. See calculated eligible compensation (not an automatic payout)

## Verification

Statuses: `PENDING` `VERIFYING` `VERIFIED` `REJECTED` `FLAGGED`

Providers implement `SocialMetricsProvider`. v1 ships:

- `ManualEvidenceProvider` (always available)
- `TikTokOfficialAdapter` (uses existing Login Kit connection when scopes allow; otherwise manual)
- `YouTubeOfficialAdapter` (uses existing Data API connection when scopes allow; otherwise manual)
- `InstagramAdapter` / `XAdapter` (manual-only stubs until official credentials exist)

## Ledger (v1)

No money moves. `PayoutProvider.createTransfer()` is disabled.

Calculated compensation uses campaign `payout_model` + verified metrics, then sits in `CALCULATED` / `PENDING_REVIEW` until a human marks `APPROVED`, `HELD`, or `REJECTED`. `PAID` is reserved for a future Stripe Connect (or other compliant) adapter.
