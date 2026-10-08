-- POST-DEPLOY ONLY: run drain-legacy-proactive.ts first, confirm production and
-- Inngest registration, and let old delivery-worker invocations finish.
-- No source/discovery history, user mutes, or cards are deleted.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM proactive_candidates WHERE status='pending') THEN
    RAISE EXCEPTION 'Drain legacy proactive candidates before removing delivery gates';
  END IF;
END $$;
DROP TABLE IF EXISTS proactive_deliveries;
DROP TABLE IF EXISTS proactive_moments;
ALTER TABLE proactive_candidates DROP COLUMN IF EXISTS tier, DROP COLUMN IF EXISTS deliver_after, DROP COLUMN IF EXISTS pushed;
CREATE INDEX IF NOT EXISTS proactive_candidates_owner_status_idx ON proactive_candidates(owner_email,status);
ALTER TABLE proactive_preferences DROP COLUMN IF EXISTS quiet_start, DROP COLUMN IF EXISTS quiet_end,
  DROP COLUMN IF EXISTS max_buzzes, DROP COLUMN IF EXISTS last_wake_at, DROP COLUMN IF EXISTS upcoming_birthdays;
COMMIT;
