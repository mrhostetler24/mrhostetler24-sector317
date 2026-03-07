-- ============================================================
-- Migration: Fix leaderboard avg to be true per-run average
-- Version:   20260307002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS FIXES:
--   v_leaderboard (and weekly/monthly/yearly) previously computed
--   avg_score as SUM(session_score)/SUM(run_count), which could
--   produce a session-level average when run_count=1 per session.
--
--   New approach: compute avg_score = AVG(effective_score) directly
--   from v_player_runs so it is always a true per-individual-run
--   average and is always ≤ best_run.
--
-- CUMULATIVE views are unchanged (they SUM, not AVG).
-- ============================================================

DROP VIEW IF EXISTS public.v_leaderboard_yearly  CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_monthly CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_weekly  CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard         CASCADE;


-- ── Helper: common run-level agg (no date filter) ─────────────────────────
-- Used internally; not a standalone view.

-- ── 4a. v_leaderboard (avg, all-time) ──────────────────────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard AS
WITH run_agg AS (
  SELECT
    vpr.player_id,
    AVG(vpr.effective_score)                                           AS avg_score,
    MAX(vpr.effective_score)                                           AS best_run,
    SUM(vpr.effective_score)                                           AS total_score_all,
    COUNT(*)                                                           AS total_run_count,
    MIN(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds END) AS best_seconds,
    SUM(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds ELSE 0 END)::float
      / NULLIF(COUNT(CASE WHEN vpr.elapsed_seconds > 0 THEN 1 END), 0) AS avg_seconds_raw
  FROM v_player_runs vpr
  JOIN public.users u ON u.id = vpr.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY vpr.player_id
),
session_agg AS (
  SELECT
    ps.player_id,
    COUNT(*)               AS total_sessions,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.is_versus_win)  AS versus_wins,
    SUM(ps.is_versus_loss) AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id
)
SELECT
  ra.player_id,
  COALESCE(u.leaderboard_name, u.name)    AS player_name,
  ROUND(ra.avg_score::numeric, 1)         AS leaderboard_score,
  ROUND(sa.best_session::numeric, 1)      AS best_session,
  ROUND(ra.total_score_all::numeric, 1)   AS total_score_all,
  sa.total_sessions::int                  AS sessions_in_avg,
  sa.total_sessions::int                  AS total_sessions_played,
  ra.total_run_count::int                 AS runs_in_avg,
  ra.total_run_count::int                 AS total_runs,
  ra.total_run_count::int                 AS total_runs_played,
  ROUND(ra.best_run::numeric, 1)          AS best_run,
  ROUND(ra.avg_seconds_raw)::int          AS avg_seconds,
  ra.best_seconds::int                    AS best_seconds,
  sa.versus_wins::int                     AS versus_wins,
  sa.versus_losses::int                   AS versus_losses,
  RANK() OVER (ORDER BY ra.avg_score DESC NULLS LAST, ra.avg_seconds_raw ASC NULLS LAST)
    AS rank_all_time
FROM run_agg ra
JOIN public.users u ON u.id = ra.player_id
LEFT JOIN session_agg sa ON sa.player_id = ra.player_id;

GRANT SELECT ON public.v_leaderboard TO anon, authenticated;


-- ── 4b. v_leaderboard_weekly (avg, last 7 days) ────────────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard_weekly AS
WITH run_agg AS (
  SELECT
    vpr.player_id,
    AVG(vpr.effective_score)                                           AS avg_score,
    MAX(vpr.effective_score)                                           AS best_run,
    SUM(vpr.effective_score)                                           AS total_score_all,
    COUNT(*)                                                           AS total_run_count,
    MIN(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds END) AS best_seconds,
    SUM(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds ELSE 0 END)::float
      / NULLIF(COUNT(CASE WHEN vpr.elapsed_seconds > 0 THEN 1 END), 0) AS avg_seconds_raw
  FROM v_player_runs vpr
  JOIN public.users u ON u.id = vpr.player_id
  JOIN public.reservations res ON res.id = vpr.reservation_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND res.date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY vpr.player_id
),
session_agg AS (
  SELECT
    ps.player_id,
    COUNT(*)               AS total_sessions,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.is_versus_win)  AS versus_wins,
    SUM(ps.is_versus_loss) AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id
)
SELECT
  ra.player_id,
  COALESCE(u.leaderboard_name, u.name)    AS player_name,
  ROUND(ra.avg_score::numeric, 1)         AS leaderboard_score,
  ROUND(sa.best_session::numeric, 1)      AS best_session,
  ROUND(ra.total_score_all::numeric, 1)   AS total_score_all,
  sa.total_sessions::int                  AS sessions_in_avg,
  sa.total_sessions::int                  AS total_sessions_played,
  ra.total_run_count::int                 AS runs_in_avg,
  ra.total_run_count::int                 AS total_runs,
  ra.total_run_count::int                 AS total_runs_played,
  ROUND(ra.best_run::numeric, 1)          AS best_run,
  ROUND(ra.avg_seconds_raw)::int          AS avg_seconds,
  ra.best_seconds::int                    AS best_seconds,
  sa.versus_wins::int                     AS versus_wins,
  sa.versus_losses::int                   AS versus_losses,
  RANK() OVER (ORDER BY ra.avg_score DESC NULLS LAST, ra.avg_seconds_raw ASC NULLS LAST)
    AS rank_weekly
FROM run_agg ra
JOIN public.users u ON u.id = ra.player_id
LEFT JOIN session_agg sa ON sa.player_id = ra.player_id;

GRANT SELECT ON public.v_leaderboard_weekly TO anon, authenticated;


-- ── 4c. v_leaderboard_monthly (avg, last 30 days) ──────────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard_monthly AS
WITH run_agg AS (
  SELECT
    vpr.player_id,
    AVG(vpr.effective_score)                                           AS avg_score,
    MAX(vpr.effective_score)                                           AS best_run,
    SUM(vpr.effective_score)                                           AS total_score_all,
    COUNT(*)                                                           AS total_run_count,
    MIN(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds END) AS best_seconds,
    SUM(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds ELSE 0 END)::float
      / NULLIF(COUNT(CASE WHEN vpr.elapsed_seconds > 0 THEN 1 END), 0) AS avg_seconds_raw
  FROM v_player_runs vpr
  JOIN public.users u ON u.id = vpr.player_id
  JOIN public.reservations res ON res.id = vpr.reservation_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND res.date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY vpr.player_id
),
session_agg AS (
  SELECT
    ps.player_id,
    COUNT(*)               AS total_sessions,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.is_versus_win)  AS versus_wins,
    SUM(ps.is_versus_loss) AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id
)
SELECT
  ra.player_id,
  COALESCE(u.leaderboard_name, u.name)    AS player_name,
  ROUND(ra.avg_score::numeric, 1)         AS leaderboard_score,
  ROUND(sa.best_session::numeric, 1)      AS best_session,
  ROUND(ra.total_score_all::numeric, 1)   AS total_score_all,
  sa.total_sessions::int                  AS sessions_in_avg,
  sa.total_sessions::int                  AS total_sessions_played,
  ra.total_run_count::int                 AS runs_in_avg,
  ra.total_run_count::int                 AS total_runs,
  ra.total_run_count::int                 AS total_runs_played,
  ROUND(ra.best_run::numeric, 1)          AS best_run,
  ROUND(ra.avg_seconds_raw)::int          AS avg_seconds,
  ra.best_seconds::int                    AS best_seconds,
  sa.versus_wins::int                     AS versus_wins,
  sa.versus_losses::int                   AS versus_losses,
  RANK() OVER (ORDER BY ra.avg_score DESC NULLS LAST, ra.avg_seconds_raw ASC NULLS LAST)
    AS rank_monthly
FROM run_agg ra
JOIN public.users u ON u.id = ra.player_id
LEFT JOIN session_agg sa ON sa.player_id = ra.player_id;

GRANT SELECT ON public.v_leaderboard_monthly TO anon, authenticated;


-- ── 4d. v_leaderboard_yearly (avg, last 365 days) ──────────────────────────

CREATE OR REPLACE VIEW public.v_leaderboard_yearly AS
WITH run_agg AS (
  SELECT
    vpr.player_id,
    AVG(vpr.effective_score)                                           AS avg_score,
    MAX(vpr.effective_score)                                           AS best_run,
    SUM(vpr.effective_score)                                           AS total_score_all,
    COUNT(*)                                                           AS total_run_count,
    MIN(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds END) AS best_seconds,
    SUM(CASE WHEN vpr.elapsed_seconds > 0 THEN vpr.elapsed_seconds ELSE 0 END)::float
      / NULLIF(COUNT(CASE WHEN vpr.elapsed_seconds > 0 THEN 1 END), 0) AS avg_seconds_raw
  FROM v_player_runs vpr
  JOIN public.users u ON u.id = vpr.player_id
  JOIN public.reservations res ON res.id = vpr.reservation_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND res.date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY vpr.player_id
),
session_agg AS (
  SELECT
    ps.player_id,
    COUNT(*)               AS total_sessions,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.is_versus_win)  AS versus_wins,
    SUM(ps.is_versus_loss) AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id
)
SELECT
  ra.player_id,
  COALESCE(u.leaderboard_name, u.name)    AS player_name,
  ROUND(ra.avg_score::numeric, 1)         AS leaderboard_score,
  ROUND(sa.best_session::numeric, 1)      AS best_session,
  ROUND(ra.total_score_all::numeric, 1)   AS total_score_all,
  sa.total_sessions::int                  AS sessions_in_avg,
  sa.total_sessions::int                  AS total_sessions_played,
  ra.total_run_count::int                 AS runs_in_avg,
  ra.total_run_count::int                 AS total_runs,
  ra.total_run_count::int                 AS total_runs_played,
  ROUND(ra.best_run::numeric, 1)          AS best_run,
  ROUND(ra.avg_seconds_raw)::int          AS avg_seconds,
  ra.best_seconds::int                    AS best_seconds,
  sa.versus_wins::int                     AS versus_wins,
  sa.versus_losses::int                   AS versus_losses,
  RANK() OVER (ORDER BY ra.avg_score DESC NULLS LAST, ra.avg_seconds_raw ASC NULLS LAST)
    AS rank_yearly
FROM run_agg ra
JOIN public.users u ON u.id = ra.player_id
LEFT JOIN session_agg sa ON sa.player_id = ra.player_id;

GRANT SELECT ON public.v_leaderboard_yearly TO anon, authenticated;
