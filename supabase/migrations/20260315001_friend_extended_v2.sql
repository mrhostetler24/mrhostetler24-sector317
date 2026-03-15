-- ============================================================
-- Migration: 20260315001_friend_extended_v2
-- Version:   20260315001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Rebuilds get_friend_extended to add:
--     1. Cumulative leaderboard ranks + scores (all 4 time windows)
--     2. coop_pct  — % of total runs that are co-op (role IS NULL)
--     3. versus_wins / versus_losses — session-level W/L
--
--   IMPORTANT: queries session_runs directly (not v_player_runs) so
--   that all players are found regardless of whether reservation_players
--   has team data filled in (v_player_runs drops rows where rp.team IS NULL
--   for versus sessions, which excludes some legacy records).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_friend_extended(uuid);

CREATE OR REPLACE FUNCTION public.get_friend_extended(p_user_id uuid)
RETURNS TABLE (
  -- Avg leaderboard
  rank_all_time      int,
  rank_yearly        int,
  rank_monthly       int,
  rank_weekly        int,
  score_all_time     numeric,
  score_yearly       numeric,
  score_monthly      numeric,
  score_weekly       numeric,
  -- Cumulative leaderboard
  rank_cum_all_time  int,
  rank_cum_yearly    int,
  rank_cum_monthly   int,
  rank_cum_weekly    int,
  score_cum_all_time numeric,
  score_cum_yearly   numeric,
  score_cum_monthly  numeric,
  score_cum_weekly   numeric,
  -- Tactical profile
  sessions           int,
  avg_time_sec       int,
  obj_pct            numeric,
  coop_pct           numeric,
  versus_wins        int,
  versus_losses      int,
  -- Environment preferences
  viz_std            numeric,
  viz_cosmic         numeric,
  viz_rave           numeric,
  viz_strobe         numeric,
  viz_dark           numeric,
  aud_tunes          numeric,
  aud_cranked        numeric,
  aud_off            numeric
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH run_stats AS (
    -- Join session_runs → reservation_players without team restriction so
    -- every player's runs are found even without team attribution data.
    SELECT
      COUNT(DISTINCT sr.reservation_id)::int                                        AS sessions,
      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0))::int       AS avg_time_sec,
      ROUND(100.0 * COUNT(*) FILTER (WHERE sr.objective_complete = true)
        / NULLIF(COUNT(*), 0), 1)                                                    AS obj_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE sr.role IS NULL)
        / NULLIF(COUNT(*), 0), 1)                                                    AS coop_pct,
      -- Visuals (codes: V=Standard C=Cosmic R=Rave S=Strobe B=Dark)
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='V')/NULLIF(COUNT(*),0),1)        AS viz_std,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='C')/NULLIF(COUNT(*),0),1)        AS viz_cosmic,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='R')/NULLIF(COUNT(*),0),1)        AS viz_rave,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='S')/NULLIF(COUNT(*),0),1)        AS viz_strobe,
      ROUND(100.0*COUNT(*) FILTER (WHERE sr.visual='B')/NULLIF(COUNT(*),0),1)        AS viz_dark,
      -- Audio (T=Tunes C=Cranked O=Off)
      ROUND(100.0*COUNT(*) FILTER (WHERE
        COALESCE(sr.audio, CASE WHEN sr.cranked THEN 'C' ELSE 'T' END)='T')
        /NULLIF(COUNT(*),0),1)                                                        AS aud_tunes,
      ROUND(100.0*COUNT(*) FILTER (WHERE
        COALESCE(sr.audio, CASE WHEN sr.cranked THEN 'C' ELSE 'T' END)='C')
        /NULLIF(COUNT(*),0),1)                                                        AS aud_cranked,
      ROUND(100.0*COUNT(*) FILTER (WHERE
        COALESCE(sr.audio, CASE WHEN sr.cranked THEN 'C' ELSE 'T' END)='O')
        /NULLIF(COUNT(*),0),1)                                                        AS aud_off
    FROM public.session_runs sr
    JOIN public.reservation_players rp
      ON  rp.reservation_id = sr.reservation_id
      AND rp.user_id = p_user_id
  )
  SELECT
    -- Avg leaderboard (scalar subqueries: null-safe)
    (SELECT la.rank_all_time   FROM public.v_leaderboard la          WHERE la.player_id = p_user_id)::int,
    (SELECT ly.rank_yearly     FROM public.v_leaderboard_yearly ly   WHERE ly.player_id = p_user_id)::int,
    (SELECT lm.rank_monthly    FROM public.v_leaderboard_monthly lm  WHERE lm.player_id = p_user_id)::int,
    (SELECT lw.rank_weekly     FROM public.v_leaderboard_weekly lw   WHERE lw.player_id = p_user_id)::int,
    (SELECT la.leaderboard_score FROM public.v_leaderboard la        WHERE la.player_id = p_user_id)::numeric,
    (SELECT ly.leaderboard_score FROM public.v_leaderboard_yearly ly WHERE ly.player_id = p_user_id)::numeric,
    (SELECT lm.leaderboard_score FROM public.v_leaderboard_monthly lm WHERE lm.player_id = p_user_id)::numeric,
    (SELECT lw.leaderboard_score FROM public.v_leaderboard_weekly lw WHERE lw.player_id = p_user_id)::numeric,
    -- Cumulative leaderboard
    (SELECT lca.rank_all_time  FROM public.v_leaderboard_cumulative lca          WHERE lca.player_id = p_user_id)::int,
    (SELECT lcy.rank_yearly    FROM public.v_leaderboard_yearly_cumulative lcy   WHERE lcy.player_id = p_user_id)::int,
    (SELECT lcm.rank_monthly   FROM public.v_leaderboard_monthly_cumulative lcm  WHERE lcm.player_id = p_user_id)::int,
    (SELECT lcw.rank_weekly    FROM public.v_leaderboard_weekly_cumulative lcw   WHERE lcw.player_id = p_user_id)::int,
    (SELECT lca.leaderboard_score FROM public.v_leaderboard_cumulative lca         WHERE lca.player_id = p_user_id)::numeric,
    (SELECT lcy.leaderboard_score FROM public.v_leaderboard_yearly_cumulative lcy  WHERE lcy.player_id = p_user_id)::numeric,
    (SELECT lcm.leaderboard_score FROM public.v_leaderboard_monthly_cumulative lcm WHERE lcm.player_id = p_user_id)::numeric,
    (SELECT lcw.leaderboard_score FROM public.v_leaderboard_weekly_cumulative lcw  WHERE lcw.player_id = p_user_id)::numeric,
    -- Tactical (from CTE — always 1 row)
    rs.sessions,
    rs.avg_time_sec,
    rs.obj_pct,
    rs.coop_pct,
    COALESCE((SELECT la.versus_wins   FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    COALESCE((SELECT la.versus_losses FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    -- Environment
    rs.viz_std, rs.viz_cosmic, rs.viz_rave, rs.viz_strobe, rs.viz_dark,
    rs.aud_tunes, rs.aud_cranked, rs.aud_off
  FROM run_stats rs;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_extended(uuid) TO authenticated;
