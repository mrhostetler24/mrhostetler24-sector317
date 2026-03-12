-- ============================================================
-- Migration: Platoon Sessions — member_players with rank/tag
-- Version:   20260312010
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Updates get_platoon_sessions and get_platoon_upcoming to
--   include platoon_tag, platoon_badge_color, and leaderboard_rank
--   in each member_players JSON object, so the Sessions tab can
--   show leaderboard names, ranks, and platoon tags in the header.
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
          'user_id',            u.id,
          'leaderboard_name',   COALESCE(u.leaderboard_name, u.name),
          'avatar_url',         u.avatar_url,
          'platoon_tag',        u.platoon_tag,
          'platoon_badge_color',u.platoon_badge_color,
          'leaderboard_rank',   lb.rank_all_time
        ))
        FROM   public.reservation_players rp2
        JOIN   public.platoon_members     pm2 ON pm2.user_id = rp2.user_id AND pm2.platoon_id = p_platoon_id
        JOIN   public.users               u   ON u.id = rp2.user_id
        LEFT JOIN public.v_leaderboard    lb  ON lb.player_id = u.id
        WHERE  rp2.reservation_id = r.id
      ) AS member_players,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'run_id',             vpr.run_id,
            'run_number',         vpr.run_number,
            'user_id',            vpr.player_id,
            'leaderboard_name',   COALESCE(u2.leaderboard_name, u2.name),
            'is_member',          (pm3.user_id IS NOT NULL),
            'team',               vpr.player_group,
            'role',               vpr.role,
            'score',              vpr.effective_score,
            'elapsed_seconds',    vpr.elapsed_seconds,
            'winning_team',       vpr.winning_team,
            'objective_complete', vpr.objective_complete,
            'visual',             sr2.visual,
            'audio',              sr2.audio,
            'cranked',            sr2.cranked,
            'structure',          sr2.structure
          ) ORDER BY vpr.run_number, vpr.player_group
        )
        FROM   public.v_player_runs      vpr
        JOIN   public.session_runs       sr2 ON sr2.id = vpr.run_id
        JOIN   public.users              u2  ON u2.id = vpr.player_id
        LEFT JOIN public.platoon_members pm3 ON pm3.user_id = vpr.player_id AND pm3.platoon_id = p_platoon_id
        WHERE  vpr.reservation_id = r.id
      ) AS runs
    FROM   public.reservations        r
    JOIN   public.reservation_types   rt ON rt.id = r.type_id
    JOIN   public.reservation_players rp ON rp.reservation_id = r.id
    JOIN   public.platoon_members     pm ON pm.user_id = rp.user_id AND pm.platoon_id = p_platoon_id
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
  member_players jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (r.id)
    r.id AS reservation_id,
    r.date,
    r.start_time::text,
    rt.name AS type_name,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',            u.id,
        'leaderboard_name',   COALESCE(u.leaderboard_name, u.name),
        'avatar_url',         u.avatar_url,
        'platoon_tag',        u.platoon_tag,
        'platoon_badge_color',u.platoon_badge_color,
        'leaderboard_rank',   lb.rank_all_time
      ))
      FROM   public.reservation_players rp2
      JOIN   public.platoon_members pm2 ON pm2.user_id = rp2.user_id AND pm2.platoon_id = p_platoon_id
      JOIN   public.users u ON u.id = rp2.user_id
      LEFT JOIN public.v_leaderboard lb ON lb.player_id = u.id
      WHERE  rp2.reservation_id = r.id
    ) AS member_players
  FROM   public.reservations r
  JOIN   public.reservation_types rt ON rt.id = r.type_id
  JOIN   public.reservation_players rp ON rp.reservation_id = r.id
  JOIN   public.platoon_members pm ON pm.user_id = rp.user_id AND pm.platoon_id = p_platoon_id
  WHERE  r.date >= CURRENT_DATE
    AND  EXISTS (
      SELECT 1 FROM public.platoon_members
      WHERE  platoon_id = p_platoon_id
      AND    user_id = private_get_my_user_id()
    )
  ORDER  BY r.id, r.date ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_upcoming(uuid) TO authenticated;
