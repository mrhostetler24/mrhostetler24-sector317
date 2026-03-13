-- ============================================================
-- Migration: fix search_players 500 error
-- Version:   20260313006
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   search_players was returning a 500 Internal Server Error.
--   Root cause is likely a stale overload or return-type mismatch
--   left behind by earlier migrations that couldn't use
--   CREATE OR REPLACE to change the RETURNS TABLE signature.
--   This migration drops ALL overloads via pg_proc (avoids
--   needing the exact signature), then recreates the function
--   cleanly as plpgsql with private_get_my_user_id() called
--   once (same pattern used to fix get_recently_met timeouts).
-- ============================================================


-- ── Drop ALL overloads ────────────────────────────────────────
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


-- ── Recreate cleanly ─────────────────────────────────────────
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
    (SELECT COUNT(*)::bigint
     FROM   public.reservation_players rp
     WHERE  rp.user_id = u.id)                                         AS total_runs,
    u.platoon_tag,
    pl.badge_color                                                     AS platoon_badge_color
  FROM   public.users u
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
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
