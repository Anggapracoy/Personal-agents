CREATE TYPE agent_run_status AS ENUM ('planning', 'running', 'awaiting_approval', 'paused', 'done', 'failed', 'cancelled');
CREATE TYPE agent_step_status AS ENUM ('pending', 'running', 'done', 'failed', 'skipped');
CREATE TYPE agent_action_status AS ENUM ('proposed', 'approved', 'rejected', 'executed', 'failed');
CREATE TYPE agent_tool_risk AS ENUM ('read', 'write_reversible', 'write_external');

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  decision_id text,
  category text NOT NULL,
  request text NOT NULL,
  title text NOT NULL DEFAULT 'Planning action',
  response text NOT NULL DEFAULT '',
  status agent_run_status NOT NULL DEFAULT 'planning',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  status agent_step_status NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(run_id, idx)
);

CREATE TABLE agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES agent_steps(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  risk agent_tool_risk NOT NULL,
  preview text NOT NULL,
  input jsonb NOT NULL,
  result jsonb,
  status agent_action_status NOT NULL DEFAULT 'proposed',
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  action_id uuid REFERENCES agent_actions(id) ON DELETE SET NULL,
  name text NOT NULL,
  mime_type text NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_runs_user_status_idx ON agent_runs(user_id, status, updated_at DESC);
CREATE INDEX agent_steps_run_idx ON agent_steps(run_id, idx);
CREATE INDEX agent_actions_pending_idx ON agent_actions(run_id, status, created_at DESC);
CREATE INDEX agent_artifacts_run_idx ON agent_artifacts(run_id, created_at DESC);
