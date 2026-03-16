-- ============================================================
-- Migration: 20260316003_inventory_ops
-- Version:   20260316003
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds inventory transfer support:
--   1. transfer_id column on merch_inventory_transactions — links debit/credit pairs
--   2. transfer_merch_inventory RPC — atomically moves stock between locations
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — transfer_id on merch_inventory_transactions
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_inventory_transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;


-- ────────────────────────────────────────────────────────────
-- PART 2 — transfer_merch_inventory RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transfer_merch_inventory(
  p_variant_id      uuid,
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_qty             int,
  p_notes           text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     uuid;
  v_from_qty    int;
  v_transfer_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid()::text;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be positive';
  END IF;

  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Source and destination locations must be different';
  END IF;

  -- Check available stock at source
  SELECT COALESCE(quantity, 0)
  INTO   v_from_qty
  FROM   public.merch_inventory
  WHERE  variant_id  = p_variant_id
  AND    location_id = p_from_location_id;

  IF v_from_qty < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock at source location (available: %, requested: %)',
      v_from_qty, p_qty;
  END IF;

  v_transfer_id := gen_random_uuid();

  -- Debit source location
  UPDATE public.merch_inventory
  SET    quantity = GREATEST(quantity - p_qty, 0)
  WHERE  variant_id  = p_variant_id
  AND    location_id = p_from_location_id;

  INSERT INTO public.merch_inventory_transactions
    (variant_id, location_id, transaction_type, quantity_change, notes, created_by, transfer_id)
  VALUES (
    p_variant_id, p_from_location_id, 'transfer', -p_qty,
    COALESCE(p_notes, 'Transfer out'), v_user_id, v_transfer_id
  );

  -- Credit destination location
  INSERT INTO public.merch_inventory (variant_id, location_id, quantity)
  VALUES (p_variant_id, p_to_location_id, p_qty)
  ON CONFLICT (variant_id, location_id)
  DO UPDATE SET quantity = merch_inventory.quantity + p_qty;

  INSERT INTO public.merch_inventory_transactions
    (variant_id, location_id, transaction_type, quantity_change, notes, created_by, transfer_id)
  VALUES (
    p_variant_id, p_to_location_id, 'transfer', p_qty,
    COALESCE(p_notes, 'Transfer in'), v_user_id, v_transfer_id
  );

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_merch_inventory TO authenticated;
