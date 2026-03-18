-- ============================================================
-- Migration: Store original date/time when a reservation is rescheduled
-- Version:   20260318001
--
-- Adds original_date and original_start_time columns so admins
-- can see what a reservation was originally booked for.
-- The reschedule_reservation RPC uses COALESCE so the original
-- values are only captured on the FIRST reschedule.
-- Also updates get_reservations_with_players to include both columns.
-- ============================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS original_date        date,
  ADD COLUMN IF NOT EXISTS original_start_time  text;

-- ── reschedule_reservation ───────────────────────────────────────────────────
-- Atomically updates the booking to the new date/time, preserving original_date
-- and original_start_time on first call only (COALESCE skips if already set).
CREATE OR REPLACE FUNCTION public.reschedule_reservation(
  p_id              uuid,
  p_new_date        date,
  p_new_start_time  text
)
RETURNS SETOF public.reservations
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.reservations SET
    date                = p_new_date,
    start_time          = p_new_start_time,
    rescheduled         = true,
    original_date       = COALESCE(original_date, date),
    original_start_time = COALESCE(original_start_time, start_time)
  WHERE id = p_id
  RETURNING *;
$$;

-- ── get_reservations_with_players (updated) ──────────────────────────────────
-- Re-declared to add original_date and original_start_time to the SELECT.
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
      r.original_date,
      r.original_start_time,
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
             r.rescheduled, r.original_date, r.original_start_time,
             r.created_at, r.war_winner_team, r.war_win_type
    ORDER BY r.date, r.start_time
  ) sub;
$function$;
