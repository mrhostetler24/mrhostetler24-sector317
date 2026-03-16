-- ============================================================
-- Migration: 20260316001_purchase_orders
-- Version:   20260316001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds purchase order tracking:
--   1. merch_purchase_orders — PO headers (vendor, status, expected date)
--   2. merch_po_lines — PO line items (variant, qty_ordered, qty_received, cost)
--   3. create_purchase_order RPC — inserts PO header + lines atomically
--   4. receive_po_line RPC — marks qty received, restocks inventory, updates PO status
--   5. update_po_status RPC — mark PO as sent or cancelled
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — Purchase Orders table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.merch_purchase_orders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid        NOT NULL REFERENCES public.merch_vendors(id),
  status      text        NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','sent','partially_received','received','cancelled')),
  expected_by date,
  notes       text,
  created_by  uuid        REFERENCES public.users(id),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.merch_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merch_po_staff_read" ON public.merch_purchase_orders
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')
  ));

CREATE POLICY "merch_po_admin" ON public.merch_purchase_orders FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')
  ));


-- ────────────────────────────────────────────────────────────
-- PART 2 — PO Lines table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.merch_po_lines (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id               uuid          NOT NULL REFERENCES public.merch_purchase_orders(id) ON DELETE CASCADE,
  variant_id          uuid          NOT NULL REFERENCES public.merch_variants(id),
  qty_ordered         int           NOT NULL DEFAULT 1,
  unit_cost           numeric(10,4),
  qty_received        int           NOT NULL DEFAULT 0,
  receive_location_id uuid          REFERENCES public.merch_stock_locations(id),
  notes               text
);

ALTER TABLE public.merch_po_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merch_pol_staff_read" ON public.merch_po_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')
  ));

CREATE POLICY "merch_pol_admin" ON public.merch_po_lines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')
  ));


-- ────────────────────────────────────────────────────────────
-- PART 3 — create_purchase_order RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_vendor_id   uuid,
  p_expected_by date    DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_lines       jsonb   DEFAULT '[]'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_po_id   uuid;
  v_user_id uuid;
  v_line    jsonb;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid()::text;

  INSERT INTO public.merch_purchase_orders (vendor_id, expected_by, notes, created_by)
  VALUES (p_vendor_id, p_expected_by, p_notes, v_user_id)
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.merch_po_lines
      (po_id, variant_id, qty_ordered, unit_cost, receive_location_id, notes)
    VALUES (
      v_po_id,
      (v_line->>'variant_id')::uuid,
      COALESCE((v_line->>'qty_ordered')::int, 1),
      CASE WHEN v_line->>'unit_cost' IS NOT NULL AND v_line->>'unit_cost' <> ''
           THEN (v_line->>'unit_cost')::numeric ELSE NULL END,
      CASE WHEN v_line->>'receive_location_id' IS NOT NULL AND v_line->>'receive_location_id' <> ''
           THEN (v_line->>'receive_location_id')::uuid ELSE NULL END,
      v_line->>'notes'
    );
  END LOOP;

  RETURN v_po_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order TO authenticated;


-- ────────────────────────────────────────────────────────────
-- PART 4 — receive_po_line RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.receive_po_line(
  p_po_line_id  uuid,
  p_qty         int,
  p_location_id uuid,
  p_notes       text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_po_id          uuid;
  v_variant_id     uuid;
  v_qty_ordered    int;
  v_qty_received   int;
  v_total_ordered  int;
  v_total_received int;
  v_new_status     text;
  v_user_id        uuid;
  v_loc_id         uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid()::text;

  -- Resolve location (fallback to default)
  v_loc_id := COALESCE(p_location_id,
    (SELECT id FROM public.merch_stock_locations WHERE is_default = true LIMIT 1));

  -- Get line info
  SELECT po_id, variant_id, qty_ordered, qty_received
  INTO   v_po_id, v_variant_id, v_qty_ordered, v_qty_received
  FROM   public.merch_po_lines
  WHERE  id = p_po_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO line not found: %', p_po_line_id;
  END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity to receive must be positive';
  END IF;

  IF (v_qty_received + p_qty) > v_qty_ordered THEN
    RAISE EXCEPTION 'Cannot receive % units — ordered: %, already received: %',
      p_qty, v_qty_ordered, v_qty_received;
  END IF;

  -- Update qty_received on the line
  UPDATE public.merch_po_lines
  SET    qty_received        = qty_received + p_qty,
         receive_location_id = COALESCE(v_loc_id, receive_location_id)
  WHERE  id = p_po_line_id;

  -- Adjust inventory (same logic as adjust_merch_inventory but inline to avoid nested RPC issues)
  INSERT INTO public.merch_inventory (variant_id, location_id, quantity)
  VALUES (v_variant_id, v_loc_id, p_qty)
  ON CONFLICT (variant_id, location_id)
  DO UPDATE SET quantity = GREATEST(merch_inventory.quantity + p_qty, 0);

  INSERT INTO public.merch_inventory_transactions
    (variant_id, location_id, transaction_type, quantity_change, notes, created_by)
  VALUES (
    v_variant_id, v_loc_id, 'restock', p_qty,
    COALESCE(p_notes, 'Received via purchase order'),
    v_user_id
  );

  -- Recalculate PO status
  SELECT COALESCE(SUM(qty_ordered), 0), COALESCE(SUM(qty_received), 0)
  INTO   v_total_ordered, v_total_received
  FROM   public.merch_po_lines
  WHERE  po_id = v_po_id;

  v_new_status := CASE
    WHEN v_total_received >= v_total_ordered THEN 'received'
    WHEN v_total_received > 0               THEN 'partially_received'
    ELSE 'sent'
  END;

  UPDATE public.merch_purchase_orders
  SET    status = v_new_status
  WHERE  id = v_po_id AND status NOT IN ('cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_po_line TO authenticated;


-- ────────────────────────────────────────────────────────────
-- PART 5 — update_po_status RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_po_status(
  p_po_id  uuid,
  p_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_status NOT IN ('draft','sent','cancelled') THEN
    RAISE EXCEPTION 'update_po_status only allows: draft, sent, cancelled';
  END IF;
  UPDATE public.merch_purchase_orders SET status = p_status WHERE id = p_po_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_po_status TO authenticated;
