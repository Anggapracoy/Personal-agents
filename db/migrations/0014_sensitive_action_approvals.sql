CREATE TABLE IF NOT EXISTS agent_approval_preferences (
  owner_email text NOT NULL,
  category text NOT NULL CHECK (category IN ('email_send', 'purchase')),
  always_approve boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_email, category)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_approval_preferences_owner_category_uidx
  ON agent_approval_preferences (owner_email, category);
