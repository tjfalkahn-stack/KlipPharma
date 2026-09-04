const $ = (selector, root = document) => root.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value, currency = "USD") {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function compact(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(Math.round(number));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Campaign request failed.");
  return data;
}

export function initCampaignNetwork({ setView, toast, openTeam, getCurrentProjects }) {
  const opsView = $("#opsView");
  const panels = $("#opsPanels");
  const kicker = $("#opsKicker");
  const title = $("#opsTitle");
  const intro = $("#opsIntro");
  const actions = $("#opsHeadActions");
  const nav = $("#studioNav");
  if (!opsView || !panels || !nav) return { openVaultPicker() {} };

  let screen = "command";
  let selectedCampaignId = null;

  function header(nextKicker, nextTitle, nextIntro, buttons = []) {
    kicker.textContent = nextKicker;
    title.textContent = nextTitle;
    intro.textContent = nextIntro;
    actions.innerHTML = buttons.map((button) => (
      `<button type="button" class="${button.className || "secondary"}" data-ops-action="${button.action}">${escapeHtml(button.label)}</button>`
    )).join("");
  }

  function showOps() {
    setView("ops");
    nav.querySelectorAll("[data-studio-nav]").forEach((button) => {
      button.classList.toggle("active", ["vault", "campaigns", "distribute", "analytics", "earnings"].includes(button.dataset.studioNav)
        && (
          (screen.startsWith("campaign") && button.dataset.studioNav === "campaigns")
          || (screen === "marketplace" && button.dataset.studioNav === "distribute")
          || (screen === "analytics" && button.dataset.studioNav === "analytics")
          || (screen === "earnings" && button.dataset.studioNav === "earnings")
          || (screen === "vault" && button.dataset.studioNav === "vault")
          || (screen === "command" && button.dataset.studioNav === "campaigns")
        ));
    });
  }

  async function paint() {
    showOps();
    panels.innerHTML = `<div class="dashboard-empty">Loading…</div>`;
    try {
      if (screen === "command") return paintCommand();
      if (screen === "campaigns") return paintCampaigns();
      if (screen === "create") return paintEditor();
      if (screen === "edit") return paintEditor(selectedCampaignId);
      if (screen.startsWith("detail")) return paintDetail(selectedCampaignId, screen.split(":")[1] || "overview");
      if (screen === "marketplace") return paintMarketplace();
      if (screen === "analytics") return paintWorkspaceAnalytics();
      if (screen === "earnings") return paintEarnings();
      if (screen === "vault") return paintWorkspaceVault();
    } catch (error) {
      panels.innerHTML = `<div class="billing-error">${escapeHtml(error.message)}</div>`;
    }
  }

  async function paintCommand() {
    header("CREATE → DISTRIBUTE → MEASURE → LEARN", "Campaign command center", "Active distribution, verified views, and historically successful patterns — not virality predictions.", [
      { label: "New campaign", action: "create", className: "primary" },
      { label: "All campaigns", action: "campaigns", className: "secondary" },
    ]);
    const data = await api("/api/campaigns/command-center");
    panels.innerHTML = `
      <div class="ops-metrics">
        ${metric("Active campaigns", data.activeCampaigns)}
        ${metric("Total verified views", compact(data.totalVerifiedViews))}
        ${metric("Active Klippers", data.activeKlippers)}
        ${metric("Klips distributed", data.klipsDistributed)}
        ${metric("Campaign spend", money(data.campaignSpend))}
        ${metric("Cost / 1K views", data.costPer1kViews == null ? "—" : money(data.costPer1kViews))}
        ${metric("Top Klip", data.topKlip?.title || "—")}
        ${metric("Top Klipper", data.topKlipper?.userId ? compact(data.topKlipper.views) + " views" : "—")}
        ${metric("Trending hook", data.trendingHook?.key || "—")}
      </div>
      <div class="ops-card-list">
        ${(data.campaigns || []).map((item) => `
          <article class="ops-card" data-open-campaign="${item.id}">
            <span class="ops-status">${escapeHtml(item.status)}</span>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${compact(item.verifiedViews)} verified views · ${money(item.spend)} approved spend</p>
          </article>
        `).join("") || `<div class="dashboard-empty">No live campaigns yet. Create a draft, approve klips, then go live.</div>`}
      </div>
    `;
  }

  async function paintCampaigns() {
    header("CAMPAIGNS", "Campaign dashboard", "Draft, ready, live, paused, completed, and archived campaigns in this workspace.", [
      { label: "New campaign", action: "create", className: "primary" },
    ]);
    const data = await api("/api/campaigns");
    panels.innerHTML = `
      <div class="ops-table">
        ${(data.campaigns || []).map((item) => `
          <article class="ops-row" data-open-campaign="${item.id}">
            <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.campaignType)} · ${escapeHtml((item.targetPlatforms || []).join(", ") || "no platforms")}</small></div>
            <span class="ops-status">${escapeHtml(item.status)}</span>
            <span>${money(item.budget, item.currency)}</span>
          </article>
        `).join("") || `<div class="dashboard-empty">No campaigns in this workspace yet.</div>`}
      </div>
    `;
  }

  async function paintEditor(campaignId = null) {
    const existing = campaignId ? await api(`/api/campaigns/${campaignId}`) : null;
    const campaign = existing?.campaign || {};
    header(campaignId ? "EDIT CAMPAIGN" : "CREATE CAMPAIGN", campaign.title || "New campaign", "AI clips stay in draft vault until a human approves them. Payouts are ledger-only in this release.", [
      { label: "Cancel", action: "campaigns", className: "secondary" },
    ]);
    panels.innerHTML = `
      <form class="ops-form" id="campaignForm">
        <label><span>TITLE</span><input name="title" required minlength="3" maxlength="120" value="${escapeHtml(campaign.title || "")}" /></label>
        <label><span>DESCRIPTION</span><textarea name="description" rows="4">${escapeHtml(campaign.description || "")}</textarea></label>
        <div class="ops-form-grid">
          <label><span>TYPE</span><select name="campaignType">${options(["clip_distribution", "creator_challenge", "brand_awareness", "launch", "always_on"], campaign.campaignType)}</select></label>
          <label><span>PAYOUT MODEL</span><select name="payoutModel">${options(["NONE", "CPM", "FLAT_PER_POST", "HYBRID"], campaign.payoutModel)}</select></label>
          <label><span>BUDGET</span><input name="budget" type="number" min="0" step="0.01" value="${escapeHtml(campaign.budget ?? 0)}" /></label>
          <label><span>CURRENCY</span><input name="currency" value="${escapeHtml(campaign.currency || "USD")}" maxlength="8" /></label>
          <label><span>PAYOUT RATE</span><input name="payoutRate" type="number" min="0" step="0.0001" value="${escapeHtml(campaign.payoutRate ?? 0)}" /></label>
          <label><span>PAYOUT CAP</span><input name="payoutCap" type="number" min="0" step="0.01" value="${escapeHtml(campaign.payoutCap ?? "")}" /></label>
          <label><span>START</span><input name="startDate" type="datetime-local" value="${toLocal(campaign.startDate)}" /></label>
          <label><span>END</span><input name="endDate" type="datetime-local" value="${toLocal(campaign.endDate)}" /></label>
          <label><span>TARGET VIEWS</span><input name="targetViews" type="number" min="0" value="${escapeHtml(campaign.targetViews ?? 0)}" /></label>
          <label><span>TARGET POSTS</span><input name="targetPosts" type="number" min="0" value="${escapeHtml(campaign.targetPosts ?? 0)}" /></label>
        </div>
        <label><span>TARGET PLATFORMS</span><input name="targetPlatforms" placeholder="tiktok, instagram, youtube, x" value="${escapeHtml((campaign.targetPlatforms || []).join(", "))}" /></label>
        <label><span>ALLOWED REGIONS</span><input name="allowedRegions" placeholder="US, CA, GB" value="${escapeHtml((campaign.allowedRegions || []).join(", "))}" /></label>
        <label><span>CONTENT REQUIREMENTS</span><textarea name="contentRequirements" rows="3">${escapeHtml(asText(campaign.contentRequirements))}</textarea></label>
        <label><span>PROHIBITED CONTENT</span><textarea name="prohibitedContent" rows="3">${escapeHtml(asText(campaign.prohibitedContent))}</textarea></label>
        <label class="ops-check"><input name="approvalRequired" type="checkbox" ${campaign.approvalRequired !== false ? "checked" : ""} /><span>Klippers must be approved before accessing the vault</span></label>
        <button class="primary" type="submit">${campaignId ? "Save campaign" : "Create draft"}</button>
      </form>
    `;
    $("#campaignForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = readCampaignForm(form);
      const saved = campaignId
        ? await api(`/api/campaigns/${campaignId}`, { method: "PATCH", body: payload })
        : await api("/api/campaigns", { method: "POST", body: payload });
      selectedCampaignId = saved.campaign.id;
      screen = "detail:overview";
      toast(campaignId ? "Campaign saved." : "Draft campaign created.");
      paint();
    });
  }

  async function paintDetail(campaignId, tab = "overview") {
    const [detail, analytics, content, participants, submissions, financials, flags] = await Promise.all([
      api(`/api/campaigns/${campaignId}`),
      api(`/api/campaigns/${campaignId}/analytics`).catch(() => null),
      api(`/api/campaigns/${campaignId}/content`).catch(() => ({ clips: [], readyProjects: [] })),
      api(`/api/campaigns/${campaignId}/participants`).catch(() => ({ participants: [] })),
      api(`/api/campaigns/${campaignId}/submissions`).catch(() => ({ submissions: [] })),
      api(`/api/campaigns/${campaignId}/financials`).catch(() => null),
      api(`/api/campaigns/${campaignId}/flags`).catch(() => ({ flags: [] })),
    ]);
    const campaign = detail.campaign;
    header(campaign.status, campaign.title, campaign.description || "Campaign detail", [
      { label: "Edit", action: "edit", className: "secondary" },
      ...statusButtons(campaign.status),
    ]);
    const tabs = ["overview", "analytics", "content", "participants", "submissions", "financials", "rights"];
    const body = {
      overview: detailOverview(campaign, analytics, detail.rights),
      analytics: detailAnalytics(analytics),
      content: detailContent(content, campaign.id),
      participants: detailParticipants(participants.participants || []),
      submissions: detailSubmissions(submissions.submissions || [], flags.flags || []),
      financials: detailFinancials(financials),
      rights: detailRights(detail.rights),
    }[tab];
    panels.innerHTML = `
      <div class="ops-tabs">
        ${tabs.map((name) => `<button type="button" class="${name === tab ? "active" : ""}" data-campaign-tab="${name}">${name}</button>`).join("")}
      </div>
      <div class="ops-tab-body">${body}</div>
    `;
    bindDetail(campaign);
  }

  function bindDetail(campaign) {
    panels.querySelectorAll("[data-campaign-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        screen = `detail:${button.dataset.campaignTab}`;
        paint();
      });
    });
    $("#importVaultForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const projectId = event.currentTarget.projectId.value;
      await api(`/api/campaigns/${campaign.id}/vault/from-project`, { method: "POST", body: { projectId } });
      toast("Candidates imported. They stay unapproved until a human reviews them.");
      screen = "detail:content";
      paint();
    });
    panels.querySelectorAll("[data-vault-decision]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api(`/api/campaigns/${campaign.id}/vault/${button.dataset.clipId}/review`, {
          method: "POST",
          body: { decision: button.dataset.vaultDecision },
        });
        toast("Vault review saved. Approved clips can be distributed; candidates cannot.");
        paint();
      });
    });
    panels.querySelectorAll("[data-participant-decision]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api(`/api/campaigns/${campaign.id}/participants/${button.dataset.participantId}/review`, {
          method: "POST",
          body: { decision: button.dataset.participantDecision },
        });
        toast("Participant updated.");
        paint();
      });
    });
    $("#submissionReviewForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await api(`/api/campaigns/${campaign.id}/submissions/${form.submissionId.value}/review`, {
        method: "POST",
        body: {
          decision: form.decision.value,
          metrics: {
            views: Number(form.views.value || 0),
            likes: Number(form.likes.value || 0),
            comments: Number(form.comments.value || 0),
            shares: Number(form.shares.value || 0),
            source: "manual",
          },
          evidence: { note: form.evidence.value, source: "manual" },
          rejectionReason: form.rejectionReason.value,
        },
      });
      toast("Verification recorded. Eligible compensation is calculated, not paid automatically.");
      paint();
    });
    $("#rightsForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await api(`/api/campaigns/${campaign.id}/rights`, {
        method: "PUT",
        body: Object.fromEntries(new FormData(form).entries()),
      });
      toast("Rights and brand-safety terms saved.");
      paint();
    });
    panels.querySelectorAll("[data-ledger-decision]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api(`/api/campaigns/${campaign.id}/ledger/${button.dataset.entryId}/review`, {
          method: "POST",
          body: { decision: button.dataset.ledgerDecision },
        });
        toast("Ledger review saved. No cash was moved.");
        paint();
      });
    });
  }

  async function paintMarketplace() {
    header("DISTRIBUTE", "Campaign marketplace", "Discover live campaigns, join, use approved klips, and submit public post URLs for verification.", [
      { label: "My campaigns", action: "mine", className: "secondary" },
    ]);
    const [discover, mine, profile] = await Promise.all([
      api("/api/campaigns/marketplace/campaigns"),
      api("/api/campaigns/marketplace/my-campaigns"),
      api("/api/campaigns/klippers/me"),
    ]);
    panels.innerHTML = `
      <section class="ops-card">
        <h3>Klipper profile</h3>
        <p>${profile.profile ? `${escapeHtml(profile.profile.displayName)} · @${escapeHtml(profile.profile.username)}` : "Create a profile to join campaigns. Follower counts are stored only with evidence."}</p>
        <form class="ops-form" id="klipperForm">
          <label><span>DISPLAY NAME</span><input name="displayName" value="${escapeHtml(profile.profile?.displayName || "")}" required /></label>
          <label><span>USERNAME</span><input name="username" value="${escapeHtml(profile.profile?.username || "")}" required /></label>
          <label><span>REGION</span><input name="locationRegion" value="${escapeHtml(profile.profile?.locationRegion || "")}" /></label>
          <button class="secondary" type="submit">Save profile</button>
        </form>
      </section>
      <h3>Discover</h3>
      <div class="ops-card-list">
        ${(discover.campaigns || []).map((item) => `
          <article class="ops-card">
            <span class="ops-status">${escapeHtml(item.status)}</span>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description || "No description")}</p>
            <p>Platforms: ${escapeHtml((item.targetPlatforms || []).join(", ") || "—")}</p>
            <button type="button" class="primary" data-join-campaign="${item.id}">Join / apply</button>
          </article>
        `).join("") || `<div class="dashboard-empty">No live campaigns are open to Klippers right now.</div>`}
      </div>
      <h3>My campaigns</h3>
      <div class="ops-card-list">
        ${(mine.campaigns || []).map((item) => `
          <article class="ops-card" data-open-campaign="${item.campaign.id}">
            <span class="ops-status">${escapeHtml(item.participant.status)}</span>
            <h3>${escapeHtml(item.campaign.title)}</h3>
            <p>Role ${escapeHtml(item.participant.role)}</p>
          </article>
        `).join("") || `<div class="dashboard-empty">You have not joined a campaign yet.</div>`}
      </div>
      ${await marketplaceSubmitters(mine.campaigns || [])}
    `;
    $("#klipperForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await api("/api/campaigns/klippers/me", {
        method: "PATCH",
        body: {
          displayName: form.displayName.value,
          username: form.username.value,
          locationRegion: form.locationRegion.value,
        },
      });
      toast("Klipper profile saved.");
      paint();
    });
    panels.querySelectorAll("[data-join-campaign]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api(`/api/campaigns/${button.dataset.joinCampaign}/join`, { method: "POST", body: {} });
        toast("Join request sent.");
        paint();
      });
    });
    $("#klipperSubmitForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await api(`/api/campaigns/${form.campaignId.value}/submissions`, {
        method: "POST",
        body: {
          clipId: form.clipId.value,
          platform: form.platform.value,
          publicUrl: form.publicUrl.value,
        },
      });
      toast("Submission received. It waits for verification and is never auto-paid.");
      paint();
    });
  }

  async function marketplaceSubmitters(mine) {
    const active = mine.filter((item) => item.participant.status === "ACTIVE" && item.participant.role === "KLIPPER");
    if (!active.length) return "";
    const vaults = await Promise.all(active.map(async (item) => {
      const vault = await api(`/api/campaigns/${item.campaign.id}/vault`).catch(() => ({ clips: [] }));
      return { campaign: item.campaign, clips: vault.clips || [] };
    }));
    return `
      <section class="ops-card">
        <h3>Submission center</h3>
        <p>Post externally, then paste the public URL. KlipPharma does not scrape protected social data.</p>
        <form class="ops-form" id="klipperSubmitForm">
          <label><span>CAMPAIGN</span><select name="campaignId">${vaults.map((item) => `<option value="${item.campaign.id}">${escapeHtml(item.campaign.title)}</option>`).join("")}</select></label>
          <label><span>APPROVED KLIP</span><select name="clipId">${vaults.flatMap((item) => item.clips.map((clip) => `<option value="${clip.id}">${escapeHtml(clip.title)} (${item.campaign.title})</option>`)).join("")}</select></label>
          <label><span>PLATFORM</span><select name="platform">${options(["tiktok", "instagram", "youtube", "x"])}</select></label>
          <label><span>PUBLIC POST URL</span><input name="publicUrl" type="url" required placeholder="https://www.tiktok.com/@studio/video/…" /></label>
          <button class="primary" type="submit">Submit for verification</button>
        </form>
      </section>
    `;
  }

  async function paintWorkspaceAnalytics() {
    header("ANALYTICS", "Workspace performance", "Verified views, spend vs results, and high-performing patterns from this workspace only.", []);
    const data = await api("/api/campaigns/command-center");
    panels.innerHTML = `
      <div class="ops-metrics">
        ${metric("Verified views", compact(data.totalVerifiedViews))}
        ${metric("Spend", money(data.campaignSpend))}
        ${metric("Cost / 1K", data.costPer1kViews == null ? "—" : money(data.costPer1kViews))}
        ${metric("Trending hook", data.trendingHook?.key || "No historical signal yet")}
      </div>
      <div class="ops-card-list">
        ${(data.campaigns || []).map((item) => `<article class="ops-card" data-open-campaign="${item.id}"><h3>${escapeHtml(item.title)}</h3><p>${compact(item.verifiedViews)} views · ${escapeHtml(item.status)}</p></article>`).join("") || `<div class="dashboard-empty">No campaign analytics yet.</div>`}
      </div>
    `;
  }

  async function paintEarnings() {
    header("EARNINGS", "Payout ledger", "Eligible compensation is calculated and reviewed. Automatic cash payouts are disabled in v1.", []);
    const data = await api("/api/campaigns/marketplace/earnings");
    panels.innerHTML = `
      <div class="ops-metrics">
        ${metric("Calculated earnings", money(data.earningsCalculated))}
        ${metric("Automatic payouts", "Off")}
      </div>
      <div class="ops-table">
        ${(data.entries || []).map((entry) => `
          <article class="ops-row">
            <div><strong>${escapeHtml(entry.entryType)}</strong><small>${escapeHtml(entry.note)}</small></div>
            <span class="ops-status">${escapeHtml(entry.payoutStatus || "n/a")}</span>
            <span>${money(entry.amount, entry.currency)}</span>
          </article>
        `).join("") || `<div class="dashboard-empty">No ledger entries yet.</div>`}
      </div>
    `;
  }

  async function paintWorkspaceVault() {
    header("KLIP VAULT", "Approved campaign klips", "Import AutoKlip candidates, then approve before distribution. AI never publishes on its own.", [
      { label: "Open campaigns", action: "campaigns", className: "secondary" },
    ]);
    const data = await api("/api/campaigns");
    const live = data.campaigns || [];
    if (!live.length) {
      panels.innerHTML = `<div class="dashboard-empty">Create a campaign first, then send AutoKlip candidates into its vault.</div>`;
      return;
    }
    const vaults = await Promise.all(live.map(async (campaign) => {
      const content = await api(`/api/campaigns/${campaign.id}/vault`).catch(() => ({ clips: [] }));
      return { campaign, clips: content.clips || [] };
    }));
    panels.innerHTML = vaults.map((item) => `
      <section class="ops-card" data-open-campaign="${item.campaign.id}">
        <span class="ops-status">${escapeHtml(item.campaign.status)}</span>
        <h3>${escapeHtml(item.campaign.title)}</h3>
        <p>${item.clips.filter((clip) => clip.approvalStatus === "APPROVED").length} approved · ${item.clips.filter((clip) => clip.approvalStatus === "CANDIDATE").length} candidates</p>
      </section>
    `).join("");
  }

  function metric(label, value) {
    return `<div class="ops-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function options(values, selected) {
    return values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
  }

  function toLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function asText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }

  function readCampaignForm(form) {
    const split = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    return {
      title: form.title.value,
      description: form.description.value,
      campaignType: form.campaignType.value,
      payoutModel: form.payoutModel.value,
      budget: Number(form.budget.value || 0),
      currency: form.currency.value,
      payoutRate: Number(form.payoutRate.value || 0),
      payoutCap: form.payoutCap.value === "" ? null : Number(form.payoutCap.value),
      startDate: form.startDate.value ? new Date(form.startDate.value).toISOString() : null,
      endDate: form.endDate.value ? new Date(form.endDate.value).toISOString() : null,
      targetViews: Number(form.targetViews.value || 0),
      targetPosts: Number(form.targetPosts.value || 0),
      targetPlatforms: split(form.targetPlatforms.value),
      allowedRegions: split(form.allowedRegions.value).map((item) => item.toUpperCase()),
      contentRequirements: parseMaybeJson(form.contentRequirements.value),
      prohibitedContent: parseMaybeJson(form.prohibitedContent.value),
      approvalRequired: form.approvalRequired.checked,
    };
  }

  function parseMaybeJson(value) {
    const text = String(value || "").trim();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { text }; }
  }

  function statusButtons(status) {
    const map = {
      DRAFT: [{ label: "Mark ready", action: "status:READY", className: "secondary" }],
      READY: [{ label: "Go live", action: "status:LIVE", className: "primary" }],
      LIVE: [{ label: "Pause", action: "status:PAUSED", className: "secondary" }, { label: "Complete", action: "status:COMPLETED", className: "secondary" }],
      PAUSED: [{ label: "Resume live", action: "status:LIVE", className: "primary" }],
      COMPLETED: [{ label: "Archive", action: "status:ARCHIVED", className: "secondary" }],
    };
    return map[status] || [];
  }

  function detailOverview(campaign, analytics, rights) {
    const overview = analytics?.overview || {};
    return `
      <div class="ops-metrics">
        ${metric("Verified views", compact(overview.verifiedViews))}
        ${metric("Active Klippers", overview.activeKlippers ?? 0)}
        ${metric("Approved klips", overview.approvedKlips ?? 0)}
        ${metric("Flags needing review", overview.flagsNeedingReview ?? 0)}
      </div>
      <p>Payout model ${escapeHtml(campaign.payoutModel)} · Rights ${rights?.acknowledgedAt ? "acknowledged" : "not acknowledged"}</p>
      <p class="ops-note">Performance Score and Historical Signal describe verified history. They do not predict virality.</p>
    `;
  }

  function detailAnalytics(analytics) {
    if (!analytics) return `<div class="dashboard-empty">Analytics are available to campaign managers.</div>`;
    return `
      <div class="ops-metrics">
        ${metric("Goal views", `${compact(analytics.goalProgress.views.actual)} / ${compact(analytics.goalProgress.views.target)}`)}
        ${metric("Goal posts", `${analytics.goalProgress.posts.actual} / ${analytics.goalProgress.posts.target}`)}
        ${metric("Engagement rate", `${Math.round((analytics.overview.engagementRate || 0) * 1000) / 10}%`)}
        ${metric("Cost / 1K", analytics.financials?.costPer1kVerifiedViews == null ? "—" : money(analytics.financials.costPer1kVerifiedViews))}
      </div>
      <h3>Top klips</h3>
      <div class="ops-card-list">${(analytics.topKlips || []).map((item) => `<article class="ops-card"><h3>${escapeHtml(item.title)}</h3><p>${compact(item.views)} verified views · ${escapeHtml(item.hook || "")}</p></article>`).join("") || "<p>None yet.</p>"}</div>
      <h3>Platform breakdown</h3>
      <div class="ops-card-list">${(analytics.platformBreakdown || []).map((item) => `<article class="ops-card"><h3>${escapeHtml(item.platform)}</h3><p>${item.posts} posts · ${compact(item.views)} views</p></article>`).join("") || "<p>None yet.</p>"}</div>
      <p class="ops-note">${escapeHtml(analytics.historicalSignal?.disclaimer || "")}</p>
    `;
  }

  function detailContent(content, campaignId) {
    return `
      <form class="ops-form" id="importVaultForm">
        <label><span>IMPORT FROM READY PROJECT</span>
          <select name="projectId">${(content.readyProjects || []).map((item) => `<option value="${item.id}">${escapeHtml(item.title)} · ${item.clipCount} klips</option>`).join("")}</select>
        </label>
        <button class="secondary" type="submit" ${(content.readyProjects || []).length ? "" : "disabled"}>Import as candidates</button>
      </form>
      <div class="ops-card-list">
        ${(content.clips || []).map((clip) => `
          <article class="ops-card">
            <span class="ops-status">${escapeHtml(clip.approvalStatus)}</span>
            <h3>${escapeHtml(clip.title)}</h3>
            <p>${escapeHtml(clip.hook || "")}</p>
            <p>Performance Score ${clip.performanceScore ?? "—"} · ${clip.duration || 0}s · used ${clip.usageCount || 0}×</p>
            ${clip.approvalStatus === "CANDIDATE" ? `
              <div class="ops-inline-actions">
                <button type="button" data-vault-decision="APPROVED" data-clip-id="${clip.id}">Approve</button>
                <button type="button" data-vault-decision="REJECTED" data-clip-id="${clip.id}">Reject</button>
              </div>` : ""}
          </article>
        `).join("") || `<div class="dashboard-empty">No vault clips yet. Run AutoKlip, then import candidates.</div>`}
      </div>
    `;
  }

  function detailParticipants(participants) {
    return `<div class="ops-table">${participants.map((item) => `
      <article class="ops-row">
        <div><strong>${escapeHtml(item.role)}</strong><small>${escapeHtml(item.userId)}</small></div>
        <span class="ops-status">${escapeHtml(item.status)}</span>
        ${item.status === "APPLIED" ? `<button type="button" data-participant-decision="ACTIVE" data-participant-id="${item.id}">Activate</button>` : ""}
      </article>
    `).join("") || `<div class="dashboard-empty">No participants yet.</div>`}</div>`;
  }

  function detailSubmissions(submissions, flags) {
    return `
      ${flags.length ? `<div class="ops-note">Needs review: ${flags.map((flag) => escapeHtml(flag.message)).join(" ")}</div>` : ""}
      <div class="ops-table">
        ${submissions.map((item) => `
          <article class="ops-row">
            <div><strong>${escapeHtml(item.platform)}</strong><small><a href="${escapeHtml(item.publicUrl)}" target="_blank" rel="noreferrer">Public post</a></small></div>
            <span class="ops-status">${escapeHtml(item.verificationStatus)}</span>
            <span>${compact(item.latestMetrics?.views || 0)} views</span>
          </article>
        `).join("") || `<div class="dashboard-empty">No submissions yet.</div>`}
      </div>
      <form class="ops-form" id="submissionReviewForm">
        <label><span>SUBMISSION ID</span><input name="submissionId" required /></label>
        <label><span>DECISION</span><select name="decision">${options(["VERIFYING", "VERIFIED", "REJECTED", "FLAGGED"])}</select></label>
        <label><span>VIEWS</span><input name="views" type="number" min="0" value="0" /></label>
        <label><span>LIKES</span><input name="likes" type="number" min="0" value="0" /></label>
        <label><span>COMMENTS</span><input name="comments" type="number" min="0" value="0" /></label>
        <label><span>SHARES</span><input name="shares" type="number" min="0" value="0" /></label>
        <label><span>EVIDENCE NOTE</span><textarea name="evidence" rows="2" placeholder="Manual observation source"></textarea></label>
        <label><span>REJECTION REASON</span><input name="rejectionReason" /></label>
        <button class="primary" type="submit">Record verification</button>
      </form>
    `;
  }

  function detailFinancials(financials) {
    if (!financials) return `<div class="dashboard-empty">Financials are limited to campaign owners, admins, and managers.</div>`;
    const summary = financials.financials || {};
    return `
      <div class="ops-metrics">
        ${metric("Budget", money(summary.budget, summary.currency))}
        ${metric("Reserved", money(summary.reserved, summary.currency))}
        ${metric("Eligible", money(summary.eligiblePayouts, summary.currency))}
        ${metric("Approved", money(summary.approvedPayouts, summary.currency))}
        ${metric("Remaining", money(summary.remainingBudget, summary.currency))}
      </div>
      <p class="ops-note">Automatic payouts are off. APPROVED means the ledger is approved, not that cash moved.</p>
      <div class="ops-table">
        ${(financials.entries || []).map((entry) => `
          <article class="ops-row">
            <div><strong>${escapeHtml(entry.entryType)}</strong><small>${escapeHtml(entry.note)}</small></div>
            <span class="ops-status">${escapeHtml(entry.payoutStatus || "n/a")}</span>
            <span>${money(entry.amount, entry.currency)}</span>
            ${entry.payoutStatus === "CALCULATED" ? `<button type="button" data-ledger-decision="APPROVED" data-entry-id="${entry.id}">Approve</button>` : ""}
          </article>
        `).join("") || `<div class="dashboard-empty">No ledger entries.</div>`}
      </div>
    `;
  }

  function detailRights(rights) {
    const value = (key) => escapeHtml(rights?.[key] || "");
    return `
      <form class="ops-form" id="rightsForm">
        <label><span>CONTENT OWNERSHIP</span><textarea name="contentOwnershipDeclaration" rows="2">${value("contentOwnershipDeclaration")}</textarea></label>
        <label><span>USAGE PERMISSIONS</span><textarea name="usagePermissions" rows="2">${value("usagePermissions")}</textarea></label>
        <label><span>MUSIC / AUDIO RIGHTS</span><textarea name="musicAudioRightsDeclaration" rows="2">${value("musicAudioRightsDeclaration")}</textarea></label>
        <label><span>ALLOWED EDITING</span><textarea name="allowedEditingRules" rows="2">${value("allowedEditingRules")}</textarea></label>
        <label><span>BRAND GUIDELINES</span><textarea name="brandGuidelines" rows="2">${value("brandGuidelines")}</textarea></label>
        <label><span>PROHIBITED USES</span><textarea name="prohibitedUses" rows="2">${value("prohibitedUses")}</textarea></label>
        <label><span>EXPIRATION</span><textarea name="campaignExpiration" rows="2">${value("campaignExpiration")}</textarea></label>
        <label><span>TAKEDOWN PROCEDURE</span><textarea name="contentTakedownProcedure" rows="2">${value("contentTakedownProcedure")}</textarea></label>
        <label><span>DISCLOSURE REQUIREMENTS</span><textarea name="disclosureRequirements" rows="2">${value("disclosureRequirements")}</textarea></label>
        <label><span>TERRITORY RESTRICTIONS</span><textarea name="territoryRestrictions" rows="2">${value("territoryRestrictions")}</textarea></label>
        <label class="ops-check"><input name="acknowledge" type="checkbox" value="true" /><span>I acknowledge these rights and brand-safety terms</span></label>
        <button class="primary" type="submit">Save rights</button>
      </form>
    `;
  }

  actions.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-ops-action]");
    if (!button) return;
    const action = button.dataset.opsAction;
    if (action === "create") { screen = "create"; return paint(); }
    if (action === "campaigns") { screen = "campaigns"; return paint(); }
    if (action === "edit") { screen = "edit"; return paint(); }
    if (action === "mine") { screen = "marketplace"; return paint(); }
    if (action.startsWith("status:")) {
      await api(`/api/campaigns/${selectedCampaignId}/status`, { method: "POST", body: { status: action.split(":")[1] } });
      toast("Campaign status updated.");
      screen = "detail:overview";
      return paint();
    }
  });

  panels.addEventListener("click", (event) => {
    const card = event.target.closest("[data-open-campaign]");
    if (!card || event.target.closest("button, a, form")) return;
    selectedCampaignId = card.dataset.openCampaign;
    screen = "detail:overview";
    paint();
  });

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-studio-nav]");
    if (!button) return;
    const target = button.dataset.studioNav;
    if (target === "home" || target === "create") {
      setView("upload");
      if (target === "create") $("#uploadForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (target === "autoklip") {
      setView(getCurrentProjects?.()?.length ? "results" : "upload");
      return;
    }
    if (target === "team") {
      openTeam?.();
      return;
    }
    screen = { campaigns: "command", vault: "vault", distribute: "marketplace", analytics: "analytics", earnings: "earnings" }[target] || "command";
    paint().catch((error) => toast(error.message));
  });

  async function openVaultPicker(projectId, clipId) {
    const data = await api("/api/campaigns");
    const campaigns = data.campaigns || [];
    if (!campaigns.length) {
      screen = "create";
      await paint();
      toast("Create a campaign first, then send this klip to its vault.");
      return;
    }
    const campaignId = campaigns.length === 1
      ? campaigns[0].id
      : window.prompt(`Campaign id to receive this candidate:\n${campaigns.map((item) => `${item.title} (${item.id})`).join("\n")}`, campaigns[0].id);
    if (!campaignId) return;
    await api(`/api/campaigns/${campaignId}/vault/from-project`, {
      method: "POST",
      body: { projectId, clipIds: clipId ? [clipId] : [] },
    });
    selectedCampaignId = campaignId;
    screen = "detail:content";
    toast("Candidate stored in the Campaign Klip Vault. Approve it before distribution.");
    await paint();
  }

  return { openVaultPicker, refresh: paint };
}
