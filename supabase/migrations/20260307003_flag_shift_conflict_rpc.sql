-- ============================================================
-- Migration: Allow staff to flag their own shift conflicts
-- Version:   20260307003
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY:
--   The shifts table RLS policy blocks direct UPDATE by staff members,
--   causing a permission error when they try to flag a conflict on their
--   own shift (e.g. when creating an availability block).
--
--   This SECURITY DEFINER function lets any authenticated staff member
--   flag their OWN shift as conflicted, without needing broad write access.
-- ============================================================

CREATE OR REPLACE FUNCTION public.flag_shift_conflict(
  p_shift_id    uuid,
  p_conflict_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.shifts
  SET conflicted    = true,
      conflict_note = p_conflict_note
  WHERE id       = p_shift_id
    AND staff_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_shift_conflict(uuid, text) TO authenticated;
