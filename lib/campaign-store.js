import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CampaignError, LOCAL_WORKSPACE_ID, money, nowIso } from "./campaign-constants.js";

function collection() {
  const items = new Map();
  return {
    all() {
      return [...items.values()];
    },
    get(id) {
      return items.get(id) || null;
    },
    put(record) {
      items.set(record.id, structuredClone(record));
      return this.get(record.id);
    },
    delete(id) {
      return items.delete(id);
    },
    find(predicate) {
      return this.all().filter(predicate);
    },
    findOne(predicate) {
      return this.all().find(predicate) || null;
    },
    replaceAll(records) {
      items.clear();
      for (const record of records || []) items.set(record.id, structuredClone(record));
    },
  };
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createMemoryCampaignStore({ persistDir = null } = {}) {
  const campaigns = collection();
  const rights = collection();
  const profiles = collection();
  const platformMetrics = collection();
  const participants = collection();
  const clips = collection();
  const submissions = collection();
  const snapshots = collection();
  const features = collection();
  const observations = collection();
  const ledger = collection();
  const flags = collection();
  const audit = collection();

  const persistPath = persistDir ? path.join(persistDir, "campaign-network.json") : null;

  function snapshotState() {
    return {
      campaigns: campaigns.all(),
      rights: rights.all(),
      profiles: profiles.all(),
      platformMetrics: platformMetrics.all(),
      participants: participants.all(),
      clips: clips.all(),
      submissions: submissions.all(),
      snapshots: snapshots.all(),
      features: features.all(),
      observations: observations.all(),
      ledger: ledger.all(),
      flags: flags.all(),
      audit: audit.all(),
    };
  }

  function persist() {
    if (!persistPath) return;
    fs.mkdirSync(path.dirname(persistPath), { recursive: true });
    const temporary = `${persistPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(snapshotState()));
    fs.renameSync(temporary, persistPath);
  }

  function restore() {
    if (!persistPath || !fs.existsSync(persistPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(persistPath, "utf8"));
      campaigns.replaceAll(data.campaigns);
      rights.replaceAll(data.rights);
      profiles.replaceAll(data.profiles);
      platformMetrics.replaceAll(data.platformMetrics);
      participants.replaceAll(data.participants);
      clips.replaceAll(data.clips);
      submissions.replaceAll(data.submissions);
      snapshots.replaceAll(data.snapshots);
      features.replaceAll(data.features);
      observations.replaceAll(data.observations);
      ledger.replaceAll(data.ledger);
      flags.replaceAll(data.flags);
      audit.replaceAll(data.audit);
    } catch (error) {
      console.error("Could not restore campaign network store:", error.message);
    }
  }

  restore();

  let txTail = Promise.resolve();

  const store = {
    mode: "memory",
    createId: () => crypto.randomUUID(),
    persist,
    restore,

    async withTransaction(work) {
      /** @type {(value?: unknown) => void} */
      let release = () => {};
      const gate = new Promise((resolve) => { release = resolve; });
      const previous = txTail;
      txTail = previous.then(() => gate);
      await previous;
      try {
        return await work(store);
      } finally {
        release();
      }
    },
    async lockSubmission(workspaceId, campaignId, submissionId) {
      const submission = submissions.get(submissionId);
      if (!submission || submission.workspaceId !== workspaceId || submission.campaignId !== campaignId) return null;
      return clone(submission);
    },

    async listCampaigns(workspaceId, { statuses = null } = {}) {
      return campaigns.find((item) => item.workspaceId === workspaceId
        && (!statuses || statuses.includes(item.status)))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async getCampaign(workspaceId, campaignId) {
      const campaign = campaigns.get(campaignId);
      return campaign?.workspaceId === workspaceId ? clone(campaign) : null;
    },
    async getCampaignById(campaignId) {
      return clone(campaigns.get(campaignId));
    },
    async saveCampaign(campaign) {
      const saved = campaigns.put({ ...campaign, updatedAt: nowIso() });
      persist();
      return clone(saved);
    },
    async listLiveDiscoverable(filters = {}) {
      return campaigns.find((item) => {
        if (item.status !== "LIVE") return false;
        if (filters.platform && !(item.targetPlatforms || []).includes(filters.platform)) return false;
        if (filters.region && (item.allowedRegions || []).length && !(item.allowedRegions || []).includes(filters.region)) return false;
        return true;
      }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },

    async getRights(workspaceId, campaignId) {
      const record = rights.findOne((item) => item.campaignId === campaignId && item.workspaceId === workspaceId);
      return clone(record);
    },
    async saveRights(record) {
      const saved = rights.put({ id: record.campaignId, ...record, updatedAt: nowIso() });
      persist();
      return clone(saved);
    },

    async getProfileByUser(userId) {
      return clone(profiles.findOne((item) => item.userId === userId));
    },
    async getProfile(profileId) {
      return clone(profiles.get(profileId));
    },
    async getProfileByUsername(username) {
      const needle = String(username || "").toLowerCase();
      return clone(profiles.findOne((item) => String(item.username || "").toLowerCase() === needle));
    },
    async saveProfile(profile) {
      const saved = profiles.put({ ...profile, updatedAt: nowIso() });
      persist();
      return clone(saved);
    },
    async listPlatformMetrics(klipperId) {
      return platformMetrics.find((item) => item.klipperId === klipperId).map(clone);
    },
    async savePlatformMetric(metric) {
      const saved = platformMetrics.put(metric);
      persist();
      return clone(saved);
    },

    async listParticipants(workspaceId, campaignId) {
      return participants.find((item) => item.workspaceId === workspaceId && item.campaignId === campaignId).map(clone);
    },
    async getParticipant(workspaceId, campaignId, userId) {
      return clone(participants.findOne((item) => (
        item.workspaceId === workspaceId && item.campaignId === campaignId && item.userId === userId
      )));
    },
    async getParticipantByCampaignUser(campaignId, userId) {
      return clone(participants.findOne((item) => item.campaignId === campaignId && item.userId === userId));
    },
    async getParticipantById(participantId) {
      return clone(participants.get(participantId));
    },
    async listParticipationsForUser(userId) {
      return participants.find((item) => item.userId === userId).map(clone);
    },
    async saveParticipant(participant) {
      const saved = participants.put({ ...participant, updatedAt: nowIso() });
      persist();
      return clone(saved);
    },

    async listClips(workspaceId, campaignId, { approvalStatus = null } = {}) {
      return clips.find((item) => item.workspaceId === workspaceId
        && item.campaignId === campaignId
        && (!approvalStatus || item.approvalStatus === approvalStatus))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map(clone);
    },
    async getClip(workspaceId, clipId) {
      const clip = clips.get(clipId);
      return clip?.workspaceId === workspaceId ? clone(clip) : null;
    },
    async saveClip(clip) {
      if (clip.sourceProjectId && clip.sourceClipId) {
        const conflict = clips.findOne((item) => (
          item.campaignId === clip.campaignId
          && item.sourceProjectId === clip.sourceProjectId
          && item.sourceClipId === clip.sourceClipId
          && item.id !== clip.id
        ));
        if (conflict) throw new CampaignError("That source clip is already in this campaign vault.", 409);
      }
      const saved = clips.put({ ...clip, updatedAt: nowIso() });
      persist();
      return clone(saved);
    },
    async incrementClipUsage(clipId, workspaceId) {
      const clip = clips.get(clipId);
      if (!clip || clip.workspaceId !== workspaceId) return null;
      return this.saveClip({ ...clip, usageCount: Number(clip.usageCount || 0) + 1 });
    },
    async findClipBySource(workspaceId, campaignId, sourceProjectId, sourceClipId) {
      return clone(clips.findOne((item) => (
        item.workspaceId === workspaceId
        && item.campaignId === campaignId
        && item.sourceProjectId === sourceProjectId
        && item.sourceClipId === sourceClipId
      )));
    },

    async listSubmissions(workspaceId, { campaignId = null, userId = null } = {}) {
      return submissions.find((item) => item.workspaceId === workspaceId
        && (!campaignId || item.campaignId === campaignId)
        && (!userId || item.userId === userId))
        .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
        .map(clone);
    },
    async getSubmission(workspaceId, submissionId) {
      const submission = submissions.get(submissionId);
      return submission?.workspaceId === workspaceId ? clone(submission) : null;
    },
    async getSubmissionByCanonicalUrl(workspaceId, canonicalUrl) {
      return clone(submissions.findOne((item) => (
        item.workspaceId === workspaceId && item.canonicalUrl === canonicalUrl
      )));
    },
    async listSubmissionsForUser(userId) {
      return submissions.find((item) => item.userId === userId)
        .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
        .map(clone);
    },
    async saveSubmission(submission) {
      const duplicate = submissions.findOne((item) => (
        item.workspaceId === submission.workspaceId
        && item.canonicalUrl === submission.canonicalUrl
        && item.id !== submission.id
      ));
      if (duplicate) throw new CampaignError("That public post URL has already been submitted.", 409, "duplicate_url");
      const saved = submissions.put({ verificationVersion: 1, ...submission, updatedAt: nowIso() });
      persist();
      return clone(saved);
    },

    async listSnapshots(submissionId) {
      return snapshots.find((item) => item.submissionId === submissionId)
        .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))
        .map(clone);
    },
    async saveSnapshot(snapshot) {
      const saved = snapshots.put(snapshot);
      persist();
      return clone(saved);
    },

    async getFeaturesForClip(clipId) {
      return clone(features.findOne((item) => item.clipId === clipId));
    },
    async listFeatures(workspaceId, { campaignId = null } = {}) {
      return features.find((item) => item.workspaceId === workspaceId
        && (!campaignId || item.campaignId === campaignId)).map(clone);
    },
    async saveFeatures(record) {
      const existing = record.clipId
        ? features.findOne((item) => item.clipId === record.clipId)
        : null;
      const saved = features.put({
        ...record,
        id: existing?.id || record.id,
        updatedAt: nowIso(),
      });
      persist();
      return clone(saved);
    },

    async listObservations(workspaceId, { creatorId = null, campaignId = null } = {}) {
      return observations.find((item) => item.workspaceId === workspaceId
        && (!creatorId || item.creatorId === creatorId)
        && (!campaignId || item.campaignId === campaignId)
        && (item.aggregatedLearningAuthorized || item.workspaceId === workspaceId))
        .map(clone);
    },
    async getObservationForSubmission(submissionId, verificationVersion = 1) {
      return clone(observations.findOne((item) => (
        item.submissionId === submissionId
        && Number(item.verificationVersion || 1) === Number(verificationVersion || 1)
      )));
    },
    async saveObservation(observation) {
      if (observation.submissionId) {
        const existing = observations.findOne((item) => (
          item.submissionId === observation.submissionId
          && Number(item.verificationVersion || 1) === Number(observation.verificationVersion || 1)
        ));
        if (existing) return clone(existing);
      }
      const saved = observations.put({ verificationVersion: 1, ...observation });
      persist();
      return clone(saved);
    },

    async listLedger(workspaceId, { campaignId = null, klipperId = null } = {}) {
      return ledger.find((item) => item.workspaceId === workspaceId
        && (!campaignId || item.campaignId === campaignId)
        && (!klipperId || item.klipperId === klipperId))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map(clone);
    },
    async getLedgerEntry(workspaceId, entryId) {
      const entry = ledger.get(entryId);
      return entry?.workspaceId === workspaceId ? clone(entry) : null;
    },
    async listLedgerForKlipper(klipperId) {
      return ledger.find((item) => item.klipperId === klipperId)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map(clone);
    },
    async getEligiblePayoutForSubmission(workspaceId, submissionId) {
      return clone(ledger.findOne((item) => (
        item.workspaceId === workspaceId
        && item.submissionId === submissionId
        && item.entryType === "eligible_payout"
      )));
    },
    async saveLedgerEntry(entry) {
      if (entry.entryType === "eligible_payout" && entry.submissionId) {
        const existing = ledger.findOne((item) => (
          item.submissionId === entry.submissionId && item.entryType === "eligible_payout" && item.id !== entry.id
        ));
        if (existing) return clone(existing);
      }
      if (entry.entryType === "reservation" && entry.submissionId && (entry.reservationStatus || "ACTIVE") === "ACTIVE") {
        const existing = ledger.findOne((item) => (
          item.submissionId === entry.submissionId
          && item.entryType === "reservation"
          && (item.reservationStatus || "ACTIVE") === "ACTIVE"
          && item.id !== entry.id
        ));
        if (existing) return clone(existing);
      }
      const saved = ledger.put(entry);
      persist();
      return clone(saved);
    },
    async incrementProfileStats(profileId, {
      approvedSubmissions = 0, rejectedSubmissions = 0, verifiedViews = 0, earningsCalculated = 0,
    } = {}) {
      const profile = profiles.get(profileId);
      if (!profile) return null;
      return this.saveProfile({
        ...profile,
        approvedSubmissions: Number(profile.approvedSubmissions || 0) + Number(approvedSubmissions || 0),
        rejectedSubmissions: Number(profile.rejectedSubmissions || 0) + Number(rejectedSubmissions || 0),
        verifiedViews: Number(profile.verifiedViews || 0) + Number(verifiedViews || 0),
        earningsCalculated: money(Number(profile.earningsCalculated || 0) + Number(earningsCalculated || 0)),
      });
    },

    async listFlags(workspaceId, { campaignId = null, status = "open" } = {}) {
      return flags.find((item) => item.workspaceId === workspaceId
        && (!campaignId || item.campaignId === campaignId)
        && (!status || item.status === status)).map(clone);
    },
    async saveFlag(flag) {
      const saved = flags.put(flag);
      persist();
      return clone(saved);
    },

    async listAudit(workspaceId, campaignId) {
      return audit.find((item) => item.workspaceId === workspaceId && (!campaignId || item.campaignId === campaignId))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(clone);
    },
    async saveAudit(event) {
      const saved = audit.put(event);
      persist();
      return clone(saved);
    },
  };

  return store;
}

export function defaultWorkspaceId(req) {
  return req?.team?.id || req?.user?.workspaceId || LOCAL_WORKSPACE_ID;
}

export function actorId(req) {
  return req?.user?.id || "anonymous";
}
