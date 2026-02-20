-- ============================================================
-- SECTOR 317 — SCHEMA PATCH: USER LEADERBOARD NAME
-- Run in Supabase SQL Editor AFTER schema-runs-scores-leaderboard.sql
-- ============================================================

-- 1. Add leaderboard_name column to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS leaderboard_name TEXT
  CHECK (
    leaderboard_name IS NULL OR (
      LENGTH(TRIM(leaderboard_name)) BETWEEN 2 AND 24
      AND TRIM(leaderboard_name) ~ '^[a-zA-Z0-9 _\-\.]+$'
    )
  );

-- Index for leaderboard queries (optional but clean)
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_name ON users(leaderboard_name) WHERE leaderboard_name IS NOT NULL;

-- 2. Update all leaderboard views to show leaderboard_name when set,
--    falling back to real name. COALESCE(leaderboard_name, name)
--    This means players who set a callsign show that; others show real name.

-- Drop and recreate the session scores view (no name change needed here, just runs)
-- The leaderboard views already use COALESCE via schema-leaderboard-v2.sql
-- Run schema-leaderboard-v2.sql after this file to pick up both changes.

-- 3. Verify
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'leaderboard_name';
