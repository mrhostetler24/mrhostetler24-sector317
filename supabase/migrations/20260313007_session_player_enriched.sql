-- ============================================================
-- Migration: Enrich session/upcoming player data
-- Version:   20260313007
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds total_runs and platoon_role to member_players jsonb
--   in both get_platoon_sessions and get_platoon_upcoming so
--   the frontend can show tier rank icons and platoon roles
--   next to each player name. Also adds total_runs to
--   all_players in get_platoon_upcoming for non-member players.
-- ============================================================


-- ── 1. get_platoon_sessions ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_platoon_sessions(uuid);

CREATE OR REPLACE FUNCTION public.get_platoon_sessions(p_platoon_id uuid)
RETURNS TABLE (
  reservation_id  uuid,
  date            date,
  start_time      text,
  type_name       text,
  mode            text,
  war_winner_team int,
  war_win_type    text,
  member_players  jsonb,
  runs            jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH member_info AS (
    SELECT
      pm.user_id,
      pm.role                                          AS platoon_role,
      COALESCE(u.leaderboard_name, u.name)             AS leaderboard_name,
      u.avatar_url,
      u.platoon_tag,
      u.platoon_badge_color,
      lb.rank_all_time,
      COALESCE(lb.total_runs, 0)::int                  AS total_runs
    FROM   public.platoon_members pm
    JOIN   public.users u          ON u.id = pm.user_id
    LEFT JOIN public.v_leaderboard lb ON lb.player_id = pm.user_id
    WHERE  pm.platoon_id = p_platoon_id
  )
  SELECT
    reservation_id, date, start_time, type_name, mode,
    war_winner_team, war_win_type, member_players, runs
  FROM (
    SELECT DISTINCT ON (r.id)
      r.id                AS reservation_id,
      r.date,
      r.start_time::text,
      rt.name             AS type_name,
      rt.mode,
      r.war_winner_team,
      r.war_win_type,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'user_id',            mi.user_id,
          'leaderboard_name',   mi.leaderboard_name,
          'avatar_url',         mi.avatar_url,
          'platoon_tag',        mi.platoon_tag,
          'platoon_badge_color',mi.platoon_badge_color,
          'leaderboard_rank',   mi.rank_all_time,
          'total_runs',         mi.total_runs,
          'platoon_role',       mi.platoon_role
        ))
        FROM   public.reservation_players rp2
        JOIN   member_info mi ON mi.user_id = rp2.user_id
        WHERE  rp2.reservation_id = r.id
      ) AS member_players,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'run_id',             vpr.run_id,
            'run_number',         vpr.run_number,
            'user_id',            vpr.player_id,
            'leaderboard_name',   COALESCE(u2.leaderboard_name, u2.name),
            'is_member',          (mi2.user_id IS NOT NULL),
            'team',               vpr.player_group,
            'role',               vpr.role,
            'score',              vpr.effective_score,
            'elapsed_seconds',    vpr.elapsed_seconds,
            'winning_team',       vpr.winning_team,
            'objective_complete', vpr.objective_complete,
            'visual',             vpr.visual,
            'audio',              vpr.audio,
            'cranked',            vpr.cranked
          ) ORDER BY vpr.run_number, vpr.player_group
        )
        FROM   public.v_player_runs      vpr
        JOIN   public.users              u2  ON u2.id = vpr.player_id
        LEFT JOIN member_info            mi2 ON mi2.user_id = vpr.player_id
        WHERE  vpr.reservation_id = r.id
      ) AS runs
    FROM   public.reservations        r
    JOIN   public.reservation_types   rt ON rt.id = r.type_id
    JOIN   public.reservation_players rp ON rp.reservation_id = r.id
    JOIN   member_info                pm ON pm.user_id = rp.user_id
    WHERE  r.date < CURRENT_DATE
      AND  EXISTS (
             SELECT 1 FROM public.platoon_members
             WHERE  platoon_id = p_platoon_id
               AND  user_id = private_get_my_user_id()
           )
    ORDER  BY r.id
  ) sub
  ORDER BY sub.date DESC, sub.start_time DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_sessions(uuid) TO authenticated;


-- ── 2. get_platoon_upcoming ───────────────────────────────────────────────────

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
      pm.role                                          AS platoon_role,
      COALESCE(u.leaderboard_name, u.name)             AS leaderboard_name,
      u.avatar_url,
      u.platoon_tag,
      u.platoon_badge_color,
      lb.rank_all_time,
      COALESCE(lb.total_runs, 0)::int                  AS total_runs
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
    -- platoon members only (backward compat)
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',            mi.user_id,
        'leaderboard_name',   mi.leaderboard_name,
        'avatar_url',         mi.avatar_url,
        'platoon_tag',        mi.platoon_tag,
        'platoon_badge_color',mi.platoon_badge_color,
        'leaderboard_rank',   mi.rank_all_time,
        'total_runs',         mi.total_runs,
        'platoon_role',       mi.platoon_role
      ))
      FROM   public.reservation_players rp2
      JOIN   member_info mi ON mi.user_id = rp2.user_id
      WHERE  rp2.reservation_id = r.id
    ) AS member_players,
    -- all players: members first, with is_member + total_runs + platoon_role
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',            u2.id,
        'leaderboard_name',   COALESCE(u2.leaderboard_name, u2.name),
        'avatar_url',         u2.avatar_url,
        'platoon_tag',        u2.platoon_tag,
        'platoon_badge_color',u2.platoon_badge_color,
        'is_member',          (mi2.user_id IS NOT NULL),
        'total_runs',         COALESCE(lb2.total_runs, 0)::int,
        'platoon_role',       mi2.platoon_role
      ) ORDER BY (mi2.user_id IS NOT NULL) DESC,
                 COALESCE(u2.leaderboard_name, u2.name))
      FROM   public.reservation_players rp2
      JOIN   public.users u2 ON u2.id = rp2.user_id
      LEFT JOIN member_info mi2 ON mi2.user_id = rp2.user_id
      LEFT JOIN public.v_leaderboard lb2 ON lb2.player_id = u2.id
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
