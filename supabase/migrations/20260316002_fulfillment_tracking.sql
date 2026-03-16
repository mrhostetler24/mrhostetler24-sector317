-- ============================================================
-- Migration: 20260316002_fulfillment_tracking
-- Version:   20260316002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds shipment tracking to merch orders:
--   1. tracking_number, carrier, fulfilled_at, fulfillment_notes columns on merch_orders
--   2. fulfill_merch_order RPC — sets status='fulfilled', records tracking info
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — New columns on merch_orders
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_orders
  ADD COLUMN IF NOT EXISTS tracking_number    text,
  ADD COLUMN IF NOT EXISTS carrier            text,
  ADD COLUMN IF NOT EXISTS fulfilled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_notes  text;


-- ────────────────────────────────────────────────────────────
-- PART 2 — fulfill_merch_order RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fulfill_merch_order(
  p_order_id        uuid,
  p_tracking_number text    DEFAULT NULL,
  p_carrier         text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verify caller is staff/manager/admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_id = auth.uid()::text
    AND   access IN ('staff','manager','admin')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.merch_orders
  SET    status            = 'fulfilled',
         fulfilled_at      = now(),
         tracking_number   = p_tracking_number,
         carrier           = p_carrier,
         fulfillment_notes = p_notes
  WHERE  id = p_order_id
  AND    status IN ('paid','pending');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or not in a fulfillable status (must be paid or pending)';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fulfill_merch_order TO authenticated;
