-- Tighten anon grants on social and merch tables.
--
-- Social / email tables — all actions require authentication; anon gets nothing.
-- Merch catalog tables  — anon SELECT is intentional (public browsing via USING(true)
--   policies); write ops are not needed by anon.
-- Merch operational tables — staff/admin only; anon gets nothing.

-- ── Social / email ────────────────────────────────────────────────────────────
REVOKE ALL ON public.email_preferences FROM anon;
REVOKE ALL ON public.friend_requests   FROM anon;
REVOKE ALL ON public.friendships       FROM anon;

-- ── Merch catalog — keep anon SELECT, revoke writes ──────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.merch_categories        FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.merch_products          FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.merch_variants          FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.merch_bundle_components FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.merch_stock_locations   FROM anon;

-- ── Merch operational — no anon access at all ────────────────────────────────
REVOKE ALL ON public.merch_inventory               FROM anon;
REVOKE ALL ON public.merch_inventory_transactions  FROM anon;
REVOKE ALL ON public.merch_discounts               FROM anon;
REVOKE ALL ON public.merch_orders                  FROM anon;
REVOKE ALL ON public.merch_order_items             FROM anon;
REVOKE ALL ON public.merch_gift_codes              FROM anon;
REVOKE ALL ON public.merch_returns                 FROM anon;
REVOKE ALL ON public.merch_purchase_orders         FROM anon;
REVOKE ALL ON public.merch_po_lines                FROM anon;
REVOKE ALL ON public.merch_vendors                 FROM anon;
