-- Run this in Supabase SQL Editor to add email and auth_id columns
-- These are needed for OAuth login matching

ALTER TABLE users ADD COLUMN IF NOT EXISTS email   text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
