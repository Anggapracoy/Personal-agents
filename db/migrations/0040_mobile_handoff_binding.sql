ALTER TABLE mobile_auth_handoffs ADD COLUMN IF NOT EXISTS code_challenge text;
-- Old bearer-only handoffs are short-lived; invalidate them during upgrade.
DELETE FROM mobile_auth_handoffs WHERE code_challenge IS NULL;
