-- Durable personal leads, independently of chat recency and notification delivery.
CREATE TABLE IF NOT EXISTS proactive_opportunities (
 owner_email text NOT NULL,
 topic_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('goal','plan','interest','routine')),
 status text NOT NULL CHECK(status IN ('open','waiting','fulfilled','declined','expired')),
 title text NOT NULL,
 summary text NOT NULL,
 category text NOT NULL,
 evidence jsonb NOT NULL,
 evidence_key text NOT NULL,
 source_run_ids jsonb NOT NULL DEFAULT '[]',
 next_check_at timestamptz,
 valid_until timestamptz,
 required_change text NOT NULL,
 last_checked_at timestamptz,
 last_observation jsonb,
 last_offered_at timestamptz,
 last_offer jsonb,
 closed_at timestamptz,
 revision int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_email,topic_key)
);
CREATE INDEX IF NOT EXISTS proactive_opportunities_due ON proactive_opportunities(owner_email,next_check_at) WHERE status IN ('open','waiting');
CREATE TABLE IF NOT EXISTS proactive_opportunity_sources (
 owner_email text NOT NULL, run_id uuid NOT NULL, source_updated_at timestamptz NOT NULL,
 classified_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_email,run_id)
);
CREATE TABLE IF NOT EXISTS proactive_opportunity_refreshes (
 owner_email text PRIMARY KEY, lease_until timestamptz NOT NULL, lease_token uuid NOT NULL
);
