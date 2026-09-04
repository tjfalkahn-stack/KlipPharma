import { CampaignError, clamp, money, nowIso } from "./campaign-constants.js";
import { writeAudit } from "./campaign-audit.js";

export class PayoutProvider {
  constructor(name = "none") {
    this.name = name;
  }
  health() {
    return { provider: this.name, status: "not_enabled", automaticPayouts: false };
  }
  async createTransfer() {
    throw new CampaignError("Automatic payouts are disabled in v1. Review the ledger instead.", 501, "payouts_disabled");
  }
}

export function payoutAmount(campaign, metrics = {}) {
  const views = Math.max(0, Number(metrics.views) || 0);
  const posts = 1;
  const rate = Number(campaign.payoutRate) || 0;
  if (campaign.payoutModel === "NONE" || rate <= 0) return 0;
  if (campaign.payoutModel === "FLAT_PER_POST") return money(rate * posts);
  if (campaign.payoutModel === "CPM") return money((views / 1000) * rate);
  if (campaign.payoutModel === "HYBRID") return money(rate + (views / 1000) * (Number(campaign.hybridCpmRate || campaign.campaignRules?.hybridCpmRate) || 0));
  return 0;
}

function isActiveReservation(entry) {
  return entry.entryType === "reservation" && (entry.reservationStatus || "ACTIVE") === "ACTIVE";
}

function isApprovedPayout(entry) {
  return entry.entryType === "approved_payout" && entry.payoutStatus === "APPROVED";
}

function isPaidPayout(entry) {
  return entry.payoutStatus === "PAID";
}

export function summarizeLedger(entries = [], campaign) {
  const sum = (predicate) => entries
    .filter(predicate)
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const budgetEntries = sum((entry) => entry.entryType === "budget");
  const adjustments = entries
    .filter((entry) => entry.entryType === "budget_adjustment")
    .reduce((total, entry) => total + Number(entry.metadata?.delta || 0), 0);
  const budget = budgetEntries
    ? money(budgetEntries + adjustments)
    : money(Number(campaign?.budget || 0));
  const reserved = sum(isActiveReservation);
  const eligible = sum((entry) => (
    entry.entryType === "eligible_payout" && ["CALCULATED", "PENDING_REVIEW", "HELD"].includes(entry.payoutStatus)
  ));
  const approved = sum(isApprovedPayout);
  const paid = sum(isPaidPayout);
  const rejected = sum((entry) => entry.entryType === "rejected_payout" || entry.payoutStatus === "REJECTED");
  const fees = sum((entry) => entry.entryType === "platform_fee" || entry.entryType === "service_fee");
  const campaignRevenue = sum((entry) => entry.entryType === "campaign_revenue");
  const klippharmaRevenue = sum((entry) => entry.entryType === "klippharma_revenue");
  const committed = money(reserved + approved + paid + fees);
  const remaining = money(budget - committed);
  return {
    budget: money(budget),
    reserved: money(reserved),
    eligiblePayouts: money(eligible),
    approvedPayouts: money(approved),
    paidPayouts: money(paid),
    rejectedPayouts: money(rejected),
    platformServiceFees: money(fees),
    committedSpend: committed,
    remainingBudget: money(Math.max(0, remaining)),
    remainingBudgetRaw: remaining,
    campaignRevenue: money(campaignRevenue),
    klippharmaRevenue: money(klippharmaRevenue),
    currency: campaign?.currency || entries[0]?.currency || "USD",
    automaticPayouts: false,
  };
}

export function publicKlipperLedgerEntries(entries = []) {
  return entries.filter((entry) => (
    entry.klipperId
    && ["eligible_payout", "approved_payout", "rejected_payout"].includes(entry.entryType)
  ));
}

async function reservationForSubmission(store, campaign, submissionId) {
  const ledger = await store.listLedger(campaign.workspaceId, { campaignId: campaign.id });
  return ledger.find((entry) => (
    entry.entryType === "reservation"
    && entry.submissionId === submissionId
    && (entry.reservationStatus || "ACTIVE") === "ACTIVE"
  )) || null;
}

export async function calculateEligiblePayout(store, { campaign, submission, metrics }) {
  const existing = store.getEligiblePayoutForSubmission
    ? await store.getEligiblePayoutForSubmission(campaign.workspaceId, submission.id)
    : (await store.listLedger(campaign.workspaceId, { campaignId: campaign.id }))
      .find((entry) => entry.submissionId === submission.id && entry.entryType === "eligible_payout");
  if (existing) return existing;

  const amount = payoutAmount(campaign, metrics);
  if (amount <= 0) return null;
  const cap = campaign.payoutCap == null ? Infinity : Number(campaign.payoutCap);
  const ledger = await store.listLedger(campaign.workspaceId, { campaignId: campaign.id });
  const summary = summarizeLedger(ledger, campaign);
  const klipperLedger = ledger.filter((entry) => entry.klipperId === submission.klipperId);
  const alreadyTowardCap = klipperLedger
    .filter((entry) => (
      ["eligible_payout", "approved_payout"].includes(entry.entryType)
      && ["CALCULATED", "PENDING_REVIEW", "APPROVED", "HELD", "PAID"].includes(entry.payoutStatus || "")
    ))
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const capped = money(Math.max(0, Math.min(amount, cap - alreadyTowardCap)));
  if (capped <= 0) return null;
  if (capped > summary.remainingBudgetRaw + 1e-9) {
    throw new CampaignError("Payout exceeds remaining campaign budget.", 409, "budget_exceeded");
  }
  const payable = capped;
  const entry = await store.saveLedgerEntry({
    id: store.createId(),
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    klipperId: submission.klipperId,
    submissionId: submission.id,
    entryType: "eligible_payout",
    payoutStatus: "CALCULATED",
    amount: payable,
    currency: campaign.currency,
    note: "Eligible compensation from verified views. Not paid automatically.",
    metadata: { views: metrics.views, payoutModel: campaign.payoutModel },
    createdAt: nowIso(),
  });
  await store.saveLedgerEntry({
    id: store.createId(),
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    klipperId: submission.klipperId,
    submissionId: submission.id,
    entryType: "reservation",
    reservationStatus: "ACTIVE",
    payoutStatus: null,
    amount: payable,
    currency: campaign.currency,
    note: "Reserved against campaign budget pending review",
    metadata: { ledgerEntryId: entry.id },
    createdAt: nowIso(),
  });
  if (submission.klipperId) {
    if (store.incrementProfileStats) {
      await store.incrementProfileStats(submission.klipperId, { earningsCalculated: payable });
    } else {
      const profile = await store.getProfile(submission.klipperId);
      if (profile) {
        await store.saveProfile({
          ...profile,
          earningsCalculated: money(Number(profile.earningsCalculated || 0) + payable),
        });
      }
    }
  }
  return entry;
}

export async function reviewPayout(store, { entry, campaign, decision, actorId, note = "" }) {
  const payoutStatus = String(decision || "").toUpperCase();
  if (!["PENDING_REVIEW", "APPROVED", "HELD", "REJECTED"].includes(payoutStatus)) {
    throw new CampaignError("Payout review must be PENDING_REVIEW, APPROVED, HELD, or REJECTED.");
  }
  if (payoutStatus === "APPROVED" && entry.payoutStatus === "PAID") {
    throw new CampaignError("That payout is already marked paid.");
  }
  const reservation = await reservationForSubmission(store, campaign, entry.submissionId);
  let reservationStatus = reservation?.reservationStatus || null;
  if (payoutStatus === "APPROVED") {
    reservationStatus = "CONVERTED";
  } else if (payoutStatus === "REJECTED") {
    reservationStatus = "RELEASED";
  } else if (payoutStatus === "HELD" || payoutStatus === "PENDING_REVIEW") {
    reservationStatus = reservation ? "ACTIVE" : null;
  }
  if (reservation && reservationStatus) {
    await store.saveLedgerEntry({
      ...reservation,
      reservationStatus,
      metadata: { ...(reservation.metadata || {}), convertedTo: payoutStatus },
    });
  }
  const saved = await store.saveLedgerEntry({
    ...entry,
    payoutStatus,
    entryType: payoutStatus === "REJECTED"
      ? "rejected_payout"
      : payoutStatus === "APPROVED"
        ? "approved_payout"
        : entry.entryType,
    reservationStatus: null,
    reviewedBy: actorId,
    reviewedAt: nowIso(),
    note: note || entry.note,
  });
  await writeAudit(store, {
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    actorId,
    action: `ledger.${payoutStatus.toLowerCase()}`,
    entityType: "ledger",
    entityId: entry.id,
  });
  return saved;
}

export function costPerThousandViews(spend, views) {
  if (!views) return null;
  return money((Number(spend) / Number(views)) * 1000);
}

export function costPerEngagement(spend, engagements) {
  if (!engagements) return null;
  return money(Number(spend) / Number(engagements));
}

export { clamp };
