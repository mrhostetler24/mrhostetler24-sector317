-- ============================================================
-- Migration: fix update_platoon_tag cascade
-- Version:   20260313001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS FIXES:
--   Previous version cascaded by matching platoon_tag = old_tag,
--   which skipped members whose tag was NULL or out of sync.
--   Now cascades by platoon membership (platoon_id) instead.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_platoon_tag(p_tag text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id      uuid := private_get_my_user_id();
  v_platoon_id uuid;
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

  -- Update platoon master record (unique constraint throws on collision)
  UPDATE platoons SET tag = p_tag WHERE id = v_platoon_id;

  -- Cascade to ALL current members by platoon membership, not old tag value
  UPDATE public.users
  SET    platoon_tag = p_tag
  WHERE  id IN (
    SELECT user_id FROM platoon_members WHERE platoon_id = v_platoon_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_platoon_tag(text) TO authenticated;
