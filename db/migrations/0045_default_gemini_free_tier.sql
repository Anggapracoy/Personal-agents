-- Switch only the deployment's original Sol default to Gemini Flash.
-- Preserve a model choice changed by an operator after migration 0023.
UPDATE app_feature_flags
SET value = '{"modelId":"gemini-3.7-flash","provider":"google","reasoningEffort":"medium"}'::jsonb,
    revision = revision + 1,
    updated_by = 'migration-0045',
    updated_at = now()
WHERE key = 'agent_model'
  AND updated_by = 'migration-0023'
  AND value->>'modelId' = 'gpt-6-sol';
