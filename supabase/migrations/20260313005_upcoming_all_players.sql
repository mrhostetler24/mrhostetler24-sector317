-- ============================================================
-- Migration: get_platoon_upcoming — include all players
-- Version:   20260313005
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds all_players jsonb to get_platoon_upcoming, listing
--   every player booked for the reservation with an is_member
--   boolean flag so the frontend can highlight platoonmates.
--   Platoon members appear first in the sorted list.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_platoon_upcoming(uuid);

CREATE OR REPLACE FUNCTION public.get_platoon_upcoming(p_platoon_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  date           date,
  start_time     text,
  type_name      text,
  member_players jsonb,
  all_players    jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH member_info AS (
    SELECT
      pm.user_id,
      COALESCE(u.leaderboard_name, u.name) AS leaderboard_name,
      u.avatar_url,
      u.platoon_tag,
      u.platoon_badge_color,
      lb.rank_all_time
    FROM   public.platoon_members pm
    JOIN   public.users u          ON u.id = pm.user_id
    LEFT JOIN public.v_leaderboard lb ON lb.player_id = pm.user_id
    WHERE  pm.platoon_id = p_platoon_id
  )
  SELECT DISTINCT ON (r.id)
    r.id AS reservation_id,
    r.date,
    r.start_time::text,
    rt.name AS type_name,
    -- platoon members only (for backward compat)
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',            mi.user_id,
        'leaderboard_name',   mi.leaderboard_name,
        'avatar_url',         mi.avatar_url,
        'platoon_tag',        mi.platoon_tag,
        'platoon_badge_color',mi.platoon_badge_color,
        'leaderboard_rank',   mi.rank_all_time
      ))
      FROM   public.reservation_players rp2
      JOIN   member_info mi ON mi.user_id = rp2.user_id
      WHERE  rp2.reservation_id = r.id
    ) AS member_players,
    -- all players with is_member flag; platoon members sorted first
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',            u2.id,
        'leaderboard_name',   COALESCE(u2.leaderboard_name, u2.name),
        'avatar_url',         u2.avatar_url,
        'platoon_tag',        u2.platoon_tag,
        'platoon_badge_color',u2.platoon_badge_color,
        'is_member',          (mi2.user_id IS NOT NULL)
      ) ORDER BY (mi2.user_id IS NOT NULL) DESC,
                 COALESCE(u2.leaderboard_name, u2.name))
      FROM   public.reservation_players rp2
      JOIN   public.users u2 ON u2.id = rp2.user_id
      LEFT JOIN member_info mi2 ON mi2.user_id = rp2.user_id
      WHERE  rp2.reservation_id = r.id
    ) AS all_players
  FROM   public.reservations r
  JOIN   public.reservation_types rt ON rt.id = r.type_id
  JOIN   public.reservation_players rp ON rp.reservation_id = r.id
  JOIN   member_info pm ON pm.user_id = rp.user_id
  WHERE  r.date >= CURRENT_DATE
    AND  EXISTS (
      SELECT 1 FROM public.platoon_members
      WHERE  platoon_id = p_platoon_id
      AND    user_id = private_get_my_user_id()
    )
  ORDER  BY r.id, r.date ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_upcoming(uuid) TO authenticated;
