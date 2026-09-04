import { CampaignError, clamp, money, nowIso } from "./campaign-constants.js";
import { writeAudit } from "./campaign-engine.js";

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

export function summarizeLedger(entries = [], campaign) {
  const sum = (type, status = null) => entries
    .filter((entry) => entry.entryType === type && (!status || entry.payoutStatus === status))
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const budget = sum("budget") || Number(campaign?.budget || 0);
  const reserved = sum("reservation");
  const eligible = entries
    .filter((entry) => entry.entryType === "eligible_payout" && ["CALCULATED", "PENDING_REVIEW"].includes(entry.payoutStatus))
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const approved = entries
    .filter((entry) => entry.payoutStatus === "APPROVED" || entry.entryType === "approved_payout")
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const rejected = sum("rejected_payout");
  const fees = sum("platform_fee") + sum("service_fee");
  const campaignRevenue = sum("campaign_revenue");
  const klippharmaRevenue = sum("klippharma_revenue");
  const remaining = money(budget - reserved - approved - fees);
  return {
    budget: money(budget),
    reserved: money(reserved),
    eligiblePayouts: money(eligible),
    approvedPayouts: money(approved),
    rejectedPayouts: money(rejected),
    platformServiceFees: money(fees),
    remainingBudget: money(Math.max(0, remaining)),
    campaignRevenue: money(campaignRevenue),
    klippharmaRevenue: money(klippharmaRevenue),
    currency: campaign?.currency || entries[0]?.currency || "USD",
    automaticPayouts: false,
  };
}

export async function calculateEligiblePayout(store, { campaign, submission, metrics }) {
  const amount = payoutAmount(campaign, metrics);
  if (amount <= 0) return null;
  const cap = campaign.payoutCap == null ? Infinity : Number(campaign.payoutCap);
  const ledger = await store.listLedger(campaign.workspaceId, { campaignId: campaign.id, klipperId: submission.klipperId });
  const already = ledger
    .filter((entry) => ["CALCULATED", "PENDING_REVIEW", "APPROVED", "HELD", "PAID"].includes(entry.payoutStatus || ""))
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const payable = money(Math.max(0, Math.min(amount, cap - already)));
  if (payable <= 0) return null;
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
    amount: payable,
    currency: campaign.currency,
    note: "Reserved against campaign budget pending review",
    metadata: { ledgerEntryId: entry.id },
    createdAt: nowIso(),
  });
  if (submission.klipperId) {
    const profile = await store.getProfile(submission.klipperId);
    if (profile) {
      await store.saveProfile({
        ...profile,
        earningsCalculated: money(Number(profile.earningsCalculated || 0) + payable),
      });
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
  const saved = await store.saveLedgerEntry({
    ...entry,
    payoutStatus,
    entryType: payoutStatus === "REJECTED" ? "rejected_payout" : payoutStatus === "APPROVED" ? "approved_payout" : entry.entryType,
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
