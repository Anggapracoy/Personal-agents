-- POST-DEPLOY ONLY: older application versions do not accept gpt-6-sol.
-- The marker makes reruns safe and preserves subsequent model choices.
BEGIN;
WITH activation AS (
  INSERT INTO app_feature_flags (key, value, revision, updated_by)
  VALUES ('agent_model_sol6_rollout', '{"applied":true}'::jsonb, 0, 'migration-0023')
  ON CONFLICT (key) DO NOTHING
  RETURNING key
)
INSERT INTO app_feature_flags (key, value, revision, updated_by)
SELECT 'agent_model', '{"modelId":"gpt-6-sol","reasoningEffort":"medium"}'::jsonb, 0, 'migration-0023'
FROM activation
ON CONFLICT (key) DO UPDATE SET value=excluded.value,
  revision=app_feature_flags.revision+1, updated_by=excluded.updated_by, updated_at=now();
COMMIT;
