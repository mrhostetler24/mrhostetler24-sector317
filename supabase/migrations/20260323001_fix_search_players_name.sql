-- ============================================================
-- Migration: fix search_players name + leaderboard search
-- Version:   20260323001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   1. COALESCE(leaderboard_name, name) meant real name was never searched
--      when a leaderboard name existed — searching "Hostettler" missed users
--      whose leaderboard name didn't match.
--   2. Phone digit-strip produced '' for text queries, making the phone
--      condition LIKE '%%' and matching every row (irrelevant results).
--   3. ORDER BY was alphabetical only — no relevance ranking.
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
  v_me        uuid := private_get_my_user_id();
  v_q_lower   text := LOWER(p_query);
  v_q_digits  text := REGEXP_REPLACE(p_query, '[^0-9]', '', 'g');
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
           LOWER(u.name)                          LIKE '%' || v_q_lower  || '%'
        OR LOWER(COALESCE(u.leaderboard_name,'')) LIKE '%' || v_q_lower  || '%'
        OR (v_q_digits != '' AND
            REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g')
              LIKE '%' || v_q_digits || '%')
         )
  ORDER BY
    -- Exact match first
    CASE WHEN LOWER(u.name) = v_q_lower
           OR LOWER(COALESCE(u.leaderboard_name,'')) = v_q_lower
         THEN 0 ELSE 1 END,
    -- Starts-with next
    CASE WHEN LOWER(u.name) LIKE v_q_lower || '%'
           OR LOWER(COALESCE(u.leaderboard_name,'')) LIKE v_q_lower || '%'
         THEN 0 ELSE 1 END,
    -- Then alphabetical
    LOWER(COALESCE(u.leaderboard_name, u.name))
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_players(text) TO authenticated;
