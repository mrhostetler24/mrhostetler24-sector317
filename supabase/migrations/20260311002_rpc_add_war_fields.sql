-- ============================================================
-- Migration: Add war_winner_team + war_win_type to
--            get_reservations_with_players RPC
-- Version:   20260311002
--
-- The RPC was last updated in 20260308001 and doesn't include
-- the war outcome columns added in 20260306001. Without them,
-- r.warWinnerTeam is always null in the customer portal, so the
-- "Match: X wins" badge never appears.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_reservations_with_players(p_date text DEFAULT NULL::text)
 RETURNS SETOF json
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT to_json(sub) FROM (
    SELECT
      r.id,
      r.type_id,
      r.user_id,
      r.customer_name,
      r.date,
      r.start_time,
      r.player_count,
      r.amount,
      r.status,
      r.paid,
      r.rescheduled,
      r.created_at,
      r.war_winner_team,
      r.war_win_type,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',                   p.id,
            'user_id',              p.user_id,
            'name',                 p.name,
            'team',                 p.team,
            'scored_reservation_id', p.scored_reservation_id
          )
        ) FILTER (WHERE p.id IS NOT NULL),
        '[]'::jsonb
      ) AS players
    FROM public.reservations r
    LEFT JOIN public.reservation_players p ON p.reservation_id = r.id
    WHERE EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = auth.uid()::text
      AND (
        u.access = ANY (ARRAY['staff','manager','admin'])
        OR u.role  = ANY (ARRAY['staff','manager','admin'])
        OR r.user_id = u.id
      )
    )
    AND (p_date IS NULL OR r.date = p_date::date)
    GROUP BY r.id, r.type_id, r.user_id, r.customer_name, r.date,
             r.start_time, r.player_count, r.amount, r.status, r.paid,
             r.rescheduled, r.created_at, r.war_winner_team, r.war_win_type
    ORDER BY r.date, r.start_time
  ) sub;
$function$;
