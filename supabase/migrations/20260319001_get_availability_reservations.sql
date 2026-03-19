-- ============================================================
-- Migration: get_availability_reservations
-- Version:   20260319001
--
-- PURPOSE:
--   Customers opening the booking wizard need to see real lane
--   occupancy so availability is accurate.  This RPC returns
--   the minimal fields required by buildLanes() / getSlotStatus()
--   for the next 60 days — no PII exposed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_availability_reservations()
RETURNS TABLE (
  id           uuid,
  date         date,
  start_time   text,
  type_id      text,
  player_count int,
  status       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.date,
    r.start_time,
    r.type_id,
    r.player_count,
    r.status
  FROM public.reservations r
  WHERE r.date >= CURRENT_DATE
    AND r.date <= CURRENT_DATE + INTERVAL '60 days'
    AND r.status <> 'cancelled'
  ORDER BY r.date, r.start_time;
$$;

GRANT EXECUTE ON FUNCTION public.get_availability_reservations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_availability_reservations() TO anon;
