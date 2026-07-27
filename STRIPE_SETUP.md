# KlipPharma Stripe Launch Setup

KlipPharma uses Stripe Checkout so card details never pass through the KlipPharma server. Subscriptions renew monthly or yearly until cancelled. Cancellation is available inside the app and takes effect at the end of the paid billing period.

## 1. Create the plan catalog

Create these recurring Stripe Prices:

| Product | Interval | Launch price | Railway variable |
|---|---:|---:|---|
| KlipPharma Creator | Monthly | $29 | `STRIPE_CREATOR_MONTHLY_PRICE_ID` |
| KlipPharma Creator | Yearly | $290 | `STRIPE_CREATOR_YEARLY_PRICE_ID` |
| KlipPharma Pro | Monthly | $79 | `STRIPE_PRO_MONTHLY_PRICE_ID` |
| KlipPharma Pro | Yearly | $790 | `STRIPE_PRO_YEARLY_PRICE_ID` |
| KlipPharma Business | Monthly | $199 | `STRIPE_BUSINESS_MONTHLY_PRICE_ID` |
| KlipPharma Business | Yearly | $1,990 | `STRIPE_BUSINESS_YEARLY_PRICE_ID` |

The yearly prices give customers two months free compared with paying monthly. Business is a flat workspace subscription with five included accounts; it is not priced per seat in this release.

Create one Stripe coupon:

- Percent off: `15%`
- Duration: `Once`
- Internal name: `Creator to Pro first month`

Copy its coupon ID to `STRIPE_PRO_UPGRADE_COUPON_ID`. KlipPharma applies it only
when an active $29 Creator member upgrades to monthly Pro.

Enable the Stripe Customer Portal for payment methods and invoices. Leave
Stripe's portal cancellation option disabled because KlipPharma supplies the
online cancellation control, confirmation agreement, and end-of-period access.

## 2. Add the Railway variables

Add these to the KlipPharma service, not the Postgres service:

```text
APP_BASE_URL=https://app.klippharma.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_CREATOR_MONTHLY_PRICE_ID=price_...
STRIPE_CREATOR_YEARLY_PRICE_ID=price_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_BUSINESS_MONTHLY_PRICE_ID=price_...
STRIPE_BUSINESS_YEARLY_PRICE_ID=price_...
STRIPE_PRO_UPGRADE_COUPON_ID=...
PRO_FEATURES_OPEN=true
```

Keep `PRO_FEATURES_OPEN=true` while testing so the existing beta tools remain available. Set it to `false` only after Checkout, upgrades, webhooks, cancellations, and plan enforcement have all passed in Stripe test mode.

## 3. Add the signed webhook

In Stripe Workbench, create a webhook endpoint:

```text
https://app.klippharma.com/api/billing/webhook
```

Subscribe it to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the webhook signing secret beginning with `whsec_` and add it to Railway:

```text
STRIPE_WEBHOOK_SECRET=whsec_...
```

Railway redeploys after variables change.

## 4. Test before accepting live payments

1. Use Stripe test mode and test keys first.
2. Create a fresh KlipPharma account.
3. Buy Creator monthly and confirm the Dashboard shows `$29/month`, the renewal date, and upload history.
4. Upgrade Creator monthly to Pro monthly and confirm the 15% one-time coupon appears on the Stripe subscription.
5. Test Creator yearly and Pro yearly in separate accounts and confirm their renewal dates are one year out.
6. Upgrade a Pro account to Business and confirm its workspace shows five total seats.
7. Invite admin, editor, and viewer accounts; confirm shared projects appear and viewers cannot modify them.
8. Confirm only the workspace owner can open Stripe billing, change the plan, or cancel renewal.
9. Confirm Pro creative tools remain unavailable to Creator after `PRO_FEATURES_OPEN=false`.
10. Accept the cancellation confirmation and confirm access stays active until the displayed date.
11. Resume the subscription and verify the scheduled cancellation clears.
12. Check Stripe webhook delivery logs for HTTP 200 responses.

After the full test passes, replace test keys and Price ID with live values. Set `PRO_FEATURES_OPEN=false` only when paid-plan enforcement is ready.

## Required launch pages

Before public sales, publish and link:

- Terms of Service
- Privacy Policy
- Refund policy
- Support contact
- Clear recurring-price disclosure

Stripe configuration and subscription language should be reviewed for the countries where KlipPharma will sell.
