-- These tombstones deliberately outlive account deletion.
CREATE TABLE IF NOT EXISTS auth_revocations (
  key text PRIMARY KEY,
  revoked_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS api_usage_buckets (
  owner_email text NOT NULL,
  bucket text NOT NULL,
  window_start bigint NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (owner_email, bucket)
);
