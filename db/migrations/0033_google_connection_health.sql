ALTER TABLE public.connected_google_accounts
  ADD COLUMN IF NOT EXISTS reconnect_required_at timestamptz;
