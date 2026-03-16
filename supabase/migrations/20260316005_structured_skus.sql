-- ============================================================
-- Migration: 20260316005_structured_skus
-- Version:   20260316005
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds structured fields so SKUs are generated from data,
--   not free text. Format: {CAT_CODE}-{FAMILY_CODE}[-{SUFFIX}]
--
--   Examples:
--     APP-RAID           (category=APP, family=RAID, no variants)
--     APP-RAID-BLK-LG    (suffix=BLK-LG)
--     TNK-HPA-68         (suffix=68)
--     AMO-RBL-2000       (suffix=2000)
--
--   Changes:
--     1. merch_categories  → sku_code (e.g. APP, HDR, TNK, AMO)
--     2. merch_products    → sku_family_code (e.g. RAID, ICON, HPA)
--     3. merch_products    → unique partial index on sku
--     4. merch_variants    → sku_suffix (e.g. BLK-LG, 68, 2000)
--     5. merch_variants    → unique partial index on sku
--     6. Format CHECK constraints on all SKU fields
--     7. Helper function   → build_merch_sku()
--
-- BACKFILL NOTE:
--   No automatic backfill is attempted. Existing sku values that
--   are NULL will remain NULL. Existing non-NULL skus must conform
--   to the format constraint (^[A-Z0-9][A-Z0-9-]*$) — run the
--   safety check queries below before executing this migration if
--   you have existing SKU data.
--
-- SAFETY CHECKS (run these first if you have existing SKU data):
--   SELECT id, sku FROM merch_products WHERE sku IS NOT NULL
--     AND sku !~ '^[A-Z0-9][A-Z0-9-]*$';
--   SELECT id, sku FROM merch_variants WHERE sku IS NOT NULL
--     AND sku !~ '^[A-Z0-9][A-Z0-9-]*$';
--   If either returns rows, fix those values before running.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 1 — merch_categories.sku_code
-- Short 2-6 char uppercase code; first segment of every SKU
-- in this category. Must be unique once set.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_categories
  ADD COLUMN IF NOT EXISTS sku_code text;

ALTER TABLE public.merch_categories
  ADD CONSTRAINT merch_categories_sku_code_fmt
    CHECK (sku_code IS NULL OR sku_code ~ '^[A-Z0-9]{2,6}$');

-- Partial unique index: multiple NULLs allowed; no duplicate codes once assigned
CREATE UNIQUE INDEX IF NOT EXISTS merch_categories_sku_code_key
  ON public.merch_categories (sku_code)
  WHERE sku_code IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- PART 2 — merch_products.sku_family_code
-- 2-8 char uppercase product family code; second segment of
-- the base product SKU. Combined with category sku_code:
--   product.sku = category.sku_code || '-' || sku_family_code
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS sku_family_code text;

ALTER TABLE public.merch_products
  ADD CONSTRAINT merch_products_sku_family_code_fmt
    CHECK (sku_family_code IS NULL OR sku_family_code ~ '^[A-Z0-9]{2,8}$');


-- ────────────────────────────────────────────────────────────
-- PART 3 — merch_products.sku — format constraint + unique index
-- ────────────────────────────────────────────────────────────

-- Format: starts with letter/digit, followed by letters/digits/hyphens
ALTER TABLE public.merch_products
  ADD CONSTRAINT merch_products_sku_fmt
    CHECK (sku IS NULL OR sku ~ '^[A-Z0-9][A-Z0-9-]*$');

-- Partial unique: NULLs are never in conflict; any two non-NULL skus must differ
CREATE UNIQUE INDEX IF NOT EXISTS merch_products_sku_key
  ON public.merch_products (sku)
  WHERE sku IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- PART 4 — merch_variants.sku_suffix
-- The variant-specific suffix appended to the product SKU.
-- Full variant SKU = product.sku || '-' || sku_suffix
-- Examples: BLK-LG, TAN, 68, 2000, ONE-SIZE
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_variants
  ADD COLUMN IF NOT EXISTS sku_suffix text;

ALTER TABLE public.merch_variants
  ADD CONSTRAINT merch_variants_sku_suffix_fmt
    CHECK (sku_suffix IS NULL OR sku_suffix ~ '^[A-Z0-9][A-Z0-9-]*$');


-- ────────────────────────────────────────────────────────────
-- PART 5 — merch_variants.sku — format constraint + unique index
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.merch_variants
  ADD CONSTRAINT merch_variants_sku_fmt
    CHECK (sku IS NULL OR sku ~ '^[A-Z0-9][A-Z0-9-]*$');

-- Ensures no two variants (across all products) share a full SKU.
-- This is the primary guard against the shirt collision case:
--   APP-LSSL-BLK-LG (long sleeve, black, large)
--   APP-SSSL-BLK-LG (short sleeve, black, large)  ← different because family code differs
CREATE UNIQUE INDEX IF NOT EXISTS merch_variants_sku_key
  ON public.merch_variants (sku)
  WHERE sku IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- PART 6 — Helper function: build_merch_sku
-- Pure function, not a trigger. App-side SKU generation logic
-- uses the same formula. Can also be called server-side for
-- validation or batch backfill.
--
-- Usage:
--   SELECT build_merch_sku('APP', 'RAID');           → 'APP-RAID'
--   SELECT build_merch_sku('APP', 'RAID', 'BLK-LG'); → 'APP-RAID-BLK-LG'
--   SELECT build_merch_sku('TNK', 'HPA', '68');      → 'TNK-HPA-68'
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.build_merch_sku(
  p_cat_code    text,
  p_family_code text,
  p_suffix      text DEFAULT NULL
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    upper(p_cat_code) || '-' || upper(p_family_code)
    || CASE
         WHEN p_suffix IS NOT NULL AND trim(p_suffix) <> ''
           THEN '-' || upper(trim(p_suffix))
         ELSE ''
       END
$$;

GRANT EXECUTE ON FUNCTION public.build_merch_sku TO authenticated, anon;
