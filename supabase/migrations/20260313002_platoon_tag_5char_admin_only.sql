-- ============================================================
-- Migration: 5-character platoon tags restricted to site admins
-- Version:   20260313002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Regular users: tags limited to 2–4 characters.
--   Site admins (access IN ('staff','manager','admin')): up to 5 characters.
--   Enforced in both create_platoon and update_platoon_tag RPCs.
--   DB CHECK constraint already allows 2–5 chars — no schema change needed.
-- ============================================================


-- ── create_platoon ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_platoon(
  p_tag         text,
  p_name        text,
  p_description text DEFAULT NULL,
  p_is_open     boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id    uuid;
  v_platoon_id uuid;
  v_tag        text;
  v_access     text;
BEGIN
  v_user_id := private_get_my_user_id();
  v_tag := UPPER(TRIM(p_tag));

  -- Must not already be in a platoon
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
  END IF;

  -- 5-char tags are reserved for site admins
  IF LENGTH(v_tag) = 5 THEN
    SELECT access INTO v_access FROM public.users WHERE id = v_user_id;
    IF v_access NOT IN ('staff', 'manager', 'admin') THEN
      RAISE EXCEPTION 'tag_too_long';
    END IF;
  END IF;

  -- Create platoon
  INSERT INTO public.platoons (tag, name, description, is_open, created_by)
  VALUES (v_tag, TRIM(p_name), TRIM(p_description), p_is_open, v_user_id)
  RETURNING platoons.id INTO v_platoon_id;

  -- Add creator as admin
  INSERT INTO public.platoon_members (platoon_id, user_id, role)
  VALUES (v_platoon_id, v_user_id, 'admin');

  -- Update denormalized tag
  UPDATE public.users SET platoon_tag = v_tag WHERE id = v_user_id;

  RETURN v_platoon_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_platoon(text, text, text, boolean) TO authenticated;


-- ── update_platoon_tag ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_platoon_tag(p_tag text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id      uuid := private_get_my_user_id();
  v_platoon_id uuid;
  v_access     text;
BEGIN
  -- Must be platoon admin
  SELECT platoon_id INTO v_platoon_id
  FROM   platoon_members
  WHERE  user_id = v_my_id AND role = 'admin';

  IF v_platoon_id IS NULL THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Validate format: 2–5 uppercase letters/digits
  IF p_tag !~ '^[A-Z0-9]{2,5}$' THEN
    RAISE EXCEPTION 'invalid_tag';
  END IF;

  -- 5-char tags are reserved for site admins
  IF LENGTH(p_tag) = 5 THEN
    SELECT access INTO v_access FROM public.users WHERE id = v_my_id;
    IF v_access NOT IN ('staff', 'manager', 'admin') THEN
      RAISE EXCEPTION 'tag_too_long';
    END IF;
  END IF;

  -- Update platoon master record (unique constraint throws on collision)
  UPDATE platoons SET tag = p_tag WHERE id = v_platoon_id;

  -- Cascade to ALL current members by platoon membership
  UPDATE public.users
  SET    platoon_tag = p_tag
  WHERE  id IN (
    SELECT user_id FROM platoon_members WHERE platoon_id = v_platoon_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_platoon_tag(text) TO authenticated;
