-- ============================================================
-- Migration: fix get_friend_profile avg_score / best_run
-- Version:   20260324001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   avg_score and best_run in get_friend_profile used AVG/MAX of
--   raw sr.score.  The leaderboard views use v_player_runs.effective_score
--   which adds a war_bonus (25 for SWEEP, 15 for TIEBREAK) to the
--   winning hunter's runs.  This caused the two numbers to disagree
--   for any player who had a versus win.
--
--   Fix: replace the direct session_runs subqueries with equivalent
--   queries against v_player_runs, which already handles team
--   matching, role filtering, and the war bonus — exactly as the
--   leaderboard does.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_friend_profile(uuid);

CREATE FUNCTION public.get_friend_profile(p_user_id uuid)
RETURNS TABLE (
  leaderboard_name    text,
  real_name           text,
  avatar_url          text,
  hide_avatar         boolean,
  profession          text,
  home_base_city      text,
  home_base_state     text,
  phone               text,
  email               text,
  motto               text,
  bio                 text,
  total_runs          bigint,
  avg_score           numeric,
  best_run            numeric,
  access              text,
  platoon_tag         text,
  platoon_badge_color text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(u.leaderboard_name, u.name)                                   AS leaderboard_name,
    CASE WHEN COALESCE(u.hide_name, false)       THEN NULL ELSE u.name       END AS real_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)                                         AS hide_avatar,
    CASE WHEN COALESCE(u.hide_profession, false) THEN NULL ELSE u.profession END AS profession,
    CASE WHEN COALESCE(u.hide_home_base, false)  THEN NULL ELSE u.home_base_city  END AS home_base_city,
    CASE WHEN COALESCE(u.hide_home_base, false)  THEN NULL ELSE u.home_base_state END AS home_base_state,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE NULLIF(REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g'), '')
    END                                                                    AS phone,
    CASE WHEN COALESCE(u.hide_email, false) THEN NULL ELSE u.email END     AS email,
    CASE WHEN COALESCE(u.hide_motto, false) THEN NULL ELSE u.motto END     AS motto,
    CASE WHEN COALESCE(u.hide_bio,   false) THEN NULL ELSE u.bio   END     AS bio,
    -- Use v_player_runs for all three scoring stats so they stay in sync
    -- with the leaderboard (effective_score = raw score + war bonus).
    (SELECT COUNT(*)::bigint          FROM public.v_player_runs WHERE player_id = u.id) AS total_runs,
    (SELECT ROUND(AVG(effective_score)::numeric, 1) FROM public.v_player_runs WHERE player_id = u.id) AS avg_score,
    (SELECT ROUND(MAX(effective_score)::numeric, 1) FROM public.v_player_runs WHERE player_id = u.id) AS best_run,
    u.access,
    u.platoon_tag,
    pl.badge_color                                                         AS platoon_badge_color
  FROM   public.users   u
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE  u.id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_profile(uuid) TO authenticated;
