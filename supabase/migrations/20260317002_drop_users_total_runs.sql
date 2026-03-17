-- ============================================================
-- Migration: Drop users.total_runs + fix search_players/get_recently_met
-- Version:   20260317002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   1. users.total_runs is a stale stored column — nothing in current code
--      ever updates it. The leaderboard views (v_leaderboard, etc.) compute
--      the accurate run count from session_runs directly.
--
--   2. search_players and get_recently_met share the same v_leaderboard
--      LEFT JOIN bug as get_friend_profile (fixed in 20260317001): users
--      with is_real=false get a NULL join → COALESCE(NULL,0) = 0.
--
--   Fix:
--   - Drop users.total_runs (was read-only/stale; views replace it)
--   - Rebuild search_players and get_recently_met to count runs directly
--     from session_runs (same pattern as the 20260317001 get_friend_profile
--     fix), eliminating the v_leaderboard dependency entirely.
-- ============================================================


-- ── 1. Drop stale stored column ───────────────────────────────────────────────

ALTER TABLE public.users DROP COLUMN IF EXISTS total_runs;


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
    -- Count runs directly from session_runs — unaffected by is_real/leaderboard visibility.
    (SELECT COUNT(*)::bigint
     FROM   public.session_runs     sr_cnt
     JOIN   public.reservation_players rp_cnt
       ON   rp_cnt.reservation_id = sr_cnt.reservation_id
       AND  rp_cnt.user_id = u.id
     WHERE  sr_cnt.role IS NULL
         OR (sr_cnt.team = rp_cnt.team
             OR (rp_cnt.team IS NULL AND sr_cnt.team = 1)))            AS total_runs,
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
    -- Count runs directly from session_runs — unaffected by is_real/leaderboard visibility.
    (SELECT COUNT(*)::bigint
     FROM   public.session_runs     sr_cnt
     JOIN   public.reservation_players rp_cnt
       ON   rp_cnt.reservation_id = sr_cnt.reservation_id
       AND  rp_cnt.user_id = u.id
     WHERE  sr_cnt.role IS NULL
         OR (sr_cnt.team = rp_cnt.team
             OR (rp_cnt.team IS NULL AND sr_cnt.team = 1)))            AS total_runs,
    MAX(r.date)                                       AS last_together,
    u.platoon_tag,
    pl.badge_color                                    AS platoon_badge_color
  FROM   public.reservation_players rp
  JOIN   public.reservations          r    ON r.id  = rp.reservation_id
  JOIN   public.reservation_players   rpme ON rpme.reservation_id = r.id
                                          AND rpme.user_id = v_me
  JOIN   public.users                 u    ON u.id  = rp.user_id
  LEFT JOIN public.platoons           pl   ON pl.tag = u.platoon_tag
  WHERE  rp.user_id != v_me
    AND  r.date <= CURRENT_DATE
  GROUP BY u.id, u.leaderboard_name, u.name, u.avatar_url, u.hide_avatar,
           u.hide_phone, u.phone, u.platoon_tag, pl.badge_color
  ORDER BY MAX(r.date) DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recently_met(int, int) TO authenticated;
