-- ============================================================
-- Migration: Fix flag_shift_conflict to resolve public.users.id
-- Version:   20260307004
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY:
--   shifts.staff_id stores public.users.id, not the Supabase auth UUID.
--   The previous version used auth.uid() directly which never matched
--   for OAuth users (their auth UUID is stored in users.auth_id as text).
--   This version looks up the correct users.id first.
-- ============================================================

CREATE OR REPLACE FUNCTION public.flag_shift_conflict(
  p_shift_id      uuid,
  p_conflict_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM public.users
  WHERE auth_id = auth.uid()::text;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.shifts
  SET conflicted    = true,
      conflict_note = p_conflict_note
  WHERE id       = p_shift_id
    AND staff_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_shift_conflict(uuid, text) TO authenticated;
