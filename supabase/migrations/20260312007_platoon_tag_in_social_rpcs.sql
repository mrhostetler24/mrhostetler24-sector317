-- ============================================================
-- Migration: Platoon Tag in Social RPCs
-- Version:   20260312007
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds platoon_tag + platoon_badge_color to:
--   1. search_players  — player search results in Connect tab
--   2. get_recently_met — recently played-with players in Connect tab
--   3. get_friend_profile — friend/profile modal
--   So that [TAG] chips appear everywhere player names are shown.
-- ============================================================


-- ── 1. search_players ─────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.search_players(text);

CREATE OR REPLACE FUNCTION public.search_players(p_query text)
RETURNS TABLE (
  id                  uuid,
  leaderboard_name    text,
  avatar_url          text,
  hide_avatar         boolean,
  phone_last4         text,
  total_runs          bigint,
  platoon_tag         text,
  platoon_badge_color text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    u.id,
    COALESCE(u.leaderboard_name, u.name)              AS leaderboard_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)                    AS hide_avatar,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE RIGHT(REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g'), 4)
    END                                               AS phone_last4,
    (SELECT COUNT(*)::bigint
     FROM   public.reservation_players rp
     WHERE  rp.user_id = u.id)                        AS total_runs,
    u.platoon_tag,
    pl.badge_color                                    AS platoon_badge_color
  FROM   public.users    u
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE  u.id != private_get_my_user_id()
    AND  (
           LOWER(COALESCE(u.leaderboard_name, u.name)) LIKE '%' || LOWER(p_query) || '%'
        OR REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g')
             LIKE '%' || REGEXP_REPLACE(p_query, '[^0-9]', '', 'g') || '%'
         )
  ORDER BY COALESCE(u.leaderboard_name, u.name)
  LIMIT 20;
$$;
GRANT EXECUTE ON FUNCTION public.search_players(text) TO authenticated;


-- ── 2. get_recently_met ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_recently_met(int, int);

CREATE OR REPLACE FUNCTION public.get_recently_met(p_limit int DEFAULT 20, p_offset int DEFAULT 0)
RETURNS TABLE (
  id                  uuid,
  leaderboard_name    text,
  avatar_url          text,
  hide_avatar         boolean,
  phone_last4         text,
  total_runs          bigint,
  last_together       date,
  platoon_tag         text,
  platoon_badge_color text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    u.id,
    COALESCE(u.leaderboard_name, u.name)              AS leaderboard_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)                    AS hide_avatar,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE RIGHT(REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g'), 4)
    END                                               AS phone_last4,
    (SELECT COUNT(*)::bigint
     FROM   public.reservation_players rp2
     WHERE  rp2.user_id = u.id)                       AS total_runs,
    MAX(r.date)                                       AS last_together,
    u.platoon_tag,
    pl.badge_color                                    AS platoon_badge_color
  FROM   public.reservation_players rp
  JOIN   public.reservations          r    ON r.id  = rp.reservation_id
  JOIN   public.reservation_players   rpme ON rpme.reservation_id = r.id
                                          AND rpme.user_id = private_get_my_user_id()
  JOIN   public.users                 u    ON u.id  = rp.user_id
  LEFT JOIN public.platoons           pl   ON pl.tag = u.platoon_tag
  WHERE  rp.user_id != private_get_my_user_id()
    AND  r.date <= CURRENT_DATE
  GROUP BY u.id, u.leaderboard_name, u.name, u.avatar_url, u.hide_avatar,
           u.hide_phone, u.phone, u.platoon_tag, pl.badge_color
  ORDER BY MAX(r.date) DESC
  LIMIT p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION public.get_recently_met(int, int) TO authenticated;


-- ── 3. get_friend_profile — add platoon_badge_color ───────────────────────────

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
  phone_last4         text,
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
         ELSE RIGHT(REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g'), 4)
    END                                                                    AS phone_last4,
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
