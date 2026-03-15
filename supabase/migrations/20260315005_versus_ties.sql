-- ============================================================
-- Migration: 20260315005_versus_ties
-- Version:   20260315005
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds tie tracking for versus sessions.
--
--   A tie = versus session where war_winner_team IS NULL
--   (scores exactly equal or session was left unresolved).
--
--   Changes:
--     1. v_player_sessions  — adds is_versus_tie column
--     2. All 8 leaderboard views — adds versus_ties column
--     3. get_friend_extended RPC — adds versus_ties to return set
--
--   UI display: W-T-L (e.g. 6W - 1T - 3L)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — Drop dependent views, recreate v_player_sessions
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
  CASE
    WHEN rt.mode = 'versus'
      AND res.war_winner_team IS NULL
      AND vpr.player_group IS NOT NULL
    THEN 1 ELSE 0
  END AS is_versus_tie,
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


-- ────────────────────────────────────────────────────────────
-- PART 2 — Recreate all 8 leaderboard views with versus_ties
-- ────────────────────────────────────────────────────────────

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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
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
    SUM(ps.is_versus_loss)     AS versus_losses,
    SUM(ps.is_versus_tie)      AS versus_ties
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
  versus_ties::int                   AS versus_ties,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_yearly
FROM player_agg;


-- ────────────────────────────────────────────────────────────
-- PART 3 — Rebuild get_friend_extended with versus_ties
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_friend_extended(uuid);

CREATE OR REPLACE FUNCTION public.get_friend_extended(p_user_id uuid)
RETURNS TABLE (
  -- Avg leaderboard
  rank_all_time             int,
  rank_yearly               int,
  rank_monthly              int,
  rank_weekly               int,
  score_all_time            numeric,
  score_yearly              numeric,
  score_monthly             numeric,
  score_weekly              numeric,
  -- Cumulative leaderboard
  rank_cum_all_time         int,
  rank_cum_yearly           int,
  rank_cum_monthly          int,
  rank_cum_weekly           int,
  score_cum_all_time        numeric,
  score_cum_yearly          numeric,
  score_cum_monthly         numeric,
  score_cum_weekly          numeric,
  -- Tactical — overall
  sessions                  int,
  avg_time_sec              int,
  obj_pct                   numeric,
  coop_pct                  numeric,
  versus_wins               int,
  versus_losses             int,
  versus_ties               int,
  -- Tactical — co-op breakdown
  coop_runs                 int,
  coop_avg_score            numeric,
  coop_avg_time_sec         int,
  coop_targets_pct          numeric,
  coop_obj_pct              numeric,
  -- Tactical — versus breakdown
  versus_runs               int,
  versus_avg_session_score  numeric,
  versus_hunter_avg_sec     int,
  versus_coyote_avg_sec     int,
  versus_obj_pct            numeric,
  -- Environment preferences
  viz_std                   numeric,
  viz_cosmic                numeric,
  viz_rave                  numeric,
  viz_strobe                numeric,
  viz_dark                  numeric,
  aud_tunes                 numeric,
  aud_cranked               numeric,
  aud_off                   numeric
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH run_stats AS (
    SELECT
      COUNT(DISTINCT sr.reservation_id)::int                                           AS sessions,

      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0
          AND (sr.role IS NULL
               OR sr.team = rp.team
               OR (rp.team IS NULL AND sr.team = 1))))::int                            AS avg_time_sec,

      ROUND(100.0 * COUNT(*) FILTER (
          WHERE sr.objective_complete = true
            AND (sr.role IS NULL
                 OR sr.team = rp.team
                 OR (rp.team IS NULL AND sr.team = 1)))
        / NULLIF(COUNT(*) FILTER (
            WHERE sr.role IS NULL
               OR sr.team = rp.team
               OR (rp.team IS NULL AND sr.team = 1)), 0), 1)                          AS obj_pct,

      ROUND(100.0 * COUNT(*) FILTER (WHERE sr.role IS NULL)
        / NULLIF(COUNT(*) FILTER (
            WHERE sr.role IS NULL OR sr.team = 1), 0), 1)                             AS coop_pct,

      -- ── Co-op breakdown ──────────────────────────────────────────────────
      COUNT(*) FILTER (WHERE sr.role IS NULL)::int                                    AS coop_runs,

      ROUND(AVG(sr.score) FILTER (WHERE sr.role IS NULL), 1)                          AS coop_avg_score,

      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.role IS NULL
          AND sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0))::int        AS coop_avg_time_sec,

      ROUND(100.0 * COUNT(*) FILTER (
          WHERE sr.role IS NULL AND sr.targets_eliminated = true)
        / NULLIF(COUNT(*) FILTER (WHERE sr.role IS NULL), 0), 1)                      AS coop_targets_pct,

      ROUND(100.0 * COUNT(*) FILTER (
          WHERE sr.role IS NULL AND sr.objective_complete = true)
        / NULLIF(COUNT(*) FILTER (WHERE sr.role IS NULL), 0), 1)                      AS coop_obj_pct,

      -- ── Versus breakdown (player's team row only) ─────────────────────────
      COUNT(*) FILTER (
        WHERE sr.role IS NOT NULL
          AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1)))::int          AS versus_runs,

      -- Avg session score = total versus score / number of versus sessions
      ROUND(
        SUM(sr.score) FILTER (
          WHERE sr.role IS NOT NULL
            AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1)))
        / NULLIF(COUNT(DISTINCT CASE
            WHEN sr.role IS NOT NULL
              AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))
            THEN sr.reservation_id END), 0), 1)                                       AS versus_avg_session_score,

      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.role = 'hunter'
          AND sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0
          AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))))::int         AS versus_hunter_avg_sec,

      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.role = 'coyote'
          AND sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0
          AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))))::int         AS versus_coyote_avg_sec,

      ROUND(100.0 * COUNT(*) FILTER (
          WHERE sr.objective_complete = true AND sr.role = 'hunter'
            AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1)))
        / NULLIF(COUNT(*) FILTER (
            WHERE sr.role = 'hunter'
              AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))), 0), 1)   AS versus_obj_pct,

      -- ── Visuals ──────────────────────────────────────────────────────────
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='V')/NULLIF(COUNT(*),0),1)         AS viz_std,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='C')/NULLIF(COUNT(*),0),1)         AS viz_cosmic,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='R')/NULLIF(COUNT(*),0),1)         AS viz_rave,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='S')/NULLIF(COUNT(*),0),1)         AS viz_strobe,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='B')/NULLIF(COUNT(*),0),1)         AS viz_dark,

      -- ── Audio ────────────────────────────────────────────────────────────
      ROUND(100.0*COUNT(*) FILTER (WHERE
        COALESCE(sr.audio, CASE WHEN sr.cranked THEN 'C' ELSE 'T' END)='T')
        /NULLIF(COUNT(*),0),1)                                                         AS aud_tunes,
      ROUND(100.0*COUNT(*) FILTER (WHERE
        COALESCE(sr.audio, CASE WHEN sr.cranked THEN 'C' ELSE 'T' END)='C')
        /NULLIF(COUNT(*),0),1)                                                         AS aud_cranked,
      ROUND(100.0*COUNT(*) FILTER (WHERE
        COALESCE(sr.audio, CASE WHEN sr.cranked THEN 'C' ELSE 'T' END)='O')
        /NULLIF(COUNT(*),0),1)                                                         AS aud_off

    FROM public.session_runs sr
    JOIN public.reservation_players rp
      ON  rp.reservation_id = sr.reservation_id
      AND rp.user_id = p_user_id
  )
  SELECT
    (SELECT la.rank_all_time     FROM public.v_leaderboard la          WHERE la.player_id = p_user_id)::int,
    (SELECT ly.rank_yearly       FROM public.v_leaderboard_yearly ly   WHERE ly.player_id = p_user_id)::int,
    (SELECT lm.rank_monthly      FROM public.v_leaderboard_monthly lm  WHERE lm.player_id = p_user_id)::int,
    (SELECT lw.rank_weekly       FROM public.v_leaderboard_weekly lw   WHERE lw.player_id = p_user_id)::int,
    (SELECT la.leaderboard_score FROM public.v_leaderboard la          WHERE la.player_id = p_user_id)::numeric,
    (SELECT ly.leaderboard_score FROM public.v_leaderboard_yearly ly   WHERE ly.player_id = p_user_id)::numeric,
    (SELECT lm.leaderboard_score FROM public.v_leaderboard_monthly lm  WHERE lm.player_id = p_user_id)::numeric,
    (SELECT lw.leaderboard_score FROM public.v_leaderboard_weekly lw   WHERE lw.player_id = p_user_id)::numeric,
    (SELECT lca.rank_all_time    FROM public.v_leaderboard_cumulative lca          WHERE lca.player_id = p_user_id)::int,
    (SELECT lcy.rank_yearly      FROM public.v_leaderboard_yearly_cumulative lcy   WHERE lcy.player_id = p_user_id)::int,
    (SELECT lcm.rank_monthly     FROM public.v_leaderboard_monthly_cumulative lcm  WHERE lcm.player_id = p_user_id)::int,
    (SELECT lcw.rank_weekly      FROM public.v_leaderboard_weekly_cumulative lcw   WHERE lcw.player_id = p_user_id)::int,
    (SELECT lca.leaderboard_score FROM public.v_leaderboard_cumulative lca          WHERE lca.player_id = p_user_id)::numeric,
    (SELECT lcy.leaderboard_score FROM public.v_leaderboard_yearly_cumulative lcy   WHERE lcy.player_id = p_user_id)::numeric,
    (SELECT lcm.leaderboard_score FROM public.v_leaderboard_monthly_cumulative lcm  WHERE lcm.player_id = p_user_id)::numeric,
    (SELECT lcw.leaderboard_score FROM public.v_leaderboard_weekly_cumulative lcw   WHERE lcw.player_id = p_user_id)::numeric,
    rs.sessions,
    rs.avg_time_sec,
    rs.obj_pct,
    rs.coop_pct,
    COALESCE((SELECT la.versus_wins   FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    COALESCE((SELECT la.versus_losses FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    COALESCE((SELECT la.versus_ties   FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    rs.coop_runs,
    rs.coop_avg_score,
    rs.coop_avg_time_sec,
    rs.coop_targets_pct,
    rs.coop_obj_pct,
    rs.versus_runs,
    rs.versus_avg_session_score,
    rs.versus_hunter_avg_sec,
    rs.versus_coyote_avg_sec,
    rs.versus_obj_pct,
    rs.viz_std, rs.viz_cosmic, rs.viz_rave, rs.viz_strobe, rs.viz_dark,
    rs.aud_tunes, rs.aud_cranked, rs.aud_off
  FROM run_stats rs;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_extended(uuid) TO authenticated;
