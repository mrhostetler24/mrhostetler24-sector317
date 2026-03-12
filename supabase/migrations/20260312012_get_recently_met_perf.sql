-- ============================================================
-- Migration: get_recently_met performance fix
-- Version:   20260312012
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Converts get_recently_met from LANGUAGE sql to plpgsql so
--   private_get_my_user_id() is called once and stored in a
--   variable, instead of being re-evaluated for every row in
--   both the JOIN and WHERE clauses (which caused timeouts).
-- ============================================================

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
    (SELECT COUNT(*)::bigint
     FROM   public.reservation_players rp2
     WHERE  rp2.user_id = u.id)                       AS total_runs,
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
