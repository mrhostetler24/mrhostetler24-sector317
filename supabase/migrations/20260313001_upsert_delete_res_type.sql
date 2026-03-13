-- ============================================================
-- Migration: SECURITY DEFINER RPCs for reservation_types
-- Version:   20260313001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds upsert_res_type and delete_res_type RPCs so staff/admin
--   can mutate reservation_types without needing direct table
--   permissions (RLS was blocking direct upsert/delete).
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_res_type(
  p_id                    uuid,
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

GRANT EXECUTE ON FUNCTION public.upsert_res_type(uuid,text,text,text,text,numeric,int,text,boolean,boolean) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_res_type(p_id uuid)
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

GRANT EXECUTE ON FUNCTION public.delete_res_type(uuid) TO authenticated;
