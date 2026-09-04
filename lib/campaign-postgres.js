import crypto from "node:crypto";
import { nowIso } from "./campaign-constants.js";

function json(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function mapCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    creatorId: row.creator_id,
    title: row.title,
    description: row.description || "",
    campaignType: row.campaign_type,
    status: row.status,
    budget: Number(row.budget || 0),
    currency: row.currency,
    startDate: row.start_date,
    endDate: row.end_date,
    targetViews: Number(row.target_views || 0),
    targetPosts: Number(row.target_posts || 0),
    targetPlatforms: row.target_platforms || [],
    allowedRegions: row.allowed_regions || [],
    campaignRules: json(row.campaign_rules),
    contentRequirements: json(row.content_requirements),
    prohibitedContent: json(row.prohibited_content),
    payoutModel: row.payout_model,
    payoutRate: Number(row.payout_rate || 0),
    payoutCap: row.payout_cap == null ? null : Number(row.payout_cap),
    approvalRequired: row.approval_required !== false,
    sourceMediaIds: row.source_media_ids || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRights(row) {
  if (!row) return null;
  return {
    id: row.campaign_id,
    campaignId: row.campaign_id,
    workspaceId: row.workspace_id,
    contentOwnershipDeclaration: row.content_ownership_declaration || "",
    usagePermissions: row.usage_permissions || "",
    musicAudioRightsDeclaration: row.music_audio_rights_declaration || "",
    allowedEditingRules: row.allowed_editing_rules || "",
    brandGuidelines: row.brand_guidelines || "",
    prohibitedUses: row.prohibited_uses || "",
    campaignExpiration: row.campaign_expiration || "",
    contentTakedownProcedure: row.content_takedown_procedure || "",
    disclosureRequirements: row.disclosure_requirements || "",
    territoryRestrictions: row.territory_restrictions || "",
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    username: row.username,
    socialHandles: json(row.social_handles, []),
    connectedPlatforms: row.connected_platforms || [],
    categories: row.categories || [],
    locationRegion: row.location_region,
    campaignHistory: json(row.campaign_history, []),
    approvedSubmissions: Number(row.approved_submissions || 0),
    rejectedSubmissions: Number(row.rejected_submissions || 0),
    verifiedViews: Number(row.verified_views || 0),
    earningsCalculated: Number(row.earnings_calculated || 0),
    reliabilityScore: row.reliability_score == null ? null : Number(row.reliability_score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    klipperId: row.klipper_id,
    role: row.role,
    status: row.status,
    region: row.region,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClip(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    workspaceId: row.workspace_id,
    sourceProjectId: row.source_project_id,
    sourceMediaId: row.source_media_id,
    sourceClipId: row.source_clip_id,
    sourceTimestamps: json(row.source_timestamps),
    duration: row.duration == null ? null : Number(row.duration),
    aspectRatio: row.aspect_ratio,
    transcript: row.transcript || "",
    captionPackage: json(row.caption_package),
    hook: row.hook || "",
    title: row.title || "",
    description: row.description || "",
    thumbnail: row.thumbnail,
    processingVersion: row.processing_version,
    approvalStatus: row.approval_status,
    performanceScore: row.performance_score == null ? null : Number(row.performance_score),
    usageCount: Number(row.usage_count || 0),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    workspaceId: row.workspace_id,
    klipperId: row.klipper_id,
    userId: row.user_id,
    clipId: row.clip_id,
    platform: row.platform,
    publicUrl: row.public_url,
    canonicalUrl: row.canonical_url,
    submittedAt: row.submitted_at,
    verificationStatus: row.verification_status,
    contentStatus: row.content_status,
    initialMetrics: json(row.initial_metrics),
    latestMetrics: json(row.latest_metrics),
    verificationEvidence: json(row.verification_evidence),
    rejectionReason: row.rejection_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLedger(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    workspaceId: row.workspace_id,
    klipperId: row.klipper_id,
    submissionId: row.submission_id,
    entryType: row.entry_type,
    payoutStatus: row.payout_status,
    amount: Number(row.amount || 0),
    currency: row.currency,
    note: row.note || "",
    metadata: json(row.metadata),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export function createPostgresCampaignStore(query) {
  return {
    mode: "postgres",
    createId: () => crypto.randomUUID(),
    persist() {},
    restore() {},

    async listCampaigns(workspaceId, { statuses = null } = {}) {
      const result = statuses?.length
        ? await query(
          `SELECT * FROM campaigns WHERE workspace_id = $1 AND status = ANY($2) ORDER BY updated_at DESC`,
          [workspaceId, statuses],
        )
        : await query(`SELECT * FROM campaigns WHERE workspace_id = $1 ORDER BY updated_at DESC`, [workspaceId]);
      return result.rows.map(mapCampaign);
    },
    async getCampaign(workspaceId, campaignId) {
      const result = await query(`SELECT * FROM campaigns WHERE workspace_id = $1 AND id = $2`, [workspaceId, campaignId]);
      return mapCampaign(result.rows[0]);
    },
    async saveCampaign(campaign) {
      const result = await query(
        `INSERT INTO campaigns (
           id, workspace_id, creator_id, title, description, campaign_type, status, budget, currency,
           start_date, end_date, target_views, target_posts, target_platforms, allowed_regions,
           campaign_rules, content_requirements, prohibited_content, payout_model, payout_rate,
           payout_cap, approval_required, source_media_ids, created_by, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description, campaign_type = EXCLUDED.campaign_type,
           status = EXCLUDED.status, budget = EXCLUDED.budget, currency = EXCLUDED.currency,
           start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, target_views = EXCLUDED.target_views,
           target_posts = EXCLUDED.target_posts, target_platforms = EXCLUDED.target_platforms,
           allowed_regions = EXCLUDED.allowed_regions, campaign_rules = EXCLUDED.campaign_rules,
           content_requirements = EXCLUDED.content_requirements, prohibited_content = EXCLUDED.prohibited_content,
           payout_model = EXCLUDED.payout_model, payout_rate = EXCLUDED.payout_rate, payout_cap = EXCLUDED.payout_cap,
           approval_required = EXCLUDED.approval_required, source_media_ids = EXCLUDED.source_media_ids,
           updated_at = NOW()
         RETURNING *`,
        [
          campaign.id, campaign.workspaceId, campaign.creatorId, campaign.title, campaign.description || "",
          campaign.campaignType, campaign.status, campaign.budget, campaign.currency, campaign.startDate || null,
          campaign.endDate || null, campaign.targetViews || 0, campaign.targetPosts || 0, campaign.targetPlatforms || [],
          campaign.allowedRegions || [], JSON.stringify(campaign.campaignRules || {}),
          JSON.stringify(campaign.contentRequirements || {}), JSON.stringify(campaign.prohibitedContent || {}),
          campaign.payoutModel, campaign.payoutRate || 0, campaign.payoutCap, campaign.approvalRequired !== false,
          campaign.sourceMediaIds || [], campaign.createdBy, campaign.createdAt || nowIso(),
        ],
      );
      return mapCampaign(result.rows[0]);
    },
    async listLiveDiscoverable(filters = {}) {
      const result = await query(`SELECT * FROM campaigns WHERE status = 'LIVE' ORDER BY updated_at DESC`);
      return result.rows.map(mapCampaign).filter((item) => {
        if (filters.platform && !(item.targetPlatforms || []).includes(filters.platform)) return false;
        if (filters.region && (item.allowedRegions || []).length && !(item.allowedRegions || []).includes(filters.region)) {
          return false;
        }
        return true;
      });
    },

    async getRights(workspaceId, campaignId) {
      const result = await query(
        `SELECT * FROM campaign_rights WHERE workspace_id = $1 AND campaign_id = $2`,
        [workspaceId, campaignId],
      );
      return mapRights(result.rows[0]);
    },
    async saveRights(record) {
      const result = await query(
        `INSERT INTO campaign_rights (
           campaign_id, workspace_id, content_ownership_declaration, usage_permissions,
           music_audio_rights_declaration, allowed_editing_rules, brand_guidelines, prohibited_uses,
           campaign_expiration, content_takedown_procedure, disclosure_requirements, territory_restrictions,
           acknowledged_by, acknowledged_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, NOW()), NOW())
         ON CONFLICT (campaign_id) DO UPDATE SET
           content_ownership_declaration = EXCLUDED.content_ownership_declaration,
           usage_permissions = EXCLUDED.usage_permissions,
           music_audio_rights_declaration = EXCLUDED.music_audio_rights_declaration,
           allowed_editing_rules = EXCLUDED.allowed_editing_rules,
           brand_guidelines = EXCLUDED.brand_guidelines,
           prohibited_uses = EXCLUDED.prohibited_uses,
           campaign_expiration = EXCLUDED.campaign_expiration,
           content_takedown_procedure = EXCLUDED.content_takedown_procedure,
           disclosure_requirements = EXCLUDED.disclosure_requirements,
           territory_restrictions = EXCLUDED.territory_restrictions,
           acknowledged_by = EXCLUDED.acknowledged_by,
           acknowledged_at = EXCLUDED.acknowledged_at,
           updated_at = NOW()
         RETURNING *`,
        [
          record.campaignId, record.workspaceId, record.contentOwnershipDeclaration || "",
          record.usagePermissions || "", record.musicAudioRightsDeclaration || "",
          record.allowedEditingRules || "", record.brandGuidelines || "", record.prohibitedUses || "",
          record.campaignExpiration || "", record.contentTakedownProcedure || "",
          record.disclosureRequirements || "", record.territoryRestrictions || "",
          record.acknowledgedBy || null, record.acknowledgedAt || null, record.createdAt || null,
        ],
      );
      return mapRights(result.rows[0]);
    },

    async getProfileByUser(userId) {
      const result = await query(`SELECT * FROM klipper_profiles WHERE user_id = $1`, [userId]);
      return mapProfile(result.rows[0]);
    },
    async getProfile(profileId) {
      const result = await query(`SELECT * FROM klipper_profiles WHERE id = $1`, [profileId]);
      return mapProfile(result.rows[0]);
    },
    async getProfileByUsername(username) {
      const result = await query(`SELECT * FROM klipper_profiles WHERE lower(username) = lower($1)`, [username]);
      return mapProfile(result.rows[0]);
    },
    async saveProfile(profile) {
      const result = await query(
        `INSERT INTO klipper_profiles (
           id, user_id, workspace_id, display_name, username, social_handles, connected_platforms,
           categories, location_region, campaign_history, approved_submissions, rejected_submissions,
           verified_views, earnings_calculated, reliability_score, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,COALESCE($16, NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name, username = EXCLUDED.username,
           social_handles = EXCLUDED.social_handles, connected_platforms = EXCLUDED.connected_platforms,
           categories = EXCLUDED.categories, location_region = EXCLUDED.location_region,
           campaign_history = EXCLUDED.campaign_history, approved_submissions = EXCLUDED.approved_submissions,
           rejected_submissions = EXCLUDED.rejected_submissions, verified_views = EXCLUDED.verified_views,
           earnings_calculated = EXCLUDED.earnings_calculated, reliability_score = EXCLUDED.reliability_score,
           updated_at = NOW()
         RETURNING *`,
        [
          profile.id, profile.userId, profile.workspaceId || null, profile.displayName, profile.username,
          JSON.stringify(profile.socialHandles || []), profile.connectedPlatforms || [], profile.categories || [],
          profile.locationRegion || null, JSON.stringify(profile.campaignHistory || []),
          profile.approvedSubmissions || 0, profile.rejectedSubmissions || 0, profile.verifiedViews || 0,
          profile.earningsCalculated || 0, profile.reliabilityScore, profile.createdAt || null,
        ],
      );
      return mapProfile(result.rows[0]);
    },
    async listPlatformMetrics(klipperId) {
      const result = await query(`SELECT * FROM klipper_platform_metrics WHERE klipper_id = $1 ORDER BY captured_at DESC`, [klipperId]);
      return result.rows.map((row) => ({
        id: row.id,
        klipperId: row.klipper_id,
        platform: row.platform,
        handle: row.handle,
        followerCount: row.follower_count == null ? null : Number(row.follower_count),
        metricsSource: row.metrics_source,
        metricsEvidence: json(row.metrics_evidence),
        capturedAt: row.captured_at,
      }));
    },
    async savePlatformMetric(metric) {
      const result = await query(
        `INSERT INTO klipper_platform_metrics (
           id, klipper_id, platform, handle, follower_count, metrics_source, metrics_evidence, captured_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($8, NOW())) RETURNING *`,
        [
          metric.id, metric.klipperId, metric.platform, metric.handle || null, metric.followerCount,
          metric.metricsSource, JSON.stringify(metric.metricsEvidence || {}), metric.capturedAt || null,
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id, klipperId: row.klipper_id, platform: row.platform, handle: row.handle,
        followerCount: row.follower_count == null ? null : Number(row.follower_count),
        metricsSource: row.metrics_source, metricsEvidence: json(row.metrics_evidence), capturedAt: row.captured_at,
      };
    },

    async listParticipants(workspaceId, campaignId) {
      const result = await query(
        `SELECT * FROM campaign_participants WHERE workspace_id = $1 AND campaign_id = $2 ORDER BY created_at`,
        [workspaceId, campaignId],
      );
      return result.rows.map(mapParticipant);
    },
    async getParticipant(workspaceId, campaignId, userId) {
      const result = await query(
        `SELECT * FROM campaign_participants WHERE workspace_id = $1 AND campaign_id = $2 AND user_id = $3`,
        [workspaceId, campaignId, userId],
      );
      return mapParticipant(result.rows[0]);
    },
    async getParticipantById(participantId) {
      const result = await query(`SELECT * FROM campaign_participants WHERE id = $1`, [participantId]);
      return mapParticipant(result.rows[0]);
    },
    async listParticipationsForUser(userId) {
      const result = await query(`SELECT * FROM campaign_participants WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]);
      return result.rows.map(mapParticipant);
    },
    async saveParticipant(participant) {
      const result = await query(
        `INSERT INTO campaign_participants (
           id, campaign_id, workspace_id, user_id, klipper_id, role, status, region, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, NOW()), NOW())
         ON CONFLICT (campaign_id, user_id) DO UPDATE SET
           klipper_id = EXCLUDED.klipper_id, role = EXCLUDED.role, status = EXCLUDED.status,
           region = EXCLUDED.region, updated_at = NOW()
         RETURNING *`,
        [
          participant.id, participant.campaignId, participant.workspaceId, participant.userId,
          participant.klipperId || null, participant.role, participant.status, participant.region || null,
          participant.createdAt || null,
        ],
      );
      return mapParticipant(result.rows[0]);
    },

    async listClips(workspaceId, campaignId, { approvalStatus = null } = {}) {
      const result = approvalStatus
        ? await query(
          `SELECT * FROM campaign_clips WHERE workspace_id = $1 AND campaign_id = $2 AND approval_status = $3 ORDER BY updated_at DESC`,
          [workspaceId, campaignId, approvalStatus],
        )
        : await query(
          `SELECT * FROM campaign_clips WHERE workspace_id = $1 AND campaign_id = $2 ORDER BY updated_at DESC`,
          [workspaceId, campaignId],
        );
      return result.rows.map(mapClip);
    },
    async getClip(workspaceId, clipId) {
      const result = await query(`SELECT * FROM campaign_clips WHERE workspace_id = $1 AND id = $2`, [workspaceId, clipId]);
      return mapClip(result.rows[0]);
    },
    async saveClip(clip) {
      const result = await query(
        `INSERT INTO campaign_clips (
           id, campaign_id, workspace_id, source_project_id, source_media_id, source_clip_id, source_timestamps,
           duration, aspect_ratio, transcript, caption_package, hook, title, description, thumbnail,
           processing_version, approval_status, performance_score, usage_count, approved_by, approved_at,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,COALESCE($22, NOW()), NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           source_timestamps = EXCLUDED.source_timestamps, duration = EXCLUDED.duration, transcript = EXCLUDED.transcript,
           caption_package = EXCLUDED.caption_package, hook = EXCLUDED.hook, title = EXCLUDED.title,
           description = EXCLUDED.description, thumbnail = EXCLUDED.thumbnail, approval_status = EXCLUDED.approval_status,
           performance_score = EXCLUDED.performance_score, usage_count = EXCLUDED.usage_count,
           approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at, updated_at = NOW()
         RETURNING *`,
        [
          clip.id, clip.campaignId, clip.workspaceId, clip.sourceProjectId || null, clip.sourceMediaId || null,
          clip.sourceClipId || null, JSON.stringify(clip.sourceTimestamps || {}), clip.duration, clip.aspectRatio || "9:16",
          clip.transcript || "", JSON.stringify(clip.captionPackage || {}), clip.hook || "", clip.title || "",
          clip.description || "", clip.thumbnail || null, clip.processingVersion || "autoklip-v1",
          clip.approvalStatus, clip.performanceScore, clip.usageCount || 0, clip.approvedBy || null,
          clip.approvedAt || null, clip.createdAt || null,
        ],
      );
      return mapClip(result.rows[0]);
    },
    async findClipBySource(workspaceId, campaignId, sourceProjectId, sourceClipId) {
      const result = await query(
        `SELECT * FROM campaign_clips
         WHERE workspace_id = $1 AND campaign_id = $2 AND source_project_id = $3 AND source_clip_id = $4`,
        [workspaceId, campaignId, sourceProjectId, sourceClipId],
      );
      return mapClip(result.rows[0]);
    },

    async listSubmissions(workspaceId, { campaignId = null, userId = null } = {}) {
      const result = await query(
        `SELECT * FROM campaign_submissions
         WHERE workspace_id = $1
           AND ($2::uuid IS NULL OR campaign_id = $2)
           AND ($3::text IS NULL OR user_id = $3)
         ORDER BY submitted_at DESC`,
        [workspaceId, campaignId, userId],
      );
      return result.rows.map(mapSubmission);
    },
    async getSubmission(workspaceId, submissionId) {
      const result = await query(
        `SELECT * FROM campaign_submissions WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submissionId],
      );
      return mapSubmission(result.rows[0]);
    },
    async getSubmissionByCanonicalUrl(canonicalUrl) {
      const result = await query(`SELECT * FROM campaign_submissions WHERE canonical_url = $1`, [canonicalUrl]);
      return mapSubmission(result.rows[0]);
    },
    async saveSubmission(submission) {
      const result = await query(
        `INSERT INTO campaign_submissions (
           id, campaign_id, workspace_id, klipper_id, user_id, clip_id, platform, public_url, canonical_url,
           submitted_at, verification_status, content_status, initial_metrics, latest_metrics,
           verification_evidence, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, NOW()),$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,COALESCE($19, NOW()), NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           verification_status = EXCLUDED.verification_status, content_status = EXCLUDED.content_status,
           initial_metrics = EXCLUDED.initial_metrics, latest_metrics = EXCLUDED.latest_metrics,
           verification_evidence = EXCLUDED.verification_evidence, rejection_reason = EXCLUDED.rejection_reason,
           reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at, updated_at = NOW()
         RETURNING *`,
        [
          submission.id, submission.campaignId, submission.workspaceId, submission.klipperId || null,
          submission.userId, submission.clipId || null, submission.platform, submission.publicUrl,
          submission.canonicalUrl, submission.submittedAt || null, submission.verificationStatus,
          submission.contentStatus, JSON.stringify(submission.initialMetrics || {}),
          JSON.stringify(submission.latestMetrics || {}), JSON.stringify(submission.verificationEvidence || {}),
          submission.rejectionReason || null, submission.reviewedBy || null, submission.reviewedAt || null,
          submission.createdAt || null,
        ],
      );
      return mapSubmission(result.rows[0]);
    },

    async listSnapshots(submissionId) {
      const result = await query(
        `SELECT * FROM campaign_metrics_snapshots WHERE submission_id = $1 ORDER BY captured_at`,
        [submissionId],
      );
      return result.rows.map((row) => ({
        id: row.id, submissionId: row.submission_id, campaignId: row.campaign_id, workspaceId: row.workspace_id,
        capturedAt: row.captured_at, metrics: json(row.metrics), source: row.source,
      }));
    },
    async saveSnapshot(snapshot) {
      const result = await query(
        `INSERT INTO campaign_metrics_snapshots (id, submission_id, campaign_id, workspace_id, captured_at, metrics, source)
         VALUES ($1,$2,$3,$4,COALESCE($5, NOW()),$6::jsonb,$7) RETURNING *`,
        [
          snapshot.id, snapshot.submissionId, snapshot.campaignId, snapshot.workspaceId,
          snapshot.capturedAt || null, JSON.stringify(snapshot.metrics || {}), snapshot.source || "manual",
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id, submissionId: row.submission_id, campaignId: row.campaign_id, workspaceId: row.workspace_id,
        capturedAt: row.captured_at, metrics: json(row.metrics), source: row.source,
      };
    },

    async getFeaturesForClip(clipId) {
      const result = await query(`SELECT * FROM clip_features WHERE clip_id = $1`, [clipId]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, clipId: row.clip_id,
        features: json(row.features), createdAt: row.created_at, updatedAt: row.updated_at,
      };
    },
    async listFeatures(workspaceId, { campaignId = null } = {}) {
      const result = await query(
        `SELECT * FROM clip_features WHERE workspace_id = $1 AND ($2::uuid IS NULL OR campaign_id = $2)`,
        [workspaceId, campaignId],
      );
      return result.rows.map((row) => ({
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, clipId: row.clip_id,
        features: json(row.features), createdAt: row.created_at, updatedAt: row.updated_at,
      }));
    },
    async saveFeatures(record) {
      const result = await query(
        `INSERT INTO clip_features (id, workspace_id, campaign_id, clip_id, features, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,COALESCE($6, NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET features = EXCLUDED.features, updated_at = NOW()
         RETURNING *`,
        [
          record.id, record.workspaceId, record.campaignId || null, record.clipId,
          JSON.stringify(record.features || {}), record.createdAt || null,
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, clipId: row.clip_id,
        features: json(row.features), createdAt: row.created_at, updatedAt: row.updated_at,
      };
    },

    async listObservations(workspaceId, { creatorId = null, campaignId = null } = {}) {
      const result = await query(
        `SELECT * FROM performance_observations
         WHERE workspace_id = $1
           AND ($2::text IS NULL OR creator_id = $2)
           AND ($3::uuid IS NULL OR campaign_id = $3)
         ORDER BY created_at DESC`,
        [workspaceId, creatorId, campaignId],
      );
      return result.rows.map((row) => ({
        id: row.id, workspaceId: row.workspace_id, creatorId: row.creator_id, campaignId: row.campaign_id,
        clipId: row.clip_id, submissionId: row.submission_id,
        aggregatedLearningAuthorized: row.aggregated_learning_authorized,
        outcomes: json(row.outcomes), featureSnapshot: json(row.feature_snapshot), createdAt: row.created_at,
      }));
    },
    async saveObservation(observation) {
      const result = await query(
        `INSERT INTO performance_observations (
           id, workspace_id, creator_id, campaign_id, clip_id, submission_id,
           aggregated_learning_authorized, outcomes, feature_snapshot, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,COALESCE($10, NOW())) RETURNING *`,
        [
          observation.id, observation.workspaceId, observation.creatorId, observation.campaignId || null,
          observation.clipId || null, observation.submissionId || null,
          Boolean(observation.aggregatedLearningAuthorized), JSON.stringify(observation.outcomes || {}),
          JSON.stringify(observation.featureSnapshot || {}), observation.createdAt || null,
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id, workspaceId: row.workspace_id, creatorId: row.creator_id, campaignId: row.campaign_id,
        clipId: row.clip_id, submissionId: row.submission_id,
        aggregatedLearningAuthorized: row.aggregated_learning_authorized,
        outcomes: json(row.outcomes), featureSnapshot: json(row.feature_snapshot), createdAt: row.created_at,
      };
    },

    async listLedger(workspaceId, { campaignId = null, klipperId = null } = {}) {
      const result = await query(
        `SELECT * FROM campaign_ledger_entries
         WHERE workspace_id = $1
           AND ($2::uuid IS NULL OR campaign_id = $2)
           AND ($3::uuid IS NULL OR klipper_id = $3)
         ORDER BY created_at`,
        [workspaceId, campaignId, klipperId],
      );
      return result.rows.map(mapLedger);
    },
    async getLedgerEntry(workspaceId, entryId) {
      const result = await query(
        `SELECT * FROM campaign_ledger_entries WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, entryId],
      );
      return mapLedger(result.rows[0]);
    },
    async saveLedgerEntry(entry) {
      const result = await query(
        `INSERT INTO campaign_ledger_entries (
           id, campaign_id, workspace_id, klipper_id, submission_id, entry_type, payout_status,
           amount, currency, note, metadata, reviewed_by, reviewed_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,COALESCE($14, NOW()))
         ON CONFLICT (id) DO UPDATE SET
           payout_status = EXCLUDED.payout_status, note = EXCLUDED.note, metadata = EXCLUDED.metadata,
           reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at
         RETURNING *`,
        [
          entry.id, entry.campaignId, entry.workspaceId, entry.klipperId || null, entry.submissionId || null,
          entry.entryType, entry.payoutStatus || null, entry.amount, entry.currency || "USD", entry.note || "",
          JSON.stringify(entry.metadata || {}), entry.reviewedBy || null, entry.reviewedAt || null,
          entry.createdAt || null,
        ],
      );
      return mapLedger(result.rows[0]);
    },

    async listFlags(workspaceId, { campaignId = null, status = "open" } = {}) {
      const result = await query(
        `SELECT * FROM fraud_flags
         WHERE workspace_id = $1
           AND ($2::uuid IS NULL OR campaign_id = $2)
           AND ($3::text IS NULL OR status = $3)
         ORDER BY created_at DESC`,
        [workspaceId, campaignId, status],
      );
      return result.rows.map((row) => ({
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, submissionId: row.submission_id,
        userId: row.user_id, severity: row.severity, code: row.code, message: row.message,
        details: json(row.details), status: row.status, createdAt: row.created_at,
      }));
    },
    async saveFlag(flag) {
      const result = await query(
        `INSERT INTO fraud_flags (
           id, workspace_id, campaign_id, submission_id, user_id, severity, code, message, details, status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,COALESCE($11, NOW()))
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, details = EXCLUDED.details
         RETURNING *`,
        [
          flag.id, flag.workspaceId, flag.campaignId || null, flag.submissionId || null, flag.userId || null,
          flag.severity, flag.code, flag.message, JSON.stringify(flag.details || {}), flag.status || "open",
          flag.createdAt || null,
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, submissionId: row.submission_id,
        userId: row.user_id, severity: row.severity, code: row.code, message: row.message,
        details: json(row.details), status: row.status, createdAt: row.created_at,
      };
    },

    async listAudit(workspaceId, campaignId) {
      const result = await query(
        `SELECT * FROM campaign_audit_events
         WHERE workspace_id = $1 AND ($2::uuid IS NULL OR campaign_id = $2)
         ORDER BY created_at DESC`,
        [workspaceId, campaignId],
      );
      return result.rows.map((row) => ({
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, actorId: row.actor_id,
        action: row.action, entityType: row.entity_type, entityId: row.entity_id,
        details: json(row.details), createdAt: row.created_at,
      }));
    },
    async saveAudit(event) {
      const result = await query(
        `INSERT INTO campaign_audit_events (
           id, workspace_id, campaign_id, actor_id, action, entity_type, entity_id, details, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,COALESCE($9, NOW())) RETURNING *`,
        [
          event.id, event.workspaceId, event.campaignId || null, event.actorId, event.action,
          event.entityType, event.entityId || null, JSON.stringify(event.details || {}), event.createdAt || null,
        ],
      );
      const row = result.rows[0];
      return {
        id: row.id, workspaceId: row.workspace_id, campaignId: row.campaign_id, actorId: row.actor_id,
        action: row.action, entityType: row.entity_type, entityId: row.entity_id,
        details: json(row.details), createdAt: row.created_at,
      };
    },
  };
}
