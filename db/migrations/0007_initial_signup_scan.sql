ALTER TABLE mobile_user_states
  ADD COLUMN IF NOT EXISTS initial_scan_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_scan_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_scan_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS mobile_user_states_initial_scan_idx
  ON mobile_user_states (initial_scan_requested_at)
  WHERE initial_scan_requested_at IS NOT NULL AND initial_scan_completed_at IS NULL;
