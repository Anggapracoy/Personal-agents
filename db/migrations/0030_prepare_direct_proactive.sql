-- PRE-DEPLOY: compatible with the old delivery worker and the direct publisher.
-- The new code no longer reads or chooses a tier. Default bridges the rollout
-- until post-deploy migration 0031 removes the retired field entirely.
ALTER TABLE proactive_candidates ALTER COLUMN tier SET DEFAULT 'now';
