-- Remove obsolete telemetry from installations that used an earlier source version.
-- Conversation/task tables are deliberately preserved.
DROP TABLE IF EXISTS product_analytics_events;
DROP TABLE IF EXISTS product_analytics_subjects;
DROP TABLE IF EXISTS agent_run_diagnostics;
UPDATE app_feature_flags
SET value = jsonb_set(value, '{mode}', '"selected"'::jsonb)
WHERE value->>'mode' = 'admin';
