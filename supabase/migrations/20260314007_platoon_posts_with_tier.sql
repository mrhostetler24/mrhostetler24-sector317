-- ============================================================
-- Migration: get_platoon_posts — add total_runs + member_role
-- Version:   20260314007
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Replaces get_platoon_posts to also return:
--     total_runs  — career run count (used to render tier icon in the UI)
--     member_role — poster's current platoon role (admin/sergeant/member)
-- ============================================================

DROP FUNCTION IF EXISTS public.get_platoon_posts(uuid, int, int);

CREATE FUNCTION public.get_platoon_posts(
  p_platoon_id uuid,
  p_limit      int  DEFAULT 20,
  p_offset     int  DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  platoon_id       uuid,
  user_id          uuid,
  content          text,
  created_at       timestamptz,
  leaderboard_name text,
  avatar_url       text,
  hide_avatar      boolean,
  total_runs       bigint,
  member_role      text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pp.id, pp.platoon_id, pp.user_id, pp.content, pp.created_at,
    COALESCE(u.leaderboard_name, u.name)  AS leaderboard_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)        AS hide_avatar,
    COALESCE(
      (SELECT SUM(ps.run_count)
       FROM   v_player_sessions ps
       WHERE  ps.player_id = pp.user_id),
      0
    )::bigint                             AS total_runs,
    pm.role                               AS member_role
  FROM   public.platoon_posts pp
  JOIN   public.users u ON u.id = pp.user_id
  LEFT   JOIN public.platoon_members pm
         ON  pm.user_id    = pp.user_id
         AND pm.platoon_id = p_platoon_id
  WHERE  pp.platoon_id = p_platoon_id
  AND    EXISTS (
    SELECT 1 FROM public.platoon_members
    WHERE  platoon_id = p_platoon_id
    AND    user_id    = private_get_my_user_id()
  )
  ORDER  BY pp.created_at DESC
  LIMIT  p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_platoon_posts(uuid, int, int) TO authenticated;
