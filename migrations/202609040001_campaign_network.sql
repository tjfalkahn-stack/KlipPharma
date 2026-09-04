BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  campaign_type TEXT NOT NULL DEFAULT 'clip_distribution',
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'READY', 'LIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  budget NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  target_views BIGINT NOT NULL DEFAULT 0 CHECK (target_views >= 0),
  target_posts INTEGER NOT NULL DEFAULT 0 CHECK (target_posts >= 0),
  target_platforms TEXT[] NOT NULL DEFAULT '{}',
  allowed_regions TEXT[] NOT NULL DEFAULT '{}',
  campaign_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  prohibited_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  payout_model TEXT NOT NULL DEFAULT 'NONE'
    CHECK (payout_model IN ('CPM', 'FLAT_PER_POST', 'HYBRID', 'NONE')),
  payout_rate NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (payout_rate >= 0),
  payout_cap NUMERIC(14,2) CHECK (payout_cap IS NULL OR payout_cap >= 0),
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  source_media_ids TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaigns_workspace_status_idx
  ON campaigns(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx
  ON campaigns(workspace_id, creator_id);

CREATE TABLE IF NOT EXISTS campaign_rights (
  campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  content_ownership_declaration TEXT NOT NULL DEFAULT '',
  usage_permissions TEXT NOT NULL DEFAULT '',
  music_audio_rights_declaration TEXT NOT NULL DEFAULT '',
  allowed_editing_rules TEXT NOT NULL DEFAULT '',
  brand_guidelines TEXT NOT NULL DEFAULT '',
  prohibited_uses TEXT NOT NULL DEFAULT '',
  campaign_expiration TEXT NOT NULL DEFAULT '',
  content_takedown_procedure TEXT NOT NULL DEFAULT '',
  disclosure_requirements TEXT NOT NULL DEFAULT '',
  territory_restrictions TEXT NOT NULL DEFAULT '',
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  rights_version INTEGER NOT NULL DEFAULT 1 CHECK (rights_version >= 1),
  content_hash TEXT,
  acknowledged_version INTEGER,
  acknowledged_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS klipper_profiles (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id UUID,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL,
  social_handles JSONB NOT NULL DEFAULT '[]'::jsonb,
  connected_platforms TEXT[] NOT NULL DEFAULT '{}',
  categories TEXT[] NOT NULL DEFAULT '{}',
  location_region TEXT,
  campaign_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_submissions INTEGER NOT NULL DEFAULT 0 CHECK (approved_submissions >= 0),
  rejected_submissions INTEGER NOT NULL DEFAULT 0 CHECK (rejected_submissions >= 0),
  verified_views BIGINT NOT NULL DEFAULT 0 CHECK (verified_views >= 0),
  earnings_calculated NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (earnings_calculated >= 0),
  reliability_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS klipper_profiles_user_idx
  ON klipper_profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS klipper_profiles_username_idx
  ON klipper_profiles(lower(username));

CREATE TABLE IF NOT EXISTS klipper_platform_metrics (
  id UUID PRIMARY KEY,
  klipper_id UUID NOT NULL REFERENCES klipper_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT,
  follower_count BIGINT,
  metrics_source TEXT NOT NULL,
  metrics_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_participants (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  klipper_id UUID REFERENCES klipper_profiles(id) ON DELETE SET NULL,
  role TEXT NOT NULL
    CHECK (role IN ('CAMPAIGN_OWNER', 'MANAGER', 'EDITOR', 'KLIPPER', 'REVIEWER', 'ADMIN', 'VIEWER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED', 'APPLIED', 'ACTIVE', 'REJECTED', 'REMOVED')),
  region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS campaign_participants_user_idx
  ON campaign_participants(user_id, status);
CREATE INDEX IF NOT EXISTS campaign_participants_campaign_idx
  ON campaign_participants(campaign_id, role, status);

CREATE TABLE IF NOT EXISTS campaign_clips (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  source_project_id TEXT,
  source_media_id TEXT,
  source_clip_id TEXT,
  source_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration NUMERIC(10,3),
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  transcript TEXT NOT NULL DEFAULT '',
  caption_package JSONB NOT NULL DEFAULT '{}'::jsonb,
  hook TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  thumbnail TEXT,
  processing_version TEXT NOT NULL DEFAULT 'autoklip-v1',
  content_fingerprint TEXT,
  approval_status TEXT NOT NULL DEFAULT 'CANDIDATE'
    CHECK (approval_status IN ('CANDIDATE', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  performance_score INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_clips_campaign_idx
  ON campaign_clips(campaign_id, approval_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_clips_source_uidx
  ON campaign_clips(campaign_id, source_project_id, source_clip_id)
  WHERE source_project_id IS NOT NULL AND source_clip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_submissions (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  klipper_id UUID REFERENCES klipper_profiles(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  clip_id UUID REFERENCES campaign_clips(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  public_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'VERIFYING', 'VERIFIED', 'REJECTED', 'FLAGGED')),
  verification_version INTEGER NOT NULL DEFAULT 1 CHECK (verification_version >= 1),
  content_status TEXT NOT NULL DEFAULT 'submitted',
  initial_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  latest_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_submissions_workspace_url_idx
  ON campaign_submissions(workspace_id, canonical_url);
CREATE INDEX IF NOT EXISTS campaign_submissions_campaign_idx
  ON campaign_submissions(campaign_id, verification_status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS campaign_submissions_user_idx
  ON campaign_submissions(user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS campaign_metrics_snapshots (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES campaign_submissions(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS campaign_metrics_submission_idx
  ON campaign_metrics_snapshots(submission_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS clip_features (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  clip_id UUID REFERENCES campaign_clips(id) ON DELETE CASCADE,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS clip_features_clip_uidx
  ON clip_features(clip_id);

CREATE INDEX IF NOT EXISTS clip_features_workspace_idx
  ON clip_features(workspace_id, campaign_id);

CREATE TABLE IF NOT EXISTS performance_observations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  creator_id TEXT NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  clip_id UUID REFERENCES campaign_clips(id) ON DELETE SET NULL,
  submission_id UUID REFERENCES campaign_submissions(id) ON DELETE SET NULL,
  verification_version INTEGER NOT NULL DEFAULT 1 CHECK (verification_version >= 1),
  aggregated_learning_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  outcomes JSONB NOT NULL DEFAULT '{}'::jsonb,
  feature_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS performance_observations_workspace_idx
  ON performance_observations(workspace_id, creator_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS performance_observations_submission_version_uidx
  ON performance_observations(submission_id, verification_version);

CREATE TABLE IF NOT EXISTS campaign_ledger_entries (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  klipper_id UUID REFERENCES klipper_profiles(id) ON DELETE SET NULL,
  submission_id UUID REFERENCES campaign_submissions(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN (
      'budget',
      'budget_adjustment',
      'reservation',
      'eligible_payout',
      'approved_payout',
      'rejected_payout',
      'platform_fee',
      'service_fee',
      'campaign_revenue',
      'klippharma_revenue'
    )),
  payout_status TEXT
    CHECK (payout_status IS NULL OR payout_status IN (
      'CALCULATED', 'PENDING_REVIEW', 'APPROVED', 'HELD', 'PAID', 'REJECTED'
    )),
  reservation_status TEXT
    CHECK (reservation_status IS NULL OR reservation_status IN ('ACTIVE', 'RELEASED', 'CONVERTED')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_ledger_campaign_idx
  ON campaign_ledger_entries(campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ledger_eligible_submission_uidx
  ON campaign_ledger_entries(submission_id)
  WHERE entry_type = 'eligible_payout' AND submission_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ledger_active_reservation_uidx
  ON campaign_ledger_entries(submission_id)
  WHERE entry_type = 'reservation' AND reservation_status = 'ACTIVE' AND submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES campaign_submissions(id) ON DELETE SET NULL,
  user_id TEXT,
  severity TEXT NOT NULL DEFAULT 'review'
    CHECK (severity IN ('info', 'review', 'hold')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'cleared', 'upheld')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fraud_flags_campaign_idx
  ON fraud_flags(campaign_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  campaign_id UUID,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_audit_campaign_idx
  ON campaign_audit_events(campaign_id, created_at DESC);

COMMIT;
