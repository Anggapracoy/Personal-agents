-- Durable automatic waits are separate from user-authored recurring schedules.
CREATE TABLE IF NOT EXISTS agent_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  creation_key text NOT NULL UNIQUE,
  definition jsonb NOT NULL,
  baseline jsonb,
  connection_id uuid,
  wake_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','waiting','ready','dispatched','cancelled')),
  wake_reason jsonb,
  check_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_pauses_active_idx ON agent_pauses(run_id) WHERE status IN ('pending','waiting','ready');
CREATE INDEX IF NOT EXISTS agent_pauses_due_idx ON agent_pauses(wake_at) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS agent_pauses_connection_idx ON agent_pauses(connection_id) WHERE status='waiting';
