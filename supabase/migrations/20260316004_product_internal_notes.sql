-- ============================================================
-- Migration: 20260316004_product_internal_notes
-- Version:   20260316004
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Adds internal_notes column to merch_products
--      (staff/admin only — excluded from storefront channel)
--   2. Rebuilds get_merch_catalog to include internal_notes
--      (returns NULL when p_channel = 'storefront')
-- ============================================================

ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS internal_notes text;


-- ────────────────────────────────────────────────────────────
-- Rebuild get_merch_catalog — adds internal_notes
-- (inherits all changes from 20260315006)
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
      CASE WHEN p_channel = 'storefront' THEN NULL ELSE p.internal_notes END AS internal_notes,
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
             p.sort_order, p.created_at, c.name, p.internal_notes
    ORDER BY p.sort_order, p.name
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_merch_catalog TO authenticated, anon;
