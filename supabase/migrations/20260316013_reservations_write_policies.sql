-- ============================================================
-- Migration: reservations full write policies for staff/manager/admin
-- Version:   20260316013
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds UPDATE and DELETE RLS policies on public.reservations so
--   that staff/manager/admin can mark reservations paid, change
--   status, and cancel them.
--
--   INSERT policy already exists from 20260316010 (kept as-is).
--   SELECT policy is assumed to exist from initial DB setup.
--   This migration is safe to re-run (DROP IF EXISTS before CREATE).
-- ============================================================

-- UPDATE
DROP POLICY IF EXISTS "reservations_staff_update" ON public.reservations;
CREATE POLICY "reservations_staff_update"
  ON public.reservations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_id = auth.uid()::text
        AND access IN ('staff', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_id = auth.uid()::text
        AND access IN ('staff', 'manager', 'admin')
    )
  );

-- DELETE
DROP POLICY IF EXISTS "reservations_staff_delete" ON public.reservations;
CREATE POLICY "reservations_staff_delete"
  ON public.reservations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_id = auth.uid()::text
        AND access IN ('staff', 'manager', 'admin')
    )
  );
