CREATE TABLE IF NOT EXISTS user_profile_photos (
  owner_email text PRIMARY KEY,
  image text NOT NULL CHECK (length(image) <= 350000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
