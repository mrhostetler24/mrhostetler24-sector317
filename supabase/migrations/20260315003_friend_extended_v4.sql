-- ============================================================
-- Migration: 20260315003_friend_extended_v4
-- Version:   20260315003
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds co-op and versus breakdown columns to get_friend_extended:
--
--   Co-op:
--     coop_runs            — count of co-op runs (role IS NULL)
--     coop_avg_time_sec    — avg elapsed seconds for co-op runs
--     coop_targets_pct     — % co-op runs where targets_eliminated = true
--     coop_obj_pct         — % co-op runs where objective_complete = true
--
--   Versus (player's team row only; legacy fallback = team=1):
--     versus_runs          — deduplicated run count
--     versus_hunter_avg_sec — avg elapsed when player's team was hunter
--     versus_coyote_avg_sec — avg elapsed when player's team was coyote
--     versus_obj_pct       — % hunter runs where objective_complete = true (coyotes have no objective)
--
--   NOTE: team=1 is NOT always hunter. sr.role tells the role per run.
--   Player's team is rp.team; legacy records (rp.team IS NULL) fall back
--   to team=1 for deduplication.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_friend_extended(uuid);

CREATE OR REPLACE FUNCTION public.get_friend_extended(p_user_id uuid)
RETURNS TABLE (
  -- Avg leaderboard
  rank_all_time           int,
  rank_yearly             int,
  rank_monthly            int,
  rank_weekly             int,
  score_all_time          numeric,
  score_yearly            numeric,
  score_monthly           numeric,
  score_weekly            numeric,
  -- Cumulative leaderboard
  rank_cum_all_time       int,
  rank_cum_yearly         int,
  rank_cum_monthly        int,
  rank_cum_weekly         int,
  score_cum_all_time      numeric,
  score_cum_yearly        numeric,
  score_cum_monthly       numeric,
  score_cum_weekly        numeric,
  -- Tactical — overall
  sessions                int,
  avg_time_sec            int,
  obj_pct                 numeric,
  coop_pct                numeric,
  versus_wins             int,
  versus_losses           int,
  -- Tactical — co-op breakdown
  coop_runs               int,
  coop_avg_time_sec       int,
  coop_targets_pct        numeric,
  coop_obj_pct            numeric,
  -- Tactical — versus breakdown
  versus_runs             int,
  versus_hunter_avg_sec   int,
  versus_coyote_avg_sec   int,
  versus_obj_pct          numeric,
  -- Environment preferences
  viz_std                 numeric,
  viz_cosmic              numeric,
  viz_rave                numeric,
  viz_strobe              numeric,
  viz_dark                numeric,
  aud_tunes               numeric,
  aud_cranked             numeric,
  aud_off                 numeric
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH run_stats AS (
    SELECT
      -- Sessions
      COUNT(DISTINCT sr.reservation_id)::int                                           AS sessions,

      -- Overall avg time (deduped: co-op rows + player's team row for versus)
      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0
          AND (sr.role IS NULL
               OR sr.team = rp.team
               OR (rp.team IS NULL AND sr.team = 1))))::int                            AS avg_time_sec,

      -- Overall obj_pct (deduped)
      ROUND(100.0 * COUNT(*) FILTER (
          WHERE sr.objective_complete = true
            AND (sr.role IS NULL
                 OR sr.team = rp.team
                 OR (rp.team IS NULL AND sr.team = 1)))
        / NULLIF(COUNT(*) FILTER (
            WHERE sr.role IS NULL
               OR sr.team = rp.team
               OR (rp.team IS NULL AND sr.team = 1)), 0), 1)                          AS obj_pct,

      -- coop_pct: co-op runs / deduped total
      ROUND(100.0 * COUNT(*) FILTER (WHERE sr.role IS NULL)
        / NULLIF(COUNT(*) FILTER (
            WHERE sr.role IS NULL OR sr.team = 1), 0), 1)                             AS coop_pct,

      -- ── Co-op breakdown ──────────────────────────────────────────────────
      COUNT(*) FILTER (WHERE sr.role IS NULL)::int                                    AS coop_runs,

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
      -- Deduplicate: take the row matching the player's team (rp.team),
      -- fallback to team=1 for legacy records where rp.team IS NULL.
      COUNT(*) FILTER (
        WHERE sr.role IS NOT NULL
          AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1)))::int          AS versus_runs,

      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.role = 'hunter'
          AND sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0
          AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))))::int         AS versus_hunter_avg_sec,

      ROUND(AVG(sr.elapsed_seconds) FILTER (
        WHERE sr.role = 'coyote'
          AND sr.elapsed_seconds IS NOT NULL AND sr.elapsed_seconds > 0
          AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))))::int         AS versus_coyote_avg_sec,

      -- Only hunter runs have objectives; coyotes are defenders with no objective
      ROUND(100.0 * COUNT(*) FILTER (
          WHERE sr.objective_complete = true AND sr.role = 'hunter'
            AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1)))
        / NULLIF(COUNT(*) FILTER (
            WHERE sr.role = 'hunter'
              AND (sr.team = rp.team OR (rp.team IS NULL AND sr.team = 1))), 0), 1)   AS versus_obj_pct,

      -- ── Visuals (session-level; duplicates cancel in ratios) ─────────────
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
    -- Avg leaderboard
    (SELECT la.rank_all_time     FROM public.v_leaderboard la          WHERE la.player_id = p_user_id)::int,
    (SELECT ly.rank_yearly       FROM public.v_leaderboard_yearly ly   WHERE ly.player_id = p_user_id)::int,
    (SELECT lm.rank_monthly      FROM public.v_leaderboard_monthly lm  WHERE lm.player_id = p_user_id)::int,
    (SELECT lw.rank_weekly       FROM public.v_leaderboard_weekly lw   WHERE lw.player_id = p_user_id)::int,
    (SELECT la.leaderboard_score FROM public.v_leaderboard la          WHERE la.player_id = p_user_id)::numeric,
    (SELECT ly.leaderboard_score FROM public.v_leaderboard_yearly ly   WHERE ly.player_id = p_user_id)::numeric,
    (SELECT lm.leaderboard_score FROM public.v_leaderboard_monthly lm  WHERE lm.player_id = p_user_id)::numeric,
    (SELECT lw.leaderboard_score FROM public.v_leaderboard_weekly lw   WHERE lw.player_id = p_user_id)::numeric,
    -- Cumulative leaderboard
    (SELECT lca.rank_all_time    FROM public.v_leaderboard_cumulative lca          WHERE lca.player_id = p_user_id)::int,
    (SELECT lcy.rank_yearly      FROM public.v_leaderboard_yearly_cumulative lcy   WHERE lcy.player_id = p_user_id)::int,
    (SELECT lcm.rank_monthly     FROM public.v_leaderboard_monthly_cumulative lcm  WHERE lcm.player_id = p_user_id)::int,
    (SELECT lcw.rank_weekly      FROM public.v_leaderboard_weekly_cumulative lcw   WHERE lcw.player_id = p_user_id)::int,
    (SELECT lca.leaderboard_score FROM public.v_leaderboard_cumulative lca          WHERE lca.player_id = p_user_id)::numeric,
    (SELECT lcy.leaderboard_score FROM public.v_leaderboard_yearly_cumulative lcy   WHERE lcy.player_id = p_user_id)::numeric,
    (SELECT lcm.leaderboard_score FROM public.v_leaderboard_monthly_cumulative lcm  WHERE lcm.player_id = p_user_id)::numeric,
    (SELECT lcw.leaderboard_score FROM public.v_leaderboard_weekly_cumulative lcw   WHERE lcw.player_id = p_user_id)::numeric,
    -- Tactical — overall
    rs.sessions,
    rs.avg_time_sec,
    rs.obj_pct,
    rs.coop_pct,
    COALESCE((SELECT la.versus_wins   FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    COALESCE((SELECT la.versus_losses FROM public.v_leaderboard la WHERE la.player_id = p_user_id), 0)::int,
    -- Tactical — co-op breakdown
    rs.coop_runs,
    rs.coop_avg_time_sec,
    rs.coop_targets_pct,
    rs.coop_obj_pct,
    -- Tactical — versus breakdown
    rs.versus_runs,
    rs.versus_hunter_avg_sec,
    rs.versus_coyote_avg_sec,
    rs.versus_obj_pct,
    -- Environment
    rs.viz_std, rs.viz_cosmic, rs.viz_rave, rs.viz_strobe, rs.viz_dark,
    rs.aud_tunes, rs.aud_cranked, rs.aud_off
  FROM run_stats rs;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_extended(uuid) TO authenticated;
