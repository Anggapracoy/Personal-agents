CREATE TABLE IF NOT EXISTS agent_user_slots (
  owner_email text NOT NULL,
  slot integer NOT NULL CHECK (slot >= 0 AND slot < 4),
  token uuid NOT NULL,
  expires_at bigint NOT NULL,
  PRIMARY KEY (owner_email, slot)
);
