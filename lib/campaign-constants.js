export const CAMPAIGN_STATUSES = Object.freeze([
  "DRAFT",
  "READY",
  "LIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED",
]);

export const CAMPAIGN_STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ["READY", "ARCHIVED"],
  READY: ["DRAFT", "LIVE", "ARCHIVED"],
  LIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["LIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
});

export const CAMPAIGN_ROLES = Object.freeze([
  "CAMPAIGN_OWNER",
  "MANAGER",
  "EDITOR",
  "KLIPPER",
  "REVIEWER",
  "ADMIN",
  "VIEWER",
]);

export const PARTICIPANT_STATUSES = Object.freeze([
  "INVITED",
  "APPLIED",
  "ACTIVE",
  "REJECTED",
  "REMOVED",
]);

export const VAULT_APPROVAL_STATUSES = Object.freeze([
  "CANDIDATE",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
]);

export const VERIFICATION_STATUSES = Object.freeze([
  "PENDING",
  "VERIFYING",
  "VERIFIED",
  "REJECTED",
  "FLAGGED",
]);

export const PAYOUT_STATUSES = Object.freeze([
  "CALCULATED",
  "PENDING_REVIEW",
  "APPROVED",
  "HELD",
  "PAID",
  "REJECTED",
]);

export const PAYOUT_MODELS = Object.freeze(["CPM", "FLAT_PER_POST", "HYBRID", "NONE"]);

export const LEDGER_ENTRY_TYPES = Object.freeze([
  "budget",
  "budget_adjustment",
  "reservation",
  "eligible_payout",
  "approved_payout",
  "rejected_payout",
  "platform_fee",
  "service_fee",
  "campaign_revenue",
  "klippharma_revenue",
]);

export const RESERVATION_STATUSES = Object.freeze(["ACTIVE", "RELEASED", "CONVERTED"]);

export const VERIFICATION_TRANSITIONS = Object.freeze({
  PENDING: ["VERIFYING", "VERIFIED", "REJECTED", "FLAGGED"],
  VERIFYING: ["PENDING", "VERIFIED", "REJECTED", "FLAGGED"],
  FLAGGED: ["VERIFYING", "VERIFIED", "REJECTED", "FLAGGED"],
  VERIFIED: ["VERIFIED"],
  REJECTED: ["REJECTED"],
});

export const SUPPORTED_PLATFORMS = Object.freeze(["tiktok", "instagram", "youtube", "x"]);

export const PLATFORM_HOSTS = Object.freeze({
  tiktok: ["tiktok.com", "vm.tiktok.com"],
  instagram: ["instagram.com", "instagr.am"],
  youtube: ["youtube.com", "youtu.be", "m.youtube.com"],
  x: ["x.com", "twitter.com"],
});

export const CAMPAIGN_TYPES = Object.freeze([
  "clip_distribution",
  "creator_challenge",
  "brand_awareness",
  "launch",
  "always_on",
]);

export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_OWNER_ID = "local-owner";

export const FINANCIAL_ROLES = new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER"]);
export const APPROVER_ROLES = new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER", "EDITOR", "REVIEWER"]);
export const PAYOUT_APPROVER_ROLES = new Set(["CAMPAIGN_OWNER", "ADMIN"]);
export const MUTATOR_ROLES = new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER"]);
export const REVIEWER_ROLES = new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER", "REVIEWER"]);
export const ANALYTICS_ROLES = new Set(["CAMPAIGN_OWNER", "ADMIN", "MANAGER", "EDITOR", "REVIEWER", "VIEWER"]);
export const WORKSPACE_CAMPAIGN_CREATOR_ROLES = new Set(["owner", "admin"]);
export const KLIPPER_HISTORY_STATUSES = new Set(["LIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);

export class CampaignError extends Error {
  constructor(message, status = 400, code = "campaign_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isCampaignStatus(value) {
  return CAMPAIGN_STATUSES.includes(String(value || "").toUpperCase());
}

export function canTransitionCampaignStatus(from, to) {
  const current = String(from || "").toUpperCase();
  const next = String(to || "").toUpperCase();
  return (CAMPAIGN_STATUS_TRANSITIONS[current] || []).includes(next);
}

export function workspaceRoleToCampaignRole(workspaceRole, { isCreator = false } = {}) {
  if (isCreator) return "CAMPAIGN_OWNER";
  const role = String(workspaceRole || "").toLowerCase();
  if (role === "owner") return "ADMIN";
  if (role === "admin") return "ADMIN";
  if (role === "editor") return "EDITOR";
  if (role === "viewer") return "VIEWER";
  return null;
}

export function canCreateCampaignFromRequest(req) {
  if (!req?.user) return false;
  if (req.user.local || req.user.id === LOCAL_OWNER_ID) return true;
  if (!req.team?.businessActive) return true;
  const role = String(req.user.workspaceRole || req.team?.role || "").toLowerCase();
  return WORKSPACE_CAMPAIGN_CREATOR_ROLES.has(role);
}

export function canTransitionVerification(from, to) {
  const current = String(from || "PENDING").toUpperCase();
  const next = String(to || "").toUpperCase();
  return (VERIFICATION_TRANSITIONS[current] || []).includes(next);
}

export function nowIso(date = new Date()) {
  return new Date(date).toISOString();
}

export function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function asInteger(value, fallback = 0) {
  return Math.round(asNumber(value, fallback));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

export function money(value) {
  return Math.round(asNumber(value) * 100) / 100;
}
