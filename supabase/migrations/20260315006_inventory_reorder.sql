-- ============================================================
-- Migration: 20260315006_inventory_reorder
-- Version:   20260315006
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds full inventory reorder tracking to the merch system:
--
--   1. merch_vendors table — supplier contact details
--   2. merch_variants — adds reorder_point, reorder_qty,
--      cost, vendor_id, vendor_sku, lead_time_days
--   3. Rebuilds get_merch_catalog to include new fields
--   4. upsert_merch_vendor / delete_merch_vendor RPCs
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — Vendors table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.merch_vendors (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text        NOT NULL,
  email      text,
  phone      text,
  website    text,
  notes      text,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.merch_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors_select"
  ON public.merch_vendors FOR SELECT
  TO authenticated USING (true);


-- ────────────────────────────────────────────────────────────
-- PART 2 — New columns on merch_variants
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_variants
  ADD COLUMN IF NOT EXISTS vendor_id      uuid REFERENCES public.merch_vendors(id),
  ADD COLUMN IF NOT EXISTS vendor_sku     text,
  ADD COLUMN IF NOT EXISTS cost           numeric(10,4),
  ADD COLUMN IF NOT EXISTS reorder_point  int,
  ADD COLUMN IF NOT EXISTS reorder_qty    int,
  ADD COLUMN IF NOT EXISTS lead_time_days int;


-- ────────────────────────────────────────────────────────────
-- PART 3 — Vendor RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_merch_vendor(
  p_id       uuid    DEFAULT NULL,
  p_name     text    DEFAULT NULL,
  p_email    text    DEFAULT NULL,
  p_phone    text    DEFAULT NULL,
  p_website  text    DEFAULT NULL,
  p_notes    text    DEFAULT NULL,
  p_active   boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE public.merch_vendors
    SET name    = COALESCE(p_name,    name),
        email   = p_email,
        phone   = p_phone,
        website = p_website,
        notes   = p_notes,
        active  = COALESCE(p_active, active)
    WHERE id = p_id;
    v_id := p_id;
  ELSE
    INSERT INTO public.merch_vendors (name, email, phone, website, notes, active)
    VALUES (p_name, p_email, p_phone, p_website, p_notes, COALESCE(p_active, true))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_merch_vendor TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_merch_vendor(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Soft-delete; clear vendor_id from any variants referencing this vendor
  UPDATE public.merch_variants SET vendor_id = NULL WHERE vendor_id = p_id;
  UPDATE public.merch_vendors  SET active = false        WHERE id    = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_merch_vendor TO authenticated;


-- ────────────────────────────────────────────────────────────
-- PART 4 — Rebuild get_merch_catalog with new variant fields
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_merch_catalog(p_channel text DEFAULT 'all')
RETURNS SETOF json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT to_json(sub) FROM (
    SELECT
      p.id, p.category_id, p.type, p.name, p.description, p.sku,
      p.base_price, p.image_url, p.storefront_visible, p.staff_visible,
      p.shippable, p.pickup_only, p.returnable, p.return_window_days,
      p.restockable, p.return_policy_note, p.active, p.archived,
      p.sort_order, p.created_at,
      c.name AS category_name,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',             v.id,
            'label',          v.label,
            'sku',            v.sku,
            'price_override', v.price_override,
            'shipping_charge',v.shipping_charge,
            'active',         v.active,
            'storefront_visible', v.storefront_visible,
            'staff_visible',  v.staff_visible,
            'sort_order',     v.sort_order,
            'cost',           v.cost,
            'reorder_point',  v.reorder_point,
            'reorder_qty',    v.reorder_qty,
            'lead_time_days', v.lead_time_days,
            'vendor_id',      v.vendor_id,
            'vendor_sku',     v.vendor_sku,
            'vendor_name',    vd.name,
            'vendor_email',   vd.email,
            'vendor_phone',   vd.phone,
            'inventory', COALESCE(
              (SELECT SUM(mi.quantity) FROM public.merch_inventory mi WHERE mi.variant_id = v.id), 0
            )
          )
        ) FILTER (WHERE v.id IS NOT NULL AND v.active = true
          AND (p_channel = 'all'
            OR (p_channel = 'storefront' AND v.storefront_visible = true)
            OR (p_channel = 'staff'      AND v.staff_visible = true)
          )
        ),
        '[]'::jsonb
      ) AS variants
    FROM public.merch_products p
    LEFT JOIN public.merch_categories c  ON c.id  = p.category_id
    LEFT JOIN public.merch_variants v    ON v.product_id = p.id
    LEFT JOIN public.merch_vendors vd    ON vd.id = v.vendor_id
    WHERE p.active = true AND p.archived = false
      AND (p_channel = 'all'
        OR (p_channel = 'storefront' AND p.storefront_visible = true)
        OR (p_channel = 'staff'      AND p.staff_visible = true)
      )
    GROUP BY p.id, p.category_id, p.type, p.name, p.description, p.sku,
             p.base_price, p.image_url, p.storefront_visible, p.staff_visible,
             p.shippable, p.pickup_only, p.returnable, p.return_window_days,
             p.restockable, p.return_policy_note, p.active, p.archived,
             p.sort_order, p.created_at, c.name
    ORDER BY p.sort_order, p.name
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_merch_catalog TO authenticated, anon;
