import { CampaignError } from "./campaign-constants.js";

/** ISO 3166-1 alpha-2, plus a small set of commonly used regional codes. */
const REGION_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
EU UK
`.trim().split(/\s+/);

export const SUPPORTED_REGIONS = Object.freeze(REGION_CODES);
export const SUPPORTED_REGION_SET = new Set(SUPPORTED_REGIONS);

export function normalizeRegion(value) {
  const region = String(value || "").trim().toUpperCase();
  if (!region) {
    throw new CampaignError("Region is required.", 400, "region_required");
  }
  if (!SUPPORTED_REGION_SET.has(region)) {
    throw new CampaignError("Unsupported region.", 400, "unsupported_region");
  }
  return region;
}

export function normalizeOptionalRegion(value) {
  if (value == null || String(value).trim() === "") return null;
  return normalizeRegion(value);
}

export function normalizeAllowedRegions(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => normalizeRegion(item)))];
}

export function assertJoinRegion(campaign, region) {
  const allowed = campaign?.allowedRegions || [];
  if (!allowed.length) return normalizeOptionalRegion(region);
  const normalized = normalizeRegion(region);
  if (!allowed.includes(normalized)) {
    throw new CampaignError("This campaign is not open in that region.", 403, "region_not_allowed");
  }
  return normalized;
}
