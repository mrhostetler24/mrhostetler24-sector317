-- ============================================================
-- SECTOR 317 — SCHEMA PATCH: RUNS, SCORES & LEADERBOARD
-- Run this in Supabase SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. APP SETTINGS
--    Key/value store for owner-configurable values.
--    e.g. max_run_minutes, leaderboard_top_n
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT,           -- human-readable name shown in owner portal
  description TEXT,           -- tooltip / help text
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings
INSERT INTO app_settings (key, value, label, description) VALUES
  ('max_run_minutes',   '10',  'Max Run Time (minutes)',       'Maximum allowed time per structure run. Timer flashes red when reached.'),
  ('leaderboard_top_n', '5',   'Leaderboard Sessions (Top N)', 'Number of best session scores averaged for each player''s leaderboard rank.')
ON CONFLICT (key) DO NOTHING;

-- RLS: anyone can read settings (needed for public leaderboard page)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_public_read"  ON app_settings FOR SELECT USING (true);
CREATE POLICY "settings_admin_write"  ON app_settings FOR ALL    USING (auth.role() = 'authenticated');


-- ------------------------------------------------------------
-- 2. SESSION RUNS
--    One row per run (max 2 per reservation).
--    Score is calculated and stored permanently.
--    Session score = run_1.score + run_2.score (derived, never stored).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id      UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  run_number          SMALLINT NOT NULL CHECK (run_number IN (1, 2)),
  structure           TEXT NOT NULL CHECK (structure IN ('Alpha', 'Bravo')),

  -- Environmental settings
  visual              TEXT NOT NULL CHECK (visual IN ('V', 'C', 'S', 'CS', 'B'))  DEFAULT 'V',
  cranked             BOOLEAN NOT NULL DEFAULT FALSE,

  -- Outcomes (staff entry)
  targets_eliminated  BOOLEAN NOT NULL DEFAULT FALSE,
  objective_complete  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timer (elapsed seconds from stopwatch — no timestamps needed)
  elapsed_seconds     INTEGER,   -- NULL until Stop is tapped

  -- Calculated score (stored permanently)
  -- Formula: (100 - X) × multiplier - T
  --   X = 80 if objective failed, else 0
  --   multiplier = 1.0 + visual_add + cranked_add
  --     C=+0.2, S=+0.4, CS=+0.4, B=+0.8, L(cranked)=+0.2
  --   T = 15 if targets NOT eliminated, else 0
  score               INTEGER,   -- NULL until scored; floor 0

  -- Metadata
  scored_by           UUID REFERENCES users(id),   -- staff member who entered score
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Each reservation can only have run 1 and run 2 once
  UNIQUE (reservation_id, run_number)
);

-- Index for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_runs_reservation ON session_runs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_runs_score       ON session_runs(score) WHERE score IS NOT NULL;

-- RLS
ALTER TABLE session_runs ENABLE ROW LEVEL SECURITY;
-- Authenticated users can read all runs (needed for customer score history)
CREATE POLICY "runs_auth_read"   ON session_runs FOR SELECT USING (auth.role() = 'authenticated');
-- Staff/admin can insert and update
CREATE POLICY "runs_staff_write" ON session_runs FOR ALL    USING (auth.role() = 'authenticated');
-- Public (anon) can read scored runs only — for public leaderboard
CREATE POLICY "runs_public_read" ON session_runs FOR SELECT USING (score IS NOT NULL);


-- ------------------------------------------------------------
-- 3. LEADERBOARD VIEW
--    Computes rankings on the fly from session_runs.
--    Accessible to anon role for public embedding.
--
--    Logic:
--      - session_score = run_1.score + run_2.score  (only sessions with both runs scored)
--      - player leaderboard score = AVG of top N session scores per player
--      - "players" on a reservation = reservation.players JSONB array + the booking user
-- ------------------------------------------------------------

-- Helper: one row per (reservation, player_id) with that session's score
-- Sessions only count when BOTH runs are scored.
CREATE OR REPLACE VIEW v_session_scores AS
SELECT
  r.id              AS reservation_id,
  r.date            AS session_date,
  r.user_id         AS booker_id,
  r.players         AS players_json,           -- JSONB array of {id, name, phone}
  r.type_id         AS type_id,
  SUM(sr.score)     AS session_score,
  COUNT(sr.id)      AS run_count               -- must be 2 to count
FROM reservations r
JOIN session_runs sr ON sr.reservation_id = r.id
WHERE sr.score IS NOT NULL
GROUP BY r.id, r.date, r.user_id, r.players, r.type_id
HAVING COUNT(sr.id) = 2;                       -- only fully-scored sessions

-- Public leaderboard: one row per user with aggregate stats
-- Leaderboard score = AVG of top N session scores, where N = app_settings.leaderboard_top_n
CREATE OR REPLACE VIEW v_leaderboard AS
WITH settings AS (
  SELECT (value::int) AS top_n
  FROM   app_settings
  WHERE  key = 'leaderboard_top_n'
),
-- Expand each session to all players who participated
-- The booker (user_id) plus any players in the JSONB array
player_sessions AS (
  -- Booker themselves
  SELECT
    ss.reservation_id,
    ss.session_date,
    ss.session_score,
    ss.booker_id AS player_id
  FROM v_session_scores ss
  WHERE ss.booker_id IS NOT NULL

  UNION ALL

  -- Each player in the players_json array who has an id
  SELECT
    ss.reservation_id,
    ss.session_date,
    ss.session_score,
    (p->>'id')::uuid AS player_id
  FROM v_session_scores ss,
       jsonb_array_elements(ss.players_json) AS p
  WHERE p->>'id' IS NOT NULL
),
-- Rank each player's sessions by score descending
ranked AS (
  SELECT
    ps.player_id,
    ps.session_score,
    ROW_NUMBER() OVER (PARTITION BY ps.player_id ORDER BY ps.session_score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY ps.player_id) AS total_sessions
  FROM player_sessions ps
),
-- Keep only top N per player
top_n AS (
  SELECT r.*, s.top_n
  FROM   ranked r
  CROSS JOIN settings s
  WHERE  r.rn <= s.top_n
),
-- Aggregate
agg AS (
  SELECT
    player_id,
    ROUND(AVG(session_score), 1) AS leaderboard_score,
    MAX(session_score)           AS best_session,
    SUM(session_score)           AS total_score_all,
    COUNT(*)                     AS sessions_in_avg,
    (SELECT total_sessions FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_sessions_played
  FROM top_n
  GROUP BY player_id
)
SELECT
  a.player_id,
  u.name                    AS player_name,
  a.leaderboard_score,
  a.best_session,
  a.total_score_all,
  a.sessions_in_avg,
  a.total_sessions_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC) AS rank_all_time
FROM agg a
JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC;

-- Grant anon read on the views (safe — no PII beyond name, no financial data)
GRANT SELECT ON v_session_scores TO anon;
GRANT SELECT ON v_leaderboard    TO anon;
GRANT SELECT ON app_settings     TO anon;
GRANT SELECT ON session_runs     TO anon;


-- ------------------------------------------------------------
-- 4. TIME-BUCKETED LEADERBOARD VIEWS
--    Weekly, monthly, yearly — same logic, filtered by date.
-- ------------------------------------------------------------

-- WEEKLY (current ISO week)
CREATE OR REPLACE VIEW v_leaderboard_weekly AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
player_sessions AS (
  SELECT ss.reservation_id, ss.session_date, ss.session_score, ss.booker_id AS player_id
  FROM v_session_scores ss
  WHERE ss.booker_id IS NOT NULL
    AND DATE_TRUNC('week', ss.session_date::date) = DATE_TRUNC('week', CURRENT_DATE)
  UNION ALL
  SELECT ss.reservation_id, ss.session_date, ss.session_score, (p->>'id')::uuid AS player_id
  FROM v_session_scores ss, jsonb_array_elements(ss.players_json) AS p
  WHERE p->>'id' IS NOT NULL
    AND DATE_TRUNC('week', ss.session_date::date) = DATE_TRUNC('week', CURRENT_DATE)
),
ranked AS (
  SELECT player_id, session_score,
    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY session_score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY player_id) AS total_sessions
  FROM player_sessions
),
top_n AS (SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n),
agg AS (
  SELECT player_id,
    ROUND(AVG(session_score),1) AS leaderboard_score,
    MAX(session_score)          AS best_session,
    COUNT(*)                    AS sessions_in_avg,
    (SELECT total_sessions FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_sessions_played
  FROM top_n GROUP BY player_id
)
SELECT a.player_id, u.name AS player_name, a.leaderboard_score, a.best_session,
  a.sessions_in_avg, a.total_sessions_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC) AS rank_weekly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC;

-- MONTHLY (current calendar month)
CREATE OR REPLACE VIEW v_leaderboard_monthly AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
player_sessions AS (
  SELECT ss.reservation_id, ss.session_date, ss.session_score, ss.booker_id AS player_id
  FROM v_session_scores ss
  WHERE ss.booker_id IS NOT NULL
    AND DATE_TRUNC('month', ss.session_date::date) = DATE_TRUNC('month', CURRENT_DATE)
  UNION ALL
  SELECT ss.reservation_id, ss.session_date, ss.session_score, (p->>'id')::uuid AS player_id
  FROM v_session_scores ss, jsonb_array_elements(ss.players_json) AS p
  WHERE p->>'id' IS NOT NULL
    AND DATE_TRUNC('month', ss.session_date::date) = DATE_TRUNC('month', CURRENT_DATE)
),
ranked AS (
  SELECT player_id, session_score,
    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY session_score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY player_id) AS total_sessions
  FROM player_sessions
),
top_n AS (SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n),
agg AS (
  SELECT player_id,
    ROUND(AVG(session_score),1) AS leaderboard_score,
    MAX(session_score)          AS best_session,
    COUNT(*)                    AS sessions_in_avg,
    (SELECT total_sessions FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_sessions_played
  FROM top_n GROUP BY player_id
)
SELECT a.player_id, u.name AS player_name, a.leaderboard_score, a.best_session,
  a.sessions_in_avg, a.total_sessions_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC) AS rank_monthly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC;

-- YEARLY (current calendar year)
CREATE OR REPLACE VIEW v_leaderboard_yearly AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
player_sessions AS (
  SELECT ss.reservation_id, ss.session_date, ss.session_score, ss.booker_id AS player_id
  FROM v_session_scores ss
  WHERE ss.booker_id IS NOT NULL
    AND DATE_TRUNC('year', ss.session_date::date) = DATE_TRUNC('year', CURRENT_DATE)
  UNION ALL
  SELECT ss.reservation_id, ss.session_date, ss.session_score, (p->>'id')::uuid AS player_id
  FROM v_session_scores ss, jsonb_array_elements(ss.players_json) AS p
  WHERE p->>'id' IS NOT NULL
    AND DATE_TRUNC('year', ss.session_date::date) = DATE_TRUNC('year', CURRENT_DATE)
),
ranked AS (
  SELECT player_id, session_score,
    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY session_score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY player_id) AS total_sessions
  FROM player_sessions
),
top_n AS (SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n),
agg AS (
  SELECT player_id,
    ROUND(AVG(session_score),1) AS leaderboard_score,
    MAX(session_score)          AS best_session,
    COUNT(*)                    AS sessions_in_avg,
    (SELECT total_sessions FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_sessions_played
  FROM top_n GROUP BY player_id
)
SELECT a.player_id, u.name AS player_name, a.leaderboard_score, a.best_session,
  a.sessions_in_avg, a.total_sessions_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC) AS rank_yearly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC;

-- Grant anon read on time-bucketed views
GRANT SELECT ON v_leaderboard_weekly  TO anon;
GRANT SELECT ON v_leaderboard_monthly TO anon;
GRANT SELECT ON v_leaderboard_yearly  TO anon;


-- ------------------------------------------------------------
-- 5. RESERVATION: add paid flag and run count helper column
-- ------------------------------------------------------------
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast "today's active sessions" query used by mission board
CREATE INDEX IF NOT EXISTS idx_reservations_date_status
  ON reservations(date, status);


-- ------------------------------------------------------------
-- 6. UPDATED_AT trigger for session_runs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_runs_updated_at ON session_runs;
CREATE TRIGGER trg_runs_updated_at
  BEFORE UPDATE ON session_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- SUMMARY OF SCORE FORMULA (for reference / auditing)
-- ------------------------------------------------------------
-- Per run:
--   multiplier = 1.0
--              + CASE visual WHEN 'C'  THEN 0.2
--                            WHEN 'S'  THEN 0.4
--                            WHEN 'CS' THEN 0.4
--                            WHEN 'B'  THEN 0.8
--                            ELSE           0.0 END
--              + CASE WHEN cranked THEN 0.2 ELSE 0.0 END
--   X = CASE WHEN objective_complete THEN 0 ELSE 80 END
--   T = CASE WHEN targets_eliminated THEN 0 ELSE 15 END
--   score = GREATEST(0, ROUND((100 - X) * multiplier - T))
--
-- Session score (derived, NOT stored):
--   session_score = run_1.score + run_2.score
--
-- Player leaderboard score (derived, NOT stored):
--   AVG of top N session scores where N = app_settings.leaderboard_top_n
-- ------------------------------------------------------------
