-- ============================================================
-- Migration: get_friend_profile — return full phone number
-- Version:   20260313004
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Updates get_friend_profile to return the full phone number
--   (stripped to digits only) instead of just the last 4 digits
--   when hide_phone = false. Column renamed phone_last4 → phone.
--   Frontend formats it as (___) ___-____.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_friend_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_friend_profile(p_user_id uuid)
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
    (SELECT COUNT(*)::bigint
     FROM   public.reservation_players rp
     WHERE  rp.user_id = u.id)                                             AS total_runs,
    (SELECT ROUND(AVG(sr.score)::numeric, 1)
     FROM   public.reservation_players rp
     JOIN   public.session_runs sr ON sr.reservation_id = rp.reservation_id
     WHERE  rp.user_id = u.id
       AND  (sr.team IS NULL OR sr.team = rp.team))                        AS avg_score,
    (SELECT ROUND(MAX(sr.score)::numeric, 1)
     FROM   public.reservation_players rp
     JOIN   public.session_runs sr ON sr.reservation_id = rp.reservation_id
     WHERE  rp.user_id = u.id
       AND  (sr.team IS NULL OR sr.team = rp.team))                        AS best_run,
    u.access,
    u.platoon_tag,
    pl.badge_color                                                         AS platoon_badge_color
  FROM   public.users   u
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE  u.id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_friend_profile(uuid) TO authenticated;
