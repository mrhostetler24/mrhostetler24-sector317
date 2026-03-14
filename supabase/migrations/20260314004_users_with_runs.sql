-- ============================================================
-- Migration: get_all_users_with_runs RPC
-- Version:   20260314004
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Creates get_all_users_with_runs() so fetchAllUsers() can
--   return total_runs per user for tier icon display in the
--   customer portal reservation player chips.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_all_users_with_runs(int, int);

CREATE FUNCTION public.get_all_users_with_runs(
  p_limit  int DEFAULT 2000,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id                    uuid,
  name                  text,
  phone                 text,
  email                 text,
  auth_id               text,
  access                text,
  role                  text,
  active                boolean,
  auth_provider         text,
  needs_rewaiver_doc_id text,
  waivers               jsonb,
  leaderboard_name      text,
  hide_from_leaderboard boolean,
  is_real               boolean,
  created_by_user_id    uuid,
  created_at            timestamptz,
  avatar_url            text,
  hide_avatar           boolean,
  motto                 text,
  hide_motto            boolean,
  home_base_city        text,
  home_base_state       text,
  hide_home_base        boolean,
  profession            text,
  hide_profession       boolean,
  bio                   text,
  hide_bio              boolean,
  hide_phone            boolean,
  hide_email            boolean,
  hide_name             boolean,
  social_links          jsonb,
  credits               numeric,
  platoon_tag           text,
  platoon_badge_color   text,
  can_book              boolean,
  total_runs            int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    u.id, u.name, u.phone, u.email, u.auth_id, u.access, u.role,
    u.active, u.auth_provider, u.needs_rewaiver_doc_id,
    COALESCE(u.waivers, '[]'::jsonb)           AS waivers,
    u.leaderboard_name, u.hide_from_leaderboard,
    COALESCE(u.is_real, true)                  AS is_real,
    u.created_by_user_id, u.created_at,
    u.avatar_url, u.hide_avatar,
    u.motto, u.hide_motto,
    u.home_base_city, u.home_base_state, u.hide_home_base,
    u.profession, u.hide_profession,
    u.bio, u.hide_bio,
    u.hide_phone, u.hide_email, u.hide_name,
    COALESCE(u.social_links, '[]'::jsonb)      AS social_links,
    COALESCE(u.credits, 0)                     AS credits,
    u.platoon_tag, u.platoon_badge_color,
    COALESCE(u.can_book, false)                AS can_book,
    COALESCE(lb.total_runs, 0)::int            AS total_runs
  FROM   public.users u
  LEFT JOIN public.v_leaderboard lb ON lb.player_id = u.id
  ORDER  BY u.name
  LIMIT  p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION public.get_all_users_with_runs(int, int) TO authenticated;
