-- ================================================================
-- SECTOR 317 — Merchandise & Inventory System
-- ================================================================

-- Make payments.reservation_id nullable (merch payments have no reservation)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payments'
    AND column_name='reservation_id' AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.payments ALTER COLUMN reservation_id DROP NOT NULL;
  END IF;
END $$;

-- Add merch_order_id to payments (linked after merch_orders table is created)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS merch_order_id uuid;

-- ─── Categories ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_categories (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  slug             text        UNIQUE NOT NULL,
  sort_order       int         NOT NULL DEFAULT 0,
  active           bool        NOT NULL DEFAULT true,
  storefront_visible bool      NOT NULL DEFAULT true,
  staff_visible    bool        NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

-- ─── Stock Locations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_stock_locations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  level_labels jsonb       NOT NULL DEFAULT '{"l1":"Location"}',
  is_default   bool        NOT NULL DEFAULT false,
  active       bool        NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

-- Seed default location if none exists
INSERT INTO public.merch_stock_locations (name, level_labels, is_default, active)
SELECT 'Main Stock', '{"l1":"Room","l2":"Shelf","l3":"Bin"}', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.merch_stock_locations WHERE is_default = true);

-- ─── Products ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_products (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id        uuid        REFERENCES public.merch_categories(id),
  type               text        NOT NULL CHECK (type IN ('physical','bundle','gift_card','gift_cert')),
  name               text        NOT NULL,
  description        text,
  sku                text,
  base_price         numeric(10,2) NOT NULL DEFAULT 0,
  image_url          text,
  storefront_visible bool        NOT NULL DEFAULT true,
  staff_visible      bool        NOT NULL DEFAULT true,
  shippable          bool        NOT NULL DEFAULT true,
  pickup_only        bool        NOT NULL DEFAULT false,
  returnable         bool        NOT NULL DEFAULT true,
  return_window_days int         NOT NULL DEFAULT 30,
  restockable        bool        NOT NULL DEFAULT true,
  return_policy_note text,
  active             bool        NOT NULL DEFAULT true,
  archived           bool        NOT NULL DEFAULT false,
  sort_order         int         NOT NULL DEFAULT 0,
  created_at         timestamptz DEFAULT now()
);

-- ─── Variants ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_variants (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid        NOT NULL REFERENCES public.merch_products(id) ON DELETE CASCADE,
  label              text        NOT NULL,
  sku                text,
  price_override     numeric(10,2),
  shipping_charge    numeric(10,2) NOT NULL DEFAULT 0,
  active             bool        NOT NULL DEFAULT true,
  storefront_visible bool        NOT NULL DEFAULT true,
  staff_visible      bool        NOT NULL DEFAULT true,
  sort_order         int         NOT NULL DEFAULT 0,
  created_at         timestamptz DEFAULT now()
);

-- ─── Inventory (per variant × location) ───────────────────────
CREATE TABLE IF NOT EXISTS public.merch_inventory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  uuid NOT NULL REFERENCES public.merch_variants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.merch_stock_locations(id),
  quantity    int  NOT NULL DEFAULT 0,
  UNIQUE(variant_id, location_id)
);

-- ─── Inventory Transactions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_inventory_transactions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id       uuid        NOT NULL REFERENCES public.merch_variants(id),
  location_id      uuid        REFERENCES public.merch_stock_locations(id),
  transaction_type text        NOT NULL CHECK (transaction_type IN (
    'sale','return','manual_adjustment','restock','damage','correction','bundle_consumption','transfer'
  )),
  quantity_change  int         NOT NULL,
  order_id         uuid,
  notes            text,
  created_by       uuid        REFERENCES public.users(id),
  created_at       timestamptz DEFAULT now()
);

-- ─── Bundle Components ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_bundle_components (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_product_id    uuid NOT NULL REFERENCES public.merch_products(id) ON DELETE CASCADE,
  component_variant_id uuid NOT NULL REFERENCES public.merch_variants(id),
  quantity             int  NOT NULL DEFAULT 1,
  UNIQUE(bundle_product_id, component_variant_id)
);

-- ─── Discounts / Coupons ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_discounts (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text          UNIQUE NOT NULL,
  description   text,
  discount_type text          NOT NULL CHECK (discount_type IN ('percent','fixed')),
  amount        numeric(10,2) NOT NULL,
  applies_to    text          NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','category','product')),
  category_id   uuid          REFERENCES public.merch_categories(id),
  product_id    uuid          REFERENCES public.merch_products(id),
  active        bool          NOT NULL DEFAULT true,
  usage_limit   int,
  usage_count   int           NOT NULL DEFAULT 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  channel       text          NOT NULL DEFAULT 'both' CHECK (channel IN ('online','staff','both')),
  created_at    timestamptz   DEFAULT now()
);

-- ─── Merch Orders ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_orders (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid          REFERENCES public.users(id),
  customer_name    text          NOT NULL,
  status           text          NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','fulfilled','cancelled','refunded')),
  total            numeric(10,2) NOT NULL DEFAULT 0,
  fulfillment_type text          NOT NULL DEFAULT 'pickup'
                   CHECK (fulfillment_type IN ('pickup','ship')),
  shipping_address jsonb,
  shipping_charge  numeric(10,2) NOT NULL DEFAULT 0,
  discount_id      uuid          REFERENCES public.merch_discounts(id),
  discount_amount  numeric(10,2) NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz   DEFAULT now()
);

-- Add FK from payments.merch_order_id → merch_orders(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_merch_order_id_fkey'
    AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_merch_order_id_fkey
      FOREIGN KEY (merch_order_id) REFERENCES public.merch_orders(id);
  END IF;
END $$;

-- ─── Order Items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_order_items (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid          NOT NULL REFERENCES public.merch_orders(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES public.merch_products(id),
  variant_id      uuid          REFERENCES public.merch_variants(id),
  quantity        int           NOT NULL DEFAULT 1,
  unit_price      numeric(10,2) NOT NULL,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  created_at      timestamptz   DEFAULT now()
);

-- ─── Gift Codes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_gift_codes (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id   uuid          REFERENCES public.merch_order_items(id),
  product_id      uuid          NOT NULL REFERENCES public.merch_products(id),
  code            text          UNIQUE NOT NULL,
  type            text          NOT NULL CHECK (type IN ('gift_card','gift_cert')),
  original_value  numeric(10,2) NOT NULL,
  current_balance numeric(10,2) NOT NULL,
  status          text          NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','redeemed','voided','expired')),
  redeemed_at     timestamptz,
  redeemed_by     uuid          REFERENCES public.users(id),
  expires_at      timestamptz,
  notes           text,
  created_at      timestamptz   DEFAULT now()
);

-- ─── Returns ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merch_returns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid        NOT NULL REFERENCES public.merch_orders(id),
  order_item_id uuid        NOT NULL REFERENCES public.merch_order_items(id),
  quantity      int         NOT NULL DEFAULT 1,
  reason        text        NOT NULL,
  disposition   text        NOT NULL
                CHECK (disposition IN ('restock_sellable','restock_damaged','no_restock')),
  notes         text,
  created_by    uuid        REFERENCES public.users(id),
  created_at    timestamptz DEFAULT now()
);

-- ================================================================
-- RLS POLICIES
-- ================================================================

ALTER TABLE public.merch_categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_variants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_inventory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_bundle_components     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_discounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_order_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_gift_codes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_returns               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merch_stock_locations       ENABLE ROW LEVEL SECURITY;

-- Categories: public read of active; manager/admin write
CREATE POLICY "merch_cat_pub_read" ON public.merch_categories
  FOR SELECT USING (active = true);
CREATE POLICY "merch_cat_admin" ON public.merch_categories FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')));

-- Products: public read active+non-archived; manager/admin write
CREATE POLICY "merch_prod_pub_read" ON public.merch_products
  FOR SELECT USING (active=true AND archived=false);
CREATE POLICY "merch_prod_admin" ON public.merch_products FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')));

-- Variants: public read active; manager/admin write
CREATE POLICY "merch_var_pub_read" ON public.merch_variants
  FOR SELECT USING (active=true);
CREATE POLICY "merch_var_admin" ON public.merch_variants FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')));

-- Bundle components: public read; manager/admin write
CREATE POLICY "merch_bundle_pub_read" ON public.merch_bundle_components FOR SELECT USING (true);
CREATE POLICY "merch_bundle_admin" ON public.merch_bundle_components FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')));

-- Stock locations: public read active; manager/admin write
CREATE POLICY "merch_loc_pub_read" ON public.merch_stock_locations FOR SELECT USING (active=true);
CREATE POLICY "merch_loc_admin" ON public.merch_stock_locations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')));

-- Inventory: staff/admin read; writes via SECURITY DEFINER RPCs only
CREATE POLICY "merch_inv_staff" ON public.merch_inventory FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')));

-- Inventory transactions: staff/admin read
CREATE POLICY "merch_inv_tx_staff" ON public.merch_inventory_transactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')));

-- Discounts: staff/admin read; manager/admin write
CREATE POLICY "merch_disc_staff_read" ON public.merch_discounts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')));
CREATE POLICY "merch_disc_admin" ON public.merch_discounts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('manager','admin')));

-- Orders: users read own + staff/admin read all; staff can update status
CREATE POLICY "merch_ord_own" ON public.merch_orders FOR SELECT
  USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id=auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin'))
  );
CREATE POLICY "merch_ord_staff_update" ON public.merch_orders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')));

-- Order items: read from accessible orders
CREATE POLICY "merch_oi_read" ON public.merch_order_items FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.merch_orders WHERE
        user_id IN (SELECT id FROM public.users WHERE auth_id=auth.uid()::text)
        OR EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin'))
    )
  );

-- Gift codes: users read own; staff/admin read all; writes via RPC
CREATE POLICY "merch_gc_read" ON public.merch_gift_codes FOR SELECT
  USING (
    order_item_id IN (
      SELECT oi.id FROM public.merch_order_items oi
      JOIN public.merch_orders o ON o.id=oi.order_id
      WHERE o.user_id IN (SELECT id FROM public.users WHERE auth_id=auth.uid()::text)
    )
    OR EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin'))
  );

-- Returns: staff/admin read and insert
CREATE POLICY "merch_ret_staff_read" ON public.merch_returns FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')));
CREATE POLICY "merch_ret_staff_ins" ON public.merch_returns FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE auth_id=auth.uid()::text AND access IN ('staff','manager','admin')));

-- ================================================================
-- RPCs (SECURITY DEFINER — atomic operations + RLS bypass)
-- ================================================================

-- Full catalog with variant inventory totals
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
            'id', v.id, 'label', v.label, 'sku', v.sku,
            'price_override', v.price_override,
            'shipping_charge', v.shipping_charge,
            'active', v.active,
            'storefront_visible', v.storefront_visible,
            'staff_visible', v.staff_visible,
            'sort_order', v.sort_order,
            'inventory', COALESCE(
              (SELECT SUM(mi.quantity) FROM public.merch_inventory mi WHERE mi.variant_id=v.id), 0
            )
          )
        ) FILTER (WHERE v.id IS NOT NULL AND v.active=true
          AND (p_channel='all'
            OR (p_channel='storefront' AND v.storefront_visible=true)
            OR (p_channel='staff'      AND v.staff_visible=true)
          )
        ),
        '[]'::jsonb
      ) AS variants
    FROM public.merch_products p
    LEFT JOIN public.merch_categories c ON c.id=p.category_id
    LEFT JOIN public.merch_variants v ON v.product_id=p.id
    WHERE p.active=true AND p.archived=false
      AND (p_channel='all'
        OR (p_channel='storefront' AND p.storefront_visible=true)
        OR (p_channel='staff'      AND p.staff_visible=true)
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

-- Validate a discount code
CREATE OR REPLACE FUNCTION public.validate_merch_discount(p_code text, p_channel text DEFAULT 'online')
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT to_json(d) FROM public.merch_discounts d
  WHERE upper(d.code)=upper(p_code) AND d.active=true
    AND (d.usage_limit IS NULL OR d.usage_count < d.usage_limit)
    AND (d.starts_at IS NULL OR d.starts_at<=now())
    AND (d.ends_at   IS NULL OR d.ends_at  >=now())
    AND (d.channel='both' OR d.channel=p_channel)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.validate_merch_discount TO authenticated, anon;

-- Atomic inventory adjustment + transaction record
CREATE OR REPLACE FUNCTION public.adjust_merch_inventory(
  p_variant_id       uuid,
  p_location_id      uuid,
  p_quantity_change  int,
  p_transaction_type text,
  p_notes            text    DEFAULT NULL,
  p_created_by       uuid    DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_loc_id uuid;
BEGIN
  v_loc_id := COALESCE(p_location_id,
    (SELECT id FROM public.merch_stock_locations WHERE is_default=true LIMIT 1));
  INSERT INTO public.merch_inventory (variant_id, location_id, quantity)
    VALUES (p_variant_id, v_loc_id, GREATEST(p_quantity_change,0))
  ON CONFLICT (variant_id, location_id)
    DO UPDATE SET quantity = GREATEST(merch_inventory.quantity+p_quantity_change, 0);
  INSERT INTO public.merch_inventory_transactions
    (variant_id, location_id, transaction_type, quantity_change, notes, created_by)
  VALUES (p_variant_id, v_loc_id, p_transaction_type, p_quantity_change, p_notes, p_created_by);
END;
$$;
GRANT EXECUTE ON FUNCTION public.adjust_merch_inventory TO authenticated;

-- Atomic order creation: order + items + inventory decrements + gift codes
CREATE OR REPLACE FUNCTION public.create_merch_order(
  p_user_id          uuid,
  p_customer_name    text,
  p_fulfillment_type text,
  p_shipping_address jsonb,
  p_items            jsonb,   -- [{product_id,variant_id,quantity,unit_price,discount_amount,product_type}]
  p_discount_id      uuid    DEFAULT NULL,
  p_discount_amount  numeric DEFAULT 0,
  p_shipping_charge  numeric DEFAULT 0,
  p_notes            text    DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order_id     uuid;
  v_total        numeric := 0;
  v_item         jsonb;
  v_oi_id        uuid;
  v_ptype        text;
  v_gift_code    text;
  v_loc_id       uuid;
  v_result       json;
BEGIN
  SELECT id INTO v_loc_id FROM public.merch_stock_locations WHERE is_default=true LIMIT 1;

  SELECT COALESCE(SUM(
    (item->>'unit_price')::numeric * (item->>'quantity')::int
    - COALESCE((item->>'discount_amount')::numeric,0)
  ),0) INTO v_total FROM jsonb_array_elements(p_items) item;
  v_total := GREATEST(v_total + p_shipping_charge - p_discount_amount, 0);

  INSERT INTO public.merch_orders
    (user_id, customer_name, status, total, fulfillment_type, shipping_address,
     shipping_charge, discount_id, discount_amount, notes)
  VALUES
    (p_user_id, p_customer_name, 'paid', v_total, p_fulfillment_type, p_shipping_address,
     p_shipping_charge, p_discount_id, p_discount_amount, p_notes)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ptype := v_item->>'product_type';

    INSERT INTO public.merch_order_items
      (order_id, product_id, variant_id, quantity, unit_price, discount_amount)
    VALUES (
      v_order_id,
      (v_item->>'product_id')::uuid,
      NULLIF(v_item->>'variant_id','')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'discount_amount')::numeric,0)
    ) RETURNING id INTO v_oi_id;

    IF v_ptype='physical' AND (v_item->>'variant_id') IS NOT NULL AND (v_item->>'variant_id')!='' AND v_loc_id IS NOT NULL THEN
      UPDATE public.merch_inventory
        SET quantity=GREATEST(quantity-(v_item->>'quantity')::int,0)
      WHERE variant_id=(v_item->>'variant_id')::uuid AND location_id=v_loc_id;
      INSERT INTO public.merch_inventory_transactions
        (variant_id,location_id,transaction_type,quantity_change,order_id)
      VALUES ((v_item->>'variant_id')::uuid,v_loc_id,'sale',-((v_item->>'quantity')::int),v_order_id);

    ELSIF v_ptype='bundle' AND v_loc_id IS NOT NULL THEN
      UPDATE public.merch_inventory mi
        SET quantity=GREATEST(mi.quantity-(bc.quantity*(v_item->>'quantity')::int),0)
      FROM public.merch_bundle_components bc
      WHERE bc.bundle_product_id=(v_item->>'product_id')::uuid
        AND mi.variant_id=bc.component_variant_id AND mi.location_id=v_loc_id;
      INSERT INTO public.merch_inventory_transactions
        (variant_id,location_id,transaction_type,quantity_change,order_id)
      SELECT bc.component_variant_id,v_loc_id,'bundle_consumption',
        -(bc.quantity*(v_item->>'quantity')::int),v_order_id
      FROM public.merch_bundle_components bc
      WHERE bc.bundle_product_id=(v_item->>'product_id')::uuid;

    ELSIF v_ptype IN ('gift_card','gift_cert') THEN
      v_gift_code := upper(
        substr(replace(gen_random_uuid()::text,'-',''),1,4)||'-'||
        substr(replace(gen_random_uuid()::text,'-',''),1,4)||'-'||
        substr(replace(gen_random_uuid()::text,'-',''),1,4)||'-'||
        substr(replace(gen_random_uuid()::text,'-',''),1,4)
      );
      INSERT INTO public.merch_gift_codes
        (order_item_id,product_id,code,type,original_value,current_balance,status)
      VALUES (v_oi_id,(v_item->>'product_id')::uuid,v_gift_code,
        v_ptype,(v_item->>'unit_price')::numeric,(v_item->>'unit_price')::numeric,'active');
    END IF;
  END LOOP;

  IF p_discount_id IS NOT NULL THEN
    UPDATE public.merch_discounts SET usage_count=usage_count+1 WHERE id=p_discount_id;
  END IF;

  SELECT to_json(sub) INTO v_result FROM (
    SELECT o.*,
      (SELECT jsonb_agg(oi.*) FROM public.merch_order_items oi WHERE oi.order_id=o.id) AS items,
      (SELECT jsonb_agg(gc.*) FROM public.merch_gift_codes gc
       JOIN public.merch_order_items oi2 ON oi2.id=gc.order_item_id
       WHERE oi2.order_id=o.id) AS gift_codes
    FROM public.merch_orders o WHERE o.id=v_order_id
  ) sub;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_merch_order TO authenticated;

-- Process a return: creates return record + restocks inventory
CREATE OR REPLACE FUNCTION public.process_merch_return(
  p_order_id      uuid,
  p_order_item_id uuid,
  p_quantity      int,
  p_reason        text,
  p_disposition   text,
  p_notes         text DEFAULT NULL,
  p_created_by    uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_variant_id uuid; v_loc_id uuid;
BEGIN
  SELECT oi.variant_id INTO v_variant_id
  FROM public.merch_order_items oi WHERE oi.id=p_order_item_id;
  SELECT id INTO v_loc_id FROM public.merch_stock_locations WHERE is_default=true LIMIT 1;

  INSERT INTO public.merch_returns
    (order_id,order_item_id,quantity,reason,disposition,notes,created_by)
  VALUES (p_order_id,p_order_item_id,p_quantity,p_reason,p_disposition,p_notes,p_created_by);

  IF p_disposition IN ('restock_sellable','restock_damaged') AND v_variant_id IS NOT NULL AND v_loc_id IS NOT NULL THEN
    UPDATE public.merch_inventory
      SET quantity=quantity+p_quantity
    WHERE variant_id=v_variant_id AND location_id=v_loc_id;
    INSERT INTO public.merch_inventory_transactions
      (variant_id,location_id,transaction_type,quantity_change,order_id,notes,created_by)
    VALUES (v_variant_id,v_loc_id,'return',p_quantity,p_order_id,
      CASE WHEN p_disposition='restock_damaged' THEN 'DAMAGED: '||COALESCE(p_notes,'') ELSE p_notes END,
      p_created_by);
  END IF;
  UPDATE public.merch_orders SET status='refunded' WHERE id=p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_merch_return TO authenticated;

-- Atomically redeem a gift code (FOR UPDATE prevents double-spend)
CREATE OR REPLACE FUNCTION public.redeem_gift_code(
  p_code             text,
  p_redeemed_by      uuid    DEFAULT NULL,
  p_amount_to_redeem numeric DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_code record; v_new_balance numeric;
BEGIN
  SELECT * INTO v_code FROM public.merch_gift_codes WHERE code=upper(p_code) FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success',false,'error','Code not found'); END IF;
  IF v_code.status!='active' THEN RETURN json_build_object('success',false,'error','Code is '||v_code.status); END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at<now() THEN
    UPDATE public.merch_gift_codes SET status='expired' WHERE id=v_code.id;
    RETURN json_build_object('success',false,'error','Code has expired');
  END IF;
  IF v_code.type='gift_cert' THEN
    UPDATE public.merch_gift_codes
      SET status='redeemed',redeemed_at=now(),redeemed_by=p_redeemed_by,current_balance=0
    WHERE id=v_code.id;
    RETURN json_build_object('success',true,'type','gift_cert','value',v_code.current_balance);
  ELSE
    v_new_balance:=GREATEST(v_code.current_balance-COALESCE(p_amount_to_redeem,v_code.current_balance),0);
    UPDATE public.merch_gift_codes SET
      current_balance=v_new_balance,
      status=CASE WHEN v_new_balance<=0 THEN 'redeemed' ELSE 'active' END,
      redeemed_at=CASE WHEN v_new_balance<=0 THEN now() ELSE redeemed_at END,
      redeemed_by=CASE WHEN v_new_balance<=0 THEN p_redeemed_by ELSE redeemed_by END
    WHERE id=v_code.id;
    RETURN json_build_object('success',true,'type','gift_card',
      'amount_redeemed',COALESCE(p_amount_to_redeem,v_code.current_balance),'new_balance',v_new_balance);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.redeem_gift_code TO authenticated;
