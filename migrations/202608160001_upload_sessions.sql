BEGIN;

CREATE TABLE IF NOT EXISTS upload_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  batch_id UUID NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN (
      'preparing',
      'ready_to_upload',
      'uploading',
      'paused',
      'interrupted',
      'uploaded',
      'queued_for_processing',
      'processing',
      'ready',
      'failed',
      'cancelled'
    )),
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS upload_sessions_user_status_idx
  ON upload_sessions(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS upload_sessions_batch_idx
  ON upload_sessions(batch_id);

CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx
  ON upload_sessions(expires_at)
  WHERE status IN ('preparing', 'ready_to_upload', 'uploading', 'paused', 'interrupted', 'failed', 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS upload_sessions_user_idempotency_idx
  ON upload_sessions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS processing_lease_owner TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS processing_lease_expires_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS processing_claimed_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_processing_claim_idx
  ON projects(status, processing_lease_expires_at)
  WHERE status IN ('queued', 'processing');

COMMIT;
