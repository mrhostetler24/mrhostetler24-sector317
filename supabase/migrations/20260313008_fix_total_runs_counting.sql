-- ============================================================
-- Migration: Fix total_runs counting in social RPCs
-- Version:   20260313008
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   get_friend_profile, search_players, and get_recently_met all
--   computed total_runs as COUNT(reservation_players) — one row per
--   session appearance. The leaderboard views use SUM(session_runs)
--   which counts individual run records (~2 per versus session).
--
--   This mismatch caused:
--   - "All (5) but Co-op (8)" impossibility in profile stats
--   - Tier icons in friend modal / Connect tab to show wrong tier
--   - "Total Runs" in friend profile to be ~50% of actual for
--     players who have played many versus sessions
--
--   Fix: join v_leaderboard (which aggregates from session_runs)
--   so all surfaces use the same counting method.
-- ============================================================


-- ── 1. get_friend_profile ─────────────────────────────────────────────────────

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
    COALESCE(vlb.total_runs, 0)::bigint                                    AS total_runs,
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
  LEFT JOIN public.v_leaderboard   vlb ON vlb.player_id = u.id
  LEFT JOIN public.platoons         pl  ON pl.tag        = u.platoon_tag
  WHERE  u.id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_friend_profile(uuid) TO authenticated;


-- ── 2. search_players ─────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname = 'search_players'
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END;
$$;

CREATE FUNCTION public.search_players(p_query text)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := private_get_my_user_id();
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    COALESCE(u.leaderboard_name, u.name)                               AS leaderboard_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)                                     AS hide_avatar,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 4)
    END                                                                AS phone_last4,
    COALESCE(vlb.total_runs, 0)::bigint                                AS total_runs,
    u.platoon_tag,
    pl.badge_color                                                     AS platoon_badge_color
  FROM   public.users u
  LEFT JOIN public.v_leaderboard vlb ON vlb.player_id = u.id
  LEFT JOIN public.platoons        pl ON pl.tag        = u.platoon_tag
  WHERE  u.id != v_me
    AND  (
           LOWER(COALESCE(u.leaderboard_name, u.name)) LIKE '%' || LOWER(p_query) || '%'
        OR REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g')
             LIKE '%' || REGEXP_REPLACE(p_query, '[^0-9]', '', 'g') || '%'
         )
  ORDER BY COALESCE(u.leaderboard_name, u.name)
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_players(text) TO authenticated;


-- ── 3. get_recently_met ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_recently_met(int, int);

CREATE FUNCTION public.get_recently_met(p_limit int DEFAULT 20, p_offset int DEFAULT 0)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := private_get_my_user_id();
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    COALESCE(u.leaderboard_name, u.name)              AS leaderboard_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)                    AS hide_avatar,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE RIGHT(REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g'), 4)
    END                                               AS phone_last4,
    COALESCE(vlb.total_runs, 0)::bigint               AS total_runs,
    MAX(r.date)                                       AS last_together,
    u.platoon_tag,
    pl.badge_color                                    AS platoon_badge_color
  FROM   public.reservation_players rp
  JOIN   public.reservations          r    ON r.id  = rp.reservation_id
  JOIN   public.reservation_players   rpme ON rpme.reservation_id = r.id
                                          AND rpme.user_id = v_me
  JOIN   public.users                 u    ON u.id  = rp.user_id
  LEFT JOIN public.v_leaderboard      vlb  ON vlb.player_id = u.id
  LEFT JOIN public.platoons           pl   ON pl.tag = u.platoon_tag
  WHERE  rp.user_id != v_me
    AND  r.date <= CURRENT_DATE
  GROUP BY u.id, u.leaderboard_name, u.name, u.avatar_url, u.hide_avatar,
           u.hide_phone, u.phone, u.platoon_tag, pl.badge_color, vlb.total_runs
  ORDER BY MAX(r.date) DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recently_met(int, int) TO authenticated;
