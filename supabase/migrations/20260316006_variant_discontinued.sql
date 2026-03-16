-- ============================================================
-- Migration: 20260316006_variant_discontinued
-- Version:   20260316006
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Adds discontinued + discontinued_at to merch_variants
--      - discontinued=true: selling through remaining stock,
--        won't be reordered; distinct from active=false (temp hide)
--      - Storefront channel automatically excludes discontinued variants
--      - Staff/admin channels still show them (with UI badge)
--   2. Rebuilds get_merch_catalog (canonical rebuild — also picks up
--      sku_suffix and sku_family_code from migration 20260316005)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — New columns on merch_variants
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_variants
  ADD COLUMN IF NOT EXISTS discontinued      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discontinued_at   timestamptz;


-- ────────────────────────────────────────────────────────────
-- PART 2 — Rebuild get_merch_catalog
--   Changes vs previous version (20260316004):
--     • Adds discontinued + discontinued_at to variant jsonb
--     • Adds sku_suffix to variant jsonb (from 20260316005)
--     • Adds sku_family_code to product SELECT + GROUP BY (from 20260316005)
--     • FILTER now excludes discontinued variants from storefront channel
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_merch_catalog(p_channel text DEFAULT 'all')
RETURNS SETOF json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT to_json(sub) FROM (
    SELECT
      p.id, p.category_id, p.type, p.name, p.description, p.sku,
      p.sku_family_code,
      p.base_price, p.image_url, p.storefront_visible, p.staff_visible,
      p.shippable, p.pickup_only, p.returnable, p.return_window_days,
      p.restockable, p.return_policy_note, p.active, p.archived,
      p.sort_order, p.created_at,
      c.name AS category_name,
      CASE WHEN p_channel = 'storefront' THEN NULL ELSE p.internal_notes END AS internal_notes,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',               v.id,
            'label',            v.label,
            'sku',              v.sku,
            'sku_suffix',       v.sku_suffix,
            'price_override',   v.price_override,
            'shipping_charge',  v.shipping_charge,
            'active',           v.active,
            'discontinued',     v.discontinued,
            'discontinued_at',  v.discontinued_at,
            'storefront_visible', v.storefront_visible,
            'staff_visible',    v.staff_visible,
            'sort_order',       v.sort_order,
            'cost',             v.cost,
            'reorder_point',    v.reorder_point,
            'reorder_qty',      v.reorder_qty,
            'lead_time_days',   v.lead_time_days,
            'vendor_id',        v.vendor_id,
            'vendor_sku',       v.vendor_sku,
            'vendor_name',      vd.name,
            'vendor_email',     vd.email,
            'vendor_phone',     vd.phone,
            'inventory', COALESCE(
              (SELECT SUM(mi.quantity) FROM public.merch_inventory mi WHERE mi.variant_id = v.id), 0
            )
          )
        ) FILTER (WHERE v.id IS NOT NULL AND v.active = true
          -- Storefront never shows discontinued variants;
          -- staff/all channels still see them (UI shows a badge)
          AND NOT (p_channel = 'storefront' AND v.discontinued = true)
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
             p.sku_family_code,
             p.base_price, p.image_url, p.storefront_visible, p.staff_visible,
             p.shippable, p.pickup_only, p.returnable, p.return_window_days,
             p.restockable, p.return_policy_note, p.active, p.archived,
             p.sort_order, p.created_at, c.name, p.internal_notes
    ORDER BY p.sort_order, p.name
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_merch_catalog TO authenticated, anon;
