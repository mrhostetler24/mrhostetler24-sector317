-- ============================================================
-- Migration: Stable Versus Team Numbers in session_runs
-- Version:   20260311001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Fixes v_player_runs so that session_runs.team is treated as
--   the STABLE original group number (1=Blue always, 2=Red always)
--   rather than an in-run positional slot (1=hunter always).
--
--   Old join: run 1 matches same team, run 2 matches opposite team.
--   New join: sr.team = rp.team for ALL runs — simple and correct.
--
--   This view-only change is safe to apply independently of the app
--   code change because both must land together for run 2 display to
--   be correct.  Apply the app deploy (doScoreVersus fix) at the same
--   time or immediately after this migration.
--
--
-- SAFE TO RE-RUN: CREATE OR REPLACE view is idempotent.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 1 — Drop dependent views, recreate v_player_runs
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


CREATE OR REPLACE VIEW public.v_player_runs AS
SELECT
  rp.user_id        AS player_id,
  sr.id             AS run_id,
  sr.reservation_id,
  sr.run_number,
  sr.team,
  sr.role,
  rp.team           AS player_group,   -- player's original group (stable across runs)

  sr.score,

  -- War bonus: applied to the winning team's hunter run only
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
        sr.team IS NULL            -- COOP: all players on the reservation
        OR (
          rp.team IS NOT NULL
          AND sr.team = rp.team    -- VERSUS: stable team matches for all runs
        )
      )
WHERE rp.user_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- PART 2 — Recreate dependent views (unchanged from 20260306001)
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
  COUNT(*)                                                AS run_count,
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
  END AS is_versus_loss,
  SUM(CASE WHEN vpr.elapsed_seconds > 0
           THEN vpr.elapsed_seconds ELSE 0 END)           AS total_elapsed,
  COUNT(CASE WHEN vpr.elapsed_seconds > 0
             THEN 1 END)                                  AS elapsed_count
FROM v_player_runs vpr
JOIN reservations res ON res.id = vpr.reservation_id
JOIN public.reservation_types rt  ON rt.id  = res.type_id
GROUP BY
  vpr.player_id, vpr.reservation_id, vpr.player_group,
  res.date, rt.mode, res.war_winner_team;


CREATE OR REPLACE VIEW public.v_leaderboard AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
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
  player_id, player_name,
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


CREATE OR REPLACE VIEW public.v_leaderboard_weekly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
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
  player_id, player_name,
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


CREATE OR REPLACE VIEW public.v_leaderboard_monthly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
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
  player_id, player_name,
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


CREATE OR REPLACE VIEW public.v_leaderboard_yearly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
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
  player_id, player_name,
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


CREATE OR REPLACE VIEW public.v_leaderboard_cumulative AS
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
  GROUP BY ps.player_id, u.leaderboard_name, u.name
)
SELECT
  player_id, player_name,
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
  player_id, player_name,
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
  player_id, player_name,
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
  player_id, player_name,
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


