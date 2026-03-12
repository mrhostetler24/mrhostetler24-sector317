-- ============================================================
-- Migration: Platoon Members with Leaderboard Rank
-- Version:   20260312006
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Updates get_platoon_members to also return each member's
--   all-time leaderboard rank, score, and total runs
--   (for tier icon + rank display on the members tab).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_platoon_members(uuid);

CREATE OR REPLACE FUNCTION public.get_platoon_members(p_platoon_id uuid)
RETURNS TABLE (
  user_id          uuid,
  role             text,
  joined_at        timestamptz,
  leaderboard_name text,
  real_name        text,
  avatar_url       text,
  hide_avatar      boolean,
  platoon_tag      text,
  leaderboard_rank bigint,
  leaderboard_score numeric,
  total_runs       int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT pm.user_id, pm.role, pm.joined_at,
         COALESCE(u.leaderboard_name, u.name) AS leaderboard_name,
         u.name AS real_name,
         u.avatar_url,
         COALESCE(u.hide_avatar, false) AS hide_avatar,
         u.platoon_tag,
         lb.rank_all_time  AS leaderboard_rank,
         lb.leaderboard_score,
         lb.total_runs_played AS total_runs
  FROM   public.platoon_members pm
  JOIN   public.users u ON u.id = pm.user_id
  LEFT JOIN public.v_leaderboard lb ON lb.player_id = pm.user_id
  WHERE  pm.platoon_id = p_platoon_id
  ORDER  BY
    CASE pm.role WHEN 'admin' THEN 1 WHEN 'sergeant' THEN 2 ELSE 3 END,
    pm.joined_at;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_members(uuid) TO authenticated;
