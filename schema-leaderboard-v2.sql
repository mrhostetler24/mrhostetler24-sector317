-- ============================================================
-- SECTOR 317 — LEADERBOARD PATCH v2
-- Updates leaderboard views:
--   - Average mode: top 50 individual RUN scores per player
--   - Cumulative mode: sum of ALL run scores per player
--   - Time is tiebreaker (lower avg time = higher rank when scores tie)
-- Run in Supabase SQL Editor
-- ============================================================

-- Update leaderboard_top_n setting to 50
UPDATE app_settings SET value = '50', label = 'Leaderboard Runs (Top N)'
WHERE key = 'leaderboard_top_n';

-- ============================================================
-- HELPER: player_runs
-- One row per (player, run) — expands reservation players to individual run scores
-- ============================================================
CREATE OR REPLACE VIEW v_player_runs AS
-- Booker's runs
SELECT
  r.id               AS reservation_id,
  r.date             AS run_date,
  r.user_id          AS player_id,
  sr.id              AS run_id,
  sr.score,
  sr.elapsed_seconds,
  sr.run_number,
  sr.structure
FROM reservations r
JOIN session_runs sr ON sr.reservation_id = r.id
WHERE sr.score IS NOT NULL
  AND r.user_id IS NOT NULL

UNION ALL

-- Each player in players_json array
SELECT
  r.id               AS reservation_id,
  r.date             AS run_date,
  (p->>'id')::uuid   AS player_id,
  sr.id              AS run_id,
  sr.score,
  sr.elapsed_seconds,
  sr.run_number,
  sr.structure
FROM reservations r
JOIN session_runs sr ON sr.reservation_id = r.id,
     jsonb_array_elements(r.players) AS p
WHERE sr.score IS NOT NULL
  AND p->>'id' IS NOT NULL;

GRANT SELECT ON v_player_runs TO anon;

-- ============================================================
-- ALL-TIME: AVERAGE mode (top 50 runs, time as tiebreaker)
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
ranked AS (
  SELECT
    pr.player_id,
    pr.score,
    pr.elapsed_seconds,
    ROW_NUMBER() OVER (PARTITION BY pr.player_id ORDER BY pr.score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY pr.player_id) AS total_runs
  FROM v_player_runs pr
),
top_n AS (
  SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n
),
agg AS (
  SELECT
    player_id,
    ROUND(AVG(score), 1)                                          AS leaderboard_score,
    MAX(score)                                                    AS best_run,
    COUNT(*)                                                      AS runs_in_avg,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)        AS best_seconds,
    (SELECT total_runs FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_runs_played
  FROM top_n GROUP BY player_id
)
SELECT
  a.player_id,
  COALESCE(u.leaderboard_name, u.name) AS player_name,
  a.leaderboard_score,
  a.best_run,
  a.runs_in_avg,
  a.avg_seconds,
  a.best_seconds,
  a.total_runs_played,
  RANK() OVER (
    ORDER BY a.leaderboard_score DESC,
             a.avg_seconds ASC NULLS LAST   -- time is tiebreaker
  ) AS rank_all_time
FROM agg a
JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST;

-- ============================================================
-- ALL-TIME: CUMULATIVE mode (sum of ALL runs, time as tiebreaker)
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_cumulative AS
WITH agg AS (
  SELECT
    player_id,
    SUM(score)                                                    AS total_score,
    MAX(score)                                                    AS best_run,
    COUNT(*)                                                      AS total_runs,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)        AS best_seconds
  FROM v_player_runs
  GROUP BY player_id
)
SELECT
  a.player_id,
  COALESCE(u.leaderboard_name, u.name) AS player_name,
  a.total_score AS leaderboard_score,
  a.best_run,
  a.total_runs,
  a.avg_seconds,
  a.best_seconds,
  RANK() OVER (
    ORDER BY a.total_score DESC,
             a.avg_seconds ASC NULLS LAST
  ) AS rank_all_time
FROM agg a
JOIN users u ON u.id = a.player_id
ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST;

GRANT SELECT ON v_leaderboard_cumulative TO anon;

-- ============================================================
-- WEEKLY AVERAGE
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_weekly AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
ranked AS (
  SELECT
    pr.player_id, pr.score, pr.elapsed_seconds,
    ROW_NUMBER() OVER (PARTITION BY pr.player_id ORDER BY pr.score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY pr.player_id) AS total_runs
  FROM v_player_runs pr
  WHERE DATE_TRUNC('week', pr.run_date::date) = DATE_TRUNC('week', CURRENT_DATE)
),
top_n AS (SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n),
agg AS (
  SELECT player_id,
    ROUND(AVG(score),1) AS leaderboard_score, MAX(score) AS best_run,
    COUNT(*) AS runs_in_avg,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL) AS best_seconds,
    (SELECT total_runs FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_runs_played
  FROM top_n GROUP BY player_id
)
SELECT a.player_id, COALESCE(u.leaderboard_name, u.name) AS player_name, a.leaderboard_score, a.best_run,
  a.runs_in_avg, a.avg_seconds, a.best_seconds, a.total_runs_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST) AS rank_weekly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST;

-- ============================================================
-- WEEKLY CUMULATIVE
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_weekly_cumulative AS
WITH agg AS (
  SELECT player_id,
    SUM(score) AS total_score, MAX(score) AS best_run, COUNT(*) AS total_runs,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL) AS best_seconds
  FROM v_player_runs
  WHERE DATE_TRUNC('week', run_date::date) = DATE_TRUNC('week', CURRENT_DATE)
  GROUP BY player_id
)
SELECT a.player_id, COALESCE(u.leaderboard_name, u.name) AS player_name, a.total_score AS leaderboard_score,
  a.best_run, a.total_runs, a.avg_seconds, a.best_seconds,
  RANK() OVER (ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST) AS rank_weekly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST;

GRANT SELECT ON v_leaderboard_weekly          TO anon;
GRANT SELECT ON v_leaderboard_weekly_cumulative TO anon;

-- ============================================================
-- MONTHLY AVERAGE
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_monthly AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
ranked AS (
  SELECT
    pr.player_id, pr.score, pr.elapsed_seconds,
    ROW_NUMBER() OVER (PARTITION BY pr.player_id ORDER BY pr.score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY pr.player_id) AS total_runs
  FROM v_player_runs pr
  WHERE DATE_TRUNC('month', pr.run_date::date) = DATE_TRUNC('month', CURRENT_DATE)
),
top_n AS (SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n),
agg AS (
  SELECT player_id,
    ROUND(AVG(score),1) AS leaderboard_score, MAX(score) AS best_run,
    COUNT(*) AS runs_in_avg,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL) AS best_seconds,
    (SELECT total_runs FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_runs_played
  FROM top_n GROUP BY player_id
)
SELECT a.player_id, COALESCE(u.leaderboard_name, u.name) AS player_name, a.leaderboard_score, a.best_run,
  a.runs_in_avg, a.avg_seconds, a.best_seconds, a.total_runs_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST) AS rank_monthly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST;

-- ============================================================
-- MONTHLY CUMULATIVE
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_monthly_cumulative AS
WITH agg AS (
  SELECT player_id,
    SUM(score) AS total_score, MAX(score) AS best_run, COUNT(*) AS total_runs,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL) AS best_seconds
  FROM v_player_runs
  WHERE DATE_TRUNC('month', run_date::date) = DATE_TRUNC('month', CURRENT_DATE)
  GROUP BY player_id
)
SELECT a.player_id, COALESCE(u.leaderboard_name, u.name) AS player_name, a.total_score AS leaderboard_score,
  a.best_run, a.total_runs, a.avg_seconds, a.best_seconds,
  RANK() OVER (ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST) AS rank_monthly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST;

GRANT SELECT ON v_leaderboard_monthly           TO anon;
GRANT SELECT ON v_leaderboard_monthly_cumulative TO anon;

-- ============================================================
-- YEARLY AVERAGE
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_yearly AS
WITH settings AS (
  SELECT (value::int) AS top_n FROM app_settings WHERE key = 'leaderboard_top_n'
),
ranked AS (
  SELECT
    pr.player_id, pr.score, pr.elapsed_seconds,
    ROW_NUMBER() OVER (PARTITION BY pr.player_id ORDER BY pr.score DESC) AS rn,
    COUNT(*) OVER (PARTITION BY pr.player_id) AS total_runs
  FROM v_player_runs pr
  WHERE DATE_TRUNC('year', pr.run_date::date) = DATE_TRUNC('year', CURRENT_DATE)
),
top_n AS (SELECT r.*, s.top_n FROM ranked r CROSS JOIN settings s WHERE r.rn <= s.top_n),
agg AS (
  SELECT player_id,
    ROUND(AVG(score),1) AS leaderboard_score, MAX(score) AS best_run,
    COUNT(*) AS runs_in_avg,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL) AS best_seconds,
    (SELECT total_runs FROM ranked WHERE player_id = top_n.player_id LIMIT 1) AS total_runs_played
  FROM top_n GROUP BY player_id
)
SELECT a.player_id, COALESCE(u.leaderboard_name, u.name) AS player_name, a.leaderboard_score, a.best_run,
  a.runs_in_avg, a.avg_seconds, a.best_seconds, a.total_runs_played,
  RANK() OVER (ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST) AS rank_yearly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.leaderboard_score DESC, a.avg_seconds ASC NULLS LAST;

-- ============================================================
-- YEARLY CUMULATIVE
-- ============================================================
CREATE OR REPLACE VIEW v_leaderboard_yearly_cumulative AS
WITH agg AS (
  SELECT player_id,
    SUM(score) AS total_score, MAX(score) AS best_run, COUNT(*) AS total_runs,
    ROUND(AVG(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL)) AS avg_seconds,
    MIN(elapsed_seconds) FILTER (WHERE elapsed_seconds IS NOT NULL) AS best_seconds
  FROM v_player_runs
  WHERE DATE_TRUNC('year', run_date::date) = DATE_TRUNC('year', CURRENT_DATE)
  GROUP BY player_id
)
SELECT a.player_id, COALESCE(u.leaderboard_name, u.name) AS player_name, a.total_score AS leaderboard_score,
  a.best_run, a.total_runs, a.avg_seconds, a.best_seconds,
  RANK() OVER (ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST) AS rank_yearly
FROM agg a JOIN users u ON u.id = a.player_id
ORDER BY a.total_score DESC, a.avg_seconds ASC NULLS LAST;

GRANT SELECT ON v_leaderboard_yearly           TO anon;
GRANT SELECT ON v_leaderboard_yearly_cumulative TO anon;
