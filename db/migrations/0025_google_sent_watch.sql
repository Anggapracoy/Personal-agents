-- Versioned so existing inbox-only watches are renewed on the next watch pass.
ALTER TABLE google_source_watches ADD COLUMN IF NOT EXISTS gmail_watch_version integer NOT NULL DEFAULT 1;
