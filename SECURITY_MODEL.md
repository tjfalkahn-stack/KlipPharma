# Campaign Network Security Model

## Secrets

- API secrets stay in environment variables and server-only modules.
- Frontend campaign JS never receives Stripe keys, social client secrets, R2 credentials, or OpenAI keys.
- Social access tokens remain in `social_connections` and are only used by server-side adapters.

## Tenant authorization

- Every campaign API resolves `workspace_id` from the signed-in user (or `local-workspace` in local-owner mode).
- Cross-workspace reads/writes return 404, not 403, to avoid leaking campaign existence.
- Business viewers can review campaign analytics they are granted, but cannot change budget, rights, or payouts.
- Klipper marketplace endpoints only expose fields declared public on `LIVE` campaigns.

## Role-based permissions

| Action | CAMPAIGN_OWNER | ADMIN | MANAGER | EDITOR | REVIEWER | KLIPPER |
| --- | --- | --- | --- | --- | --- | --- |
| Create/edit campaign | ✓ | ✓ | ✓ | | | |
| Change status LIVE/PAUSED | ✓ | ✓ | ✓ | | | |
| Approve vault clips | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Join/submit | | | | | | ✓ |
| Verify submissions | ✓ | ✓ | ✓ | | ✓ | |
| Approve payouts | ✓ | ✓ | | | | |
| View financials | ✓ | ✓ | ✓ | | | own earnings |

Workspace owner/admin map to campaign admin capabilities on campaigns they own. Workspace viewers cannot mutate campaigns.

## Media access

- Vault download URLs reuse existing authenticated project/export routes.
- Private source media is never placed on a public CDN URL.
- Klippers may download **approved** campaign clips only after an active participation record exists.

## URL validation / SSRF

Submitted public post URLs must:

1. Use `http` or `https`
2. Pass `assertSafePublicUrl` (no localhost, no RFC1918, no link-local)
3. Match an allowlisted host for the declared platform
4. Not be fetched by a scraper; adapters use official APIs or manual evidence

## Input validation

Zod (and matching pure validators used by tests) constrain campaign fields, money amounts, dates, enums, and JSON blobs. Oversized descriptions and rule documents are rejected.

## Rate limiting

Campaign writes, joins, and submissions are rate-limited per user+IP in addition to the existing auth limiter.

## Audit logging

Status changes, vault approvals, verification decisions, payout reviews, rights updates, and participant removals append `campaign_audit_events`.

## Financial data

Ledger and budget fields are visible only to campaign financial roles. Klippers see their own eligible/approved totals, not the full campaign P&L.

## Fraud language

Flags are labeled **Needs review**, never **Fraud confirmed**. Automated systems do not ban or accuse.
