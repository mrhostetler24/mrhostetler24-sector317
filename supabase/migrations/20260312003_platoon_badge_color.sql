-- ============================================================
-- Migration: Platoon Badge Color
-- Version:   20260312003
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Adds badge_color column to platoons (default #4ade80)
--   2. New update_platoon_badge_color RPC
--   3. Updates search_platoons + get_platoon_for_user to return badge_color
--   4. Updates get_my_platoon_invites to return platoon_badge_color
--   5. Rebuilds all 8 leaderboard views to include platoon_badge_url
--      and platoon_badge_color (via LEFT JOIN to platoons on tag)
-- ============================================================


-- ── 0. Drop functions with changed return types (can't use CREATE OR REPLACE) ─

DROP FUNCTION IF EXISTS public.search_platoons(text);
DROP FUNCTION IF EXISTS public.get_platoon_for_user(uuid);
DROP FUNCTION IF EXISTS public.get_my_platoon_invites();


-- ── 1. Column ──────────────────────────────────────────────────────────────

ALTER TABLE public.platoons ADD COLUMN IF NOT EXISTS badge_color text DEFAULT '#4ade80';


-- ── 2. RPC: update_platoon_badge_color ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_platoon_badge_color(p_color text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platoon uuid;
  v_role    text;
BEGIN
  SELECT platoon_id, role INTO v_platoon, v_role
  FROM platoon_members WHERE user_id = private_get_my_user_id() LIMIT 1;
  IF v_role <> 'admin' THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.platoons SET badge_color = p_color WHERE id = v_platoon;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_platoon_badge_color(text) TO authenticated;


-- ── 3. search_platoons — add badge_color ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_platoons(p_query text DEFAULT '')
RETURNS TABLE (
  id           uuid,
  tag          text,
  name         text,
  description  text,
  badge_url    text,
  badge_color  text,
  is_open      boolean,
  member_count bigint,
  created_at   timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.tag, p.name, p.description, p.badge_url, p.badge_color, p.is_open,
         COUNT(pm.id) AS member_count, p.created_at
  FROM   public.platoons p
  LEFT JOIN public.platoon_members pm ON pm.platoon_id = p.id
  WHERE (p_query = '' OR p.tag ILIKE '%' || p_query || '%' OR p.name ILIKE '%' || p_query || '%')
  GROUP BY p.id, p.tag, p.name, p.description, p.badge_url, p.badge_color, p.is_open, p.created_at
  ORDER BY member_count DESC, p.name;
$$;


-- ── 4. get_platoon_for_user — add badge_color ─────────────────────────────

CREATE OR REPLACE FUNCTION public.get_platoon_for_user(p_user_id uuid)
RETURNS TABLE (
  id           uuid,
  tag          text,
  name         text,
  description  text,
  badge_url    text,
  badge_color  text,
  is_open      boolean,
  member_count bigint,
  my_role      text,
  created_at   timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.tag, p.name, p.description, p.badge_url, p.badge_color, p.is_open,
         (SELECT COUNT(*) FROM public.platoon_members WHERE platoon_id = p.id) AS member_count,
         pm.role AS my_role,
         p.created_at
  FROM   public.platoons p
  JOIN   public.platoon_members pm ON pm.platoon_id = p.id
  WHERE  pm.user_id = p_user_id;
$$;


-- ── 5. get_my_platoon_invites — add platoon_badge_color ───────────────────

CREATE OR REPLACE FUNCTION public.get_my_platoon_invites()
RETURNS TABLE (
  id                    uuid,
  platoon_id            uuid,
  platoon_tag           text,
  platoon_name          text,
  platoon_badge_url     text,
  platoon_badge_color   text,
  from_user_id          uuid,
  from_leaderboard_name text,
  created_at            timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pi.id,
    pi.platoon_id,
    p.tag         AS platoon_tag,
    p.name        AS platoon_name,
    p.badge_url   AS platoon_badge_url,
    p.badge_color AS platoon_badge_color,
    pi.from_user_id,
    COALESCE(u.leaderboard_name, u.name) AS from_leaderboard_name,
    pi.created_at
  FROM platoon_invites pi
  JOIN platoons p ON p.id = pi.platoon_id
  JOIN users u ON u.id = pi.from_user_id
  WHERE pi.to_user_id = private_get_my_user_id()
  ORDER BY pi.created_at DESC;
$$;


-- ── 6. Leaderboard views — add platoon_badge_url + platoon_badge_color ────
-- Must DROP first; CREATE OR REPLACE can't insert new columns mid-list.

DROP VIEW IF EXISTS public.v_leaderboard_yearly_cumulative;
DROP VIEW IF EXISTS public.v_leaderboard_monthly_cumulative;
DROP VIEW IF EXISTS public.v_leaderboard_weekly_cumulative;
DROP VIEW IF EXISTS public.v_leaderboard_cumulative;
DROP VIEW IF EXISTS public.v_leaderboard_yearly;
DROP VIEW IF EXISTS public.v_leaderboard_monthly;
DROP VIEW IF EXISTS public.v_leaderboard_weekly;
DROP VIEW IF EXISTS public.v_leaderboard;


CREATE OR REPLACE VIEW public.v_leaderboard AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
    u.platoon_tag,
    pl.badge_url   AS platoon_badge_url,
    pl.badge_color AS platoon_badge_color,
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
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag, pl.badge_url, pl.badge_color
)
SELECT
  player_id, player_name, platoon_tag, platoon_badge_url, platoon_badge_color,
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
