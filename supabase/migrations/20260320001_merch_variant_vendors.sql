-- Migration: 20260320001_merch_variant_vendors
-- Replaces single-vendor fields on merch_variants with a junction table
-- so each variant can have multiple vendors, one designated as primary.

-- ─────────────────────────────────────────────────────────────────────
-- PART 1 — Create junction table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.merch_variant_vendors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid        NOT NULL REFERENCES public.merch_variants(id)  ON DELETE CASCADE,
  vendor_id       uuid        NOT NULL REFERENCES public.merch_vendors(id)   ON DELETE CASCADE,
  vendor_sku      text,
  cost            numeric(10,2),
  lead_time_days  int,
  is_primary      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(variant_id, vendor_id)
);

-- Enforce exactly one primary per variant at the DB level
CREATE UNIQUE INDEX merch_variant_vendors_one_primary
  ON public.merch_variant_vendors(variant_id) WHERE is_primary = true;

-- ─────────────────────────────────────────────────────────────────────
-- PART 2 — Migrate existing single-vendor data
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.merch_variant_vendors
  (variant_id, vendor_id, vendor_sku, cost, lead_time_days, is_primary)
SELECT id, vendor_id, vendor_sku, cost, lead_time_days, true
FROM   public.merch_variants
WHERE  vendor_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- PART 3 — Drop old vendor columns from merch_variants
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.merch_variants
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS vendor_sku,
  DROP COLUMN IF EXISTS cost,
  DROP COLUMN IF EXISTS lead_time_days;

-- ─────────────────────────────────────────────────────────────────────
-- PART 4 — Update delete_merch_vendor to remove junction rows first
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_merch_vendor(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Remove this vendor from all variant vendor lists
  DELETE FROM public.merch_variant_vendors WHERE vendor_id = p_id;
  -- Soft-delete the vendor record
  UPDATE public.merch_vendors SET active = false WHERE id = p_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- PART 5 — Rebuild get_merch_catalog: variants now carry a vendors array
-- ─────────────────────────────────────────────────────────────────────
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
            'id',                 v.id,
            'label',              v.label,
            'sku',                v.sku,
            'sku_suffix',         v.sku_suffix,
            'price_override',     v.price_override,
            'shipping_charge',    v.shipping_charge,
            'active',             v.active,
            'discontinued',       v.discontinued,
            'discontinued_at',    v.discontinued_at,
            'storefront_visible', v.storefront_visible,
            'staff_visible',      v.staff_visible,
            'sort_order',         v.sort_order,
            'reorder_point',      v.reorder_point,
            'reorder_qty',        v.reorder_qty,
            'inventory', COALESCE(
              (SELECT SUM(mi.quantity)
               FROM public.merch_inventory mi
               WHERE mi.variant_id = v.id), 0
            ),
            'vendors', COALESCE(
              (SELECT jsonb_agg(
                jsonb_build_object(
                  'id',             vv.id,
                  'vendor_id',      vv.vendor_id,
                  'vendor_name',    mv.name,
                  'vendor_email',   mv.email,
                  'vendor_phone',   mv.phone,
                  'vendor_sku',     vv.vendor_sku,
                  'cost',           vv.cost,
                  'lead_time_days', vv.lead_time_days,
                  'is_primary',     vv.is_primary
                ) ORDER BY vv.is_primary DESC, mv.name
              )
              FROM  public.merch_variant_vendors vv
              JOIN  public.merch_vendors mv ON mv.id = vv.vendor_id
              WHERE vv.variant_id = v.id
              ),
              '[]'::jsonb
            )
          )
        ) FILTER (WHERE v.id IS NOT NULL AND v.active = true
          AND NOT (p_channel = 'storefront' AND v.discontinued = true)
          AND (p_channel = 'all'
            OR (p_channel = 'storefront' AND v.storefront_visible = true)
            OR (p_channel = 'staff'      AND v.staff_visible      = true)
          )
        ),
        '[]'::jsonb
      ) AS variants
    FROM public.merch_products p
    LEFT JOIN public.merch_categories c ON c.id = p.category_id
    LEFT JOIN public.merch_variants   v ON v.product_id = p.id
    WHERE p.active = true AND p.archived = false
      AND (p_channel = 'all'
        OR (p_channel = 'storefront' AND p.storefront_visible = true)
        OR (p_channel = 'staff'      AND p.staff_visible      = true)
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

-- ─────────────────────────────────────────────────────────────────────
-- PART 6 — RLS for merch_variant_vendors
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.merch_variant_vendors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.merch_variant_vendors FROM anon;

CREATE POLICY "staff can manage variant vendors"
  ON public.merch_variant_vendors FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_id = auth.uid()::text AND access IN ('staff','manager','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_id = auth.uid()::text AND access IN ('staff','manager','admin')
  ));
