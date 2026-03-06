-- ============================================================
-- Migration: Scoring System Overhaul
-- Version:   20260306001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Alters session_runs.score to numeric(8,4) for decimal precision
--   2. Adds session_runs.role  ('hunter'|'coyote') for VERSUS attribution
--   3. Adds reservations.war_winner_team + war_win_type for session W/L
--   4. Recreates v_player_runs with correct team-swap attribution
--   5. Recreates v_player_sessions helper view
--   6. Recreates all 8 leaderboard views (avg+cumulative × 4 time windows)
--   7. Replaces get_player_scoring_stats RPC for war-based W/L tracking
--
-- SAFE TO RE-RUN: All statements use IF NOT EXISTS / CREATE OR REPLACE.
-- BACKWARD COMPATIBLE: Old integer scores upcast to numeric; old runs get
--   NULL role (treated as COOP for attribution). War bonus = 0 for old data.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 0 — Drop views that depend on session_runs.score
--           so the ALTER COLUMN in Part 1a can proceed.
--           All views are recreated later in this migration.
-- ────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_leaderboard_yearly_cumulative  CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_monthly_cumulative CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_weekly_cumulative  CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_cumulative         CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_yearly             CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_monthly            CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_weekly             CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard                    CASCADE;
DROP VIEW IF EXISTS public.v_player_sessions                CASCADE;
DROP VIEW IF EXISTS public.v_player_runs                    CASCADE;
DROP VIEW IF EXISTS public.v_session_scores                 CASCADE;

-- Drop RLS policies on session_runs that reference the score column.
-- Recreated at the end of this migration after the column type change.
DROP POLICY IF EXISTS runs_public_read ON public.session_runs;


-- ────────────────────────────────────────────────────────────
-- PART 1 — Schema Changes
-- ────────────────────────────────────────────────────────────

-- 1a. session_runs.score → numeric(8,4)
--     Existing integer values (e.g. 160) become 160.0000 — no data loss.
ALTER TABLE public.session_runs
  ALTER COLUMN score TYPE numeric(8,4) USING score::numeric(8,4);

-- 1b. role column — 'hunter' or 'coyote' for VERSUS runs; NULL for COOP
ALTER TABLE public.session_runs
  ADD COLUMN IF NOT EXISTS role text
  CONSTRAINT session_runs_role_check CHECK (role IN ('hunter', 'coyote'));

-- 1c. War outcome on reservations (session-level W/L for VERSUS)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS war_winner_team smallint,
  ADD COLUMN IF NOT EXISTS war_win_type text
  CONSTRAINT reservations_war_win_type_check CHECK (war_win_type IN ('SWEEP', 'TIEBREAK'));


-- ────────────────────────────────────────────────────────────
-- PART 2 — Recreate v_player_runs
-- ────────────────────────────────────────────────────────────
--
-- Join logic:
--   COOP (sr.team IS NULL):  all players on the reservation get the run score.
--   VERSUS:
--     Run 1 — player gets score from the team row that matches rp.team (same group).
--     Run 2 — teams swap roles, so player gets score from the OPPOSITE team row.
--     This is expressed as:
--       run_number = 1 AND sr.team = rp.team
--       run_number = 2 AND sr.team != rp.team   (3 - rp.team for binary 1/2 teams)
--
-- War bonus:
--   The flat war bonus (SWEEP=25, TIEBREAK=15) is added to the run_number=1 row
--   for winning-team players so it is counted exactly once per session in any SUM.
--

CREATE OR REPLACE VIEW public.v_player_runs AS
SELECT
  rp.user_id        AS player_id,
  sr.id             AS run_id,
  sr.reservation_id,
  sr.run_number,
  sr.team,
  sr.role,
  rp.team           AS player_group,   -- player's original group (rp.team), stable across runs

  -- Raw run score (numeric, no bonus)
  sr.score,

  -- War bonus applied to the winning team's hunter run
  CASE
    WHEN sr.role = 'hunter'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team = rp.team
    THEN CASE res.war_win_type
           WHEN 'SWEEP'    THEN 25.0
           WHEN 'TIEBREAK' THEN 15.0
           ELSE 0.0
         END
    ELSE 0.0
  END AS war_bonus,

  -- Score used for leaderboard aggregation = run_score + war_bonus
  sr.score + CASE
    WHEN sr.role = 'hunter'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team = rp.team
    THEN CASE res.war_win_type
           WHEN 'SWEEP'    THEN 25.0
           WHEN 'TIEBREAK' THEN 15.0
           ELSE 0.0
         END
    ELSE 0.0
  END AS effective_score,

  CASE WHEN sr.role IS NULL OR sr.role = 'hunter' THEN sr.elapsed_seconds ELSE NULL END AS elapsed_seconds,
  sr.objective_complete,
  sr.targets_eliminated,
  sr.visual,
  sr.audio,
  sr.cranked,
  sr.live_op_difficulty,
  sr.winning_team,
  sr.created_at

FROM reservation_players rp
JOIN reservations res ON res.id = rp.reservation_id
JOIN session_runs sr
  ON  sr.reservation_id = rp.reservation_id
  AND (
        sr.team IS NULL                                                -- COOP: all players
        OR (
          rp.team IS NOT NULL
          AND (
            (sr.run_number = 1 AND sr.team = rp.team)                 -- VERSUS run 1: same team
            OR (sr.run_number = 2 AND sr.team != rp.team)             -- VERSUS run 2: opposite (teams swapped)
          )
        )
      )
WHERE rp.user_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- PART 3 — Helper view: v_player_sessions
-- Aggregates v_player_runs to one row per (player, reservation).
-- Used by all leaderboard views to avoid repetitive CTEs.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_player_sessions AS
SELECT
  vpr.player_id,
  vpr.reservation_id,
  vpr.player_group,
  res.date                                                AS session_date,
  rt.mode                                                 AS session_mode,

  SUM(vpr.effective_score)                                AS session_score,
  MAX(vpr.effective_score)                                AS best_run_score,
  MIN(CASE WHEN vpr.elapsed_seconds > 0
           THEN vpr.elapsed_seconds END)                  AS best_run_seconds,
  SUM(CASE WHEN vpr.elapsed_seconds > 0
           THEN vpr.elapsed_seconds ELSE 0 END)           AS total_elapsed,
  COUNT(CASE WHEN vpr.elapsed_seconds > 0
             THEN 1 END)                                  AS elapsed_count,
  COUNT(*)                                                AS run_count,

  -- Versus W/L — only counted when war outcome is stored
  CASE
    WHEN rt.mode = 'versus'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team = vpr.player_group
    THEN 1 ELSE 0
  END AS is_versus_win,

  CASE
    WHEN rt.mode = 'versus'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team IS DISTINCT FROM vpr.player_group
      AND vpr.player_group IS NOT NULL
    THEN 1 ELSE 0
  END AS is_versus_loss

FROM v_player_runs vpr
JOIN reservations res ON res.id = vpr.reservation_id
JOIN public.reservation_types rt  ON rt.id  = res.type_id
GROUP BY
  vpr.player_id, vpr.reservation_id, vpr.player_group,
  res.date, rt.mode, res.war_winner_team;


-- ────────────────────────────────────────────────────────────
-- PART 4 — Recreate leaderboard views (8 total)
--
-- Output columns expected by the app:
--   player_id, player_name, leaderboard_score, best_session,
--   total_score_all, sessions_in_avg, total_sessions_played,
--   runs_in_avg, total_runs, total_runs_played,
--   best_run, avg_seconds, best_seconds,
--   versus_wins, versus_losses,
--   rank_all_time (avg views) | rank_all_time (cum views)
-- ────────────────────────────────────────────────────────────

-- Shared macro via CTE:
--   "recent_sessions" = session rows filtered by date window (or all for all-time).
--   "player_agg"      = per-player aggregates from those sessions.

-- ── 4a. v_leaderboard (avg, all-time) ──────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    AVG(ps.session_score)  AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_all_time
FROM player_agg;


-- ── 4b. v_leaderboard_weekly (avg, last 7 days) ────────────

CREATE OR REPLACE VIEW public.v_leaderboard_weekly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    AVG(ps.session_score)  AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_weekly
FROM player_agg;


-- ── 4c. v_leaderboard_monthly (avg, last 30 days) ──────────

CREATE OR REPLACE VIEW public.v_leaderboard_monthly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    AVG(ps.session_score)  AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_monthly
FROM player_agg;


-- ── 4d. v_leaderboard_yearly (avg, last 365 days) ──────────

CREATE OR REPLACE VIEW public.v_leaderboard_yearly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    AVG(ps.session_score)  AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_yearly
FROM player_agg;


-- ── 4e. v_leaderboard_cumulative (cumulative all-time) ─────

CREATE OR REPLACE VIEW public.v_leaderboard_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,        -- cumulative: SUM not AVG
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_all_time
FROM player_agg;


-- ── 4f. v_leaderboard_weekly_cumulative ────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard_weekly_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_weekly
FROM player_agg;


-- ── 4g. v_leaderboard_monthly_cumulative ───────────────────

CREATE OR REPLACE VIEW public.v_leaderboard_monthly_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_monthly
FROM player_agg;


-- ── 4h. v_leaderboard_yearly_cumulative ────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard_yearly_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id,
  player_name,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_yearly
FROM player_agg;


-- ────────────────────────────────────────────────────────────
-- PART 5 — Replace get_player_scoring_stats RPC
--
-- Returns per-player stats used in the OpsView scoring modal
-- player history cards (avg score, run count, W/L, COOP success rate).
-- versus_wins/versus_losses now count WARS (sessions), not battles (runs).
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_player_scoring_stats(p_user_ids uuid[])
RETURNS TABLE (
  user_id        uuid,
  avg_score      numeric,
  total_runs     bigint,
  versus_wins    bigint,
  versus_losses  bigint,
  coop_runs      bigint,
  coop_success   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.player_id AS user_id,
    ROUND(AVG(ps.session_score)::numeric, 1) AS avg_score,
    SUM(ps.run_count)      AS total_runs,
    SUM(ps.is_versus_win)  AS versus_wins,
    SUM(ps.is_versus_loss) AS versus_losses,
    -- coop_runs: count individual COOP run rows across all sessions
    SUM(CASE WHEN ps.session_mode != 'versus' THEN ps.run_count ELSE 0 END) AS coop_runs,
    -- coop_success: COOP sessions where at least one run had objective_complete
    SUM(CASE WHEN ps.session_mode != 'versus'
              AND EXISTS (
                SELECT 1 FROM v_player_runs vpr2
                WHERE vpr2.player_id = ps.player_id
                  AND vpr2.reservation_id = ps.reservation_id
                  AND vpr2.objective_complete = true
              )
         THEN 1 ELSE 0 END) AS coop_success
  FROM v_player_sessions ps
  WHERE ps.player_id = ANY(p_user_ids)
  GROUP BY ps.player_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_player_scoring_stats(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_scoring_stats(uuid[]) TO anon;


-- ────────────────────────────────────────────────────────────
-- PART 6 — Recreate v_session_scores
--
-- Shows completed sessions with total score, used by
-- fetchPlayerSessionHistory (filtered by booker_id = user_id).
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_session_scores AS
SELECT
  r.id              AS reservation_id,
  r.user_id         AS booker_id,
  r.customer_name   AS booker_name,
  r.date,
  r.start_time,
  r.type_id,
  r.status,
  COALESCE(SUM(sr.score), 0)          AS total_score,
  COUNT(DISTINCT sr.run_number)        AS run_count
FROM   public.reservations r
LEFT   JOIN public.session_runs sr ON sr.reservation_id = r.id
WHERE  r.status = 'completed'
GROUP  BY r.id, r.user_id, r.customer_name, r.date, r.start_time, r.type_id, r.status;

GRANT SELECT ON public.v_session_scores TO authenticated;
GRANT SELECT ON public.v_session_scores TO anon;


-- ────────────────────────────────────────────────────────────
-- PART 7 — Recreate session_runs RLS policies
--
-- runs_public_read was dropped before the ALTER COLUMN in Part 1.
-- Recreate it now as a simple allow-all SELECT (scores are public data).
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'session_runs'
      AND policyname = 'runs_public_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY runs_public_read ON public.session_runs
        FOR SELECT USING (true);
    $policy$;
  END IF;
END;
$$;
