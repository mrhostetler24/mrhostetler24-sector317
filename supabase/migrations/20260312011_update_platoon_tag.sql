-- ============================================================
-- Migration: update_platoon_tag RPC
-- Version:   20260312011
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds update_platoon_tag RPC so platoon admins can change
--   their platoon tag from the Settings tab. Cascades the new
--   tag to all current member user rows automatically.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_platoon_tag(p_tag text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id      uuid := private_get_my_user_id();
  v_platoon_id uuid;
  v_old_tag    text;
BEGIN
  -- Must be admin
  SELECT platoon_id INTO v_platoon_id
  FROM   platoon_members
  WHERE  user_id = v_my_id AND role = 'admin';

  IF v_platoon_id IS NULL THEN
    RAISE EXCEPTION 'not admin';
  END IF;

  -- Validate format: 2–5 uppercase letters/digits
  IF p_tag !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'invalid_tag';
  END IF;

  -- Save old tag for cascade
  SELECT tag INTO v_old_tag FROM platoons WHERE id = v_platoon_id;

  -- Update platoon (unique constraint will throw on collision)
  UPDATE platoons SET tag = p_tag WHERE id = v_platoon_id;

  -- Cascade to all current member user rows
  UPDATE public.users
  SET    platoon_tag = p_tag
  WHERE  platoon_tag = v_old_tag;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_platoon_tag(text) TO authenticated;
