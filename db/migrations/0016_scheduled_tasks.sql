-- User-authored reminders and recurring agent work, attached to a conversation.
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','completed')),
  version integer NOT NULL DEFAULT 1,
  next_run_at timestamptz,
  last_observation text,
  last_notified_observation text,
  creation_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_email, creation_key)
);
CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx ON scheduled_tasks(next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS scheduled_tasks_owner_idx ON scheduled_tasks(owner_email, run_id);
CREATE TABLE IF NOT EXISTS scheduled_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  schedule_version integer NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatched','completed','cancelled','failed')),
  previous_run_state jsonb,
  check_result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (schedule_id, schedule_version, due_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_occurrences_active_idx ON scheduled_occurrences(schedule_id) WHERE status IN ('queued','dispatched');
-- Receipts dedupe within one scheduled occurrence, including approvals/retries.
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS scope_id text;
