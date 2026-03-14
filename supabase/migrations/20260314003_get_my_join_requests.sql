-- ============================================================
-- Migration: get_my_join_requests RPC
-- Version:   20260314003
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds get_my_join_requests() so the PlatoonFinder can show
--   the current user's outbound pending join requests with
--   platoon details (tag, name, badge, color, requested_at).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_my_join_requests();

CREATE FUNCTION public.get_my_join_requests()
RETURNS TABLE (
  request_id   uuid,
  platoon_id   uuid,
  platoon_tag  text,
  platoon_name text,
  badge_url    text,
  badge_color  text,
  message      text,
  requested_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    jr.id           AS request_id,
    jr.platoon_id,
    p.tag           AS platoon_tag,
    p.name          AS platoon_name,
    p.badge_url,
    p.badge_color,
    jr.message,
    jr.requested_at
  FROM   public.platoon_join_requests jr
  JOIN   public.platoons              p  ON p.id = jr.platoon_id
  WHERE  jr.user_id = private_get_my_user_id()
  ORDER  BY jr.requested_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_join_requests() TO authenticated;
