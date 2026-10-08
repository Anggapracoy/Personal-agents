-- A run is one conversation thread. Its turns live here as AI SDK ModelMessage
-- items. Planned steps are gone: the model drives its own loop.
CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);
CREATE INDEX IF NOT EXISTS agent_messages_run_idx ON agent_messages(run_id, seq);

-- agent_actions.step_id now holds the dispatch turn id, not a planned step.
ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_step_id_fkey;
DROP TABLE IF EXISTS agent_steps;
