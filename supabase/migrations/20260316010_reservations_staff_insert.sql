-- ============================================================
-- Migration: 20260316010_reservations_staff_insert
-- Version:   20260316010
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds an INSERT policy on public.reservations so that
--   staff/manager/admin users can create reservations directly
--   (e.g. the Walk-In flow in OpsView).
--
--   Without this policy the direct .insert() in createReservation()
--   returns "permission denied for table reservations" (RLS 42501)
--   because only SELECT and UPDATE policies existed for staff.
-- ============================================================

CREATE POLICY "reservations_staff_insert"
  ON public.reservations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE  auth_id = auth.uid()::text
        AND  access  IN ('staff', 'manager', 'admin')
    )
  );
