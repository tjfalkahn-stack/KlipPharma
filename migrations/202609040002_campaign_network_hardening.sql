BEGIN;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS unused_hardening_marker BOOLEAN;
ALTER TABLE campaigns DROP COLUMN IF EXISTS unused_hardening_marker;

ALTER TABLE campaign_rights
  ADD COLUMN IF NOT EXISTS rights_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS acknowledged_version INTEGER,
  ADD COLUMN IF NOT EXISTS acknowledged_hash TEXT;

ALTER TABLE campaign_clips
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;

ALTER TABLE campaign_submissions
  ADD COLUMN IF NOT EXISTS verification_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE performance_observations
  ADD COLUMN IF NOT EXISTS verification_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE campaign_ledger_entries
  ADD COLUMN IF NOT EXISTS reservation_status TEXT;

ALTER TABLE campaign_participants DROP CONSTRAINT IF EXISTS campaign_participants_role_check;
ALTER TABLE campaign_participants
  ADD CONSTRAINT campaign_participants_role_check
  CHECK (role IN ('CAMPAIGN_OWNER', 'MANAGER', 'EDITOR', 'KLIPPER', 'REVIEWER', 'ADMIN', 'VIEWER'));

ALTER TABLE campaign_ledger_entries DROP CONSTRAINT IF EXISTS campaign_ledger_entries_entry_type_check;
ALTER TABLE campaign_ledger_entries
  ADD CONSTRAINT campaign_ledger_entries_entry_type_check
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
  ));

ALTER TABLE campaign_ledger_entries DROP CONSTRAINT IF EXISTS campaign_ledger_entries_reservation_status_check;
ALTER TABLE campaign_ledger_entries
  ADD CONSTRAINT campaign_ledger_entries_reservation_status_check
  CHECK (reservation_status IS NULL OR reservation_status IN ('ACTIVE', 'RELEASED', 'CONVERTED'));

DROP INDEX IF EXISTS campaign_submissions_url_idx;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_submissions_workspace_url_idx
  ON campaign_submissions(workspace_id, canonical_url);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_clips_source_uidx
  ON campaign_clips(campaign_id, source_project_id, source_clip_id)
  WHERE source_project_id IS NOT NULL AND source_clip_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clip_features_clip_uidx
  ON clip_features(clip_id);
CREATE UNIQUE INDEX IF NOT EXISTS performance_observations_submission_version_uidx
  ON performance_observations(submission_id, verification_version);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ledger_eligible_submission_uidx
  ON campaign_ledger_entries(submission_id)
  WHERE entry_type = 'eligible_payout' AND submission_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ledger_active_reservation_uidx
  ON campaign_ledger_entries(submission_id)
  WHERE entry_type = 'reservation' AND reservation_status = 'ACTIVE' AND submission_id IS NOT NULL;

COMMIT;
