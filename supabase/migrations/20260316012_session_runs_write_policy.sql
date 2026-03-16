-- ============================================================
-- Migration: session_runs write policies for staff/manager/admin
-- Version:   20260316012
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds INSERT, UPDATE, DELETE RLS policies on session_runs so
--   that staff, manager, and admin users can score runs directly.
--   Previously only a public SELECT policy existed; all writes
--   were blocked with "permission denied".
-- ============================================================

-- Helper: true when the calling user is staff/manager/admin
CREATE OR REPLACE FUNCTION public.is_staff_or_above()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND access IN ('staff', 'manager', 'admin')
  );
$$;

-- INSERT
DROP POLICY IF EXISTS runs_staff_insert ON public.session_runs;
CREATE POLICY runs_staff_insert ON public.session_runs
  FOR INSERT
  WITH CHECK (public.is_staff_or_above());

-- UPDATE
DROP POLICY IF EXISTS runs_staff_update ON public.session_runs;
CREATE POLICY runs_staff_update ON public.session_runs
  FOR UPDATE
  USING (public.is_staff_or_above())
  WITH CHECK (public.is_staff_or_above());

-- DELETE
DROP POLICY IF EXISTS runs_staff_delete ON public.session_runs;
CREATE POLICY runs_staff_delete ON public.session_runs
  FOR DELETE
  USING (public.is_staff_or_above());

GRANT EXECUTE ON FUNCTION public.is_staff_or_above() TO authenticated;
