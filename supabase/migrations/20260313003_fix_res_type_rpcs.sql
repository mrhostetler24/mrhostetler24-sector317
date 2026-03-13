-- ============================================================
-- Migration: fix upsert_res_type / delete_res_type (text id)
-- Version:   20260313003
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   reservation_types.id is TEXT (e.g. "coop-open"), not UUID.
--   An old version of upsert_res_type had p_id uuid which caused
--   "invalid input syntax for type uuid: 'coop-open'".
--   This migration drops ALL overloads of both functions by
--   scanning pg_proc (avoids needing to know the exact sig),
--   then recreates them cleanly with p_id text.
-- ============================================================


-- ── Drop ALL overloads of both functions ─────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname IN ('upsert_res_type', 'delete_res_type')
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END;
$$;


-- ── upsert_res_type (p_id TEXT) ───────────────────────────────
CREATE FUNCTION public.upsert_res_type(
  p_id                    text,
  p_name                  text,
  p_mode                  text,
  p_style                 text,
  p_pricing_mode          text,
  p_price                 numeric,
  p_max_players           int,
  p_description           text,
  p_active                boolean,
  p_available_for_booking boolean
)
RETURNS SETOF public.reservation_types
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_access text;
BEGIN
  SELECT access INTO v_access FROM public.users WHERE auth_id = auth.uid();
  IF v_access NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_id IS NOT NULL THEN
    RETURN QUERY
    UPDATE public.reservation_types SET
      name                  = p_name,
      mode                  = p_mode,
      style                 = p_style,
      pricing_mode          = p_pricing_mode,
      price                 = p_price,
      max_players           = p_max_players,
      description           = p_description,
      active                = p_active,
      available_for_booking = p_available_for_booking
    WHERE id = p_id
    RETURNING *;
  ELSE
    RETURN QUERY
    INSERT INTO public.reservation_types
      (name, mode, style, pricing_mode, price, max_players, description, active, available_for_booking)
    VALUES
      (p_name, p_mode, p_style, p_pricing_mode, p_price, p_max_players, p_description, p_active, p_available_for_booking)
    RETURNING *;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_res_type(text,text,text,text,text,numeric,int,text,boolean,boolean) TO authenticated;


-- ── delete_res_type (p_id TEXT) ───────────────────────────────
CREATE FUNCTION public.delete_res_type(p_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_access text;
BEGIN
  SELECT access INTO v_access FROM public.users WHERE auth_id = auth.uid();
  IF v_access NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  DELETE FROM public.reservation_types WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_res_type(text) TO authenticated;
