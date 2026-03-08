-- ============================================================
-- Migration: Manager SECURITY DEFINER RPCs for shift mutations
-- Version:   20260307005
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY:
--   The shifts table RLS policy blocks direct UPDATE by all
--   authenticated users. Managers/admins need to approve conflicts,
--   assign shifts, and edit shift times/assignments via these
--   SECURITY DEFINER functions that bypass RLS.
-- ============================================================

-- Approve a conflict: release staff assignment, mark shift open
CREATE OR REPLACE FUNCTION public.approve_shift_conflict(p_shift_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_row public.shifts%ROWTYPE;
BEGIN
  UPDATE public.shifts
  SET conflicted    = false,
      conflict_note = null,
      staff_id      = null,
      open          = true
  WHERE id = p_shift_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;

-- Assign a shift to a specific staff member (also clears any conflict)
CREATE OR REPLACE FUNCTION public.assign_shift(p_shift_id uuid, p_staff_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_row public.shifts%ROWTYPE;
BEGIN
  UPDATE public.shifts
  SET staff_id      = p_staff_id,
      conflicted    = false,
      conflict_note = null,
      open          = false
  WHERE id = p_shift_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;

-- Edit shift times and/or assignment (p_staff_id = null means unassign)
CREATE OR REPLACE FUNCTION public.admin_edit_shift(
  p_shift_id  uuid,
  p_staff_id  uuid,      -- pass NULL to unassign
  p_start     text,
  p_end       text,
  p_open      boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_row public.shifts%ROWTYPE;
BEGIN
  UPDATE public.shifts
  SET staff_id   = p_staff_id,
      start_time = p_start,
      end_time   = p_end,
      open       = p_open
  WHERE id = p_shift_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_shift_conflict(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_shift(uuid, uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_shift(uuid, uuid, text, text, boolean)         TO authenticated;
