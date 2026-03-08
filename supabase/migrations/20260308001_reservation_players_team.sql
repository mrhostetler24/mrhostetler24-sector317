-- 1. Add team column to reservation_players
ALTER TABLE public.reservation_players
  ADD COLUMN IF NOT EXISTS team smallint
  CONSTRAINT reservation_players_team_check CHECK (team IN (1, 2));

-- 2. Update get_reservations_with_players RPC to include team + scored_reservation_id in player objects
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
      r.created_at,
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
             r.start_time, r.player_count, r.amount, r.status, r.paid, r.created_at
    ORDER BY r.date, r.start_time
  ) sub;
$function$
