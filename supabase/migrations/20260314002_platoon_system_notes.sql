-- ============================================================
-- Migration: Platoon board system notes for join / AWOL events
-- Version:   20260314002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds automatic system-generated board posts (user_id = NULL)
--   when a member joins or leaves the platoon:
--     "DisplayName has enlisted."
--     "DisplayName has gone AWOL."
--
--   Three RPCs are updated:
--     join_platoon         — open-enroll joins
--     approve_join_request — approval-gate joins
--     go_awol              — voluntary departure (non-disband path only)
-- ============================================================


-- ── 1. join_platoon ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.join_platoon(uuid);

CREATE OR REPLACE FUNCTION public.join_platoon(p_platoon_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id      uuid;
  v_is_open      boolean;
  v_display_name text;
BEGIN
  v_user_id := private_get_my_user_id();

  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
  END IF;

  SELECT is_open INTO v_is_open FROM public.platoons WHERE id = p_platoon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'platoon_not_found'; END IF;
  IF NOT v_is_open THEN RAISE EXCEPTION 'platoon_requires_approval'; END IF;

  INSERT INTO public.platoon_members (platoon_id, user_id, role)
  VALUES (p_platoon_id, v_user_id, 'member');

  UPDATE public.users
  SET    platoon_tag = (SELECT tag FROM public.platoons WHERE id = p_platoon_id)
  WHERE  id = v_user_id;

  -- System board note
  SELECT COALESCE(leaderboard_name, name) INTO v_display_name
  FROM   public.users WHERE id = v_user_id;

  INSERT INTO public.platoon_posts (platoon_id, user_id, content)
  VALUES (p_platoon_id, NULL, COALESCE(v_display_name, 'A new recruit') || ' has enlisted.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_platoon(uuid) TO authenticated;


-- ── 2. approve_join_request ───────────────────────────────────

DROP FUNCTION IF EXISTS public.approve_join_request(uuid);

CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id        uuid;
  v_my_role      text;
  v_req          record;
  v_display_name text;
BEGIN
  v_my_id := private_get_my_user_id();

  SELECT pm.role INTO v_my_role
  FROM   public.platoon_members pm
  WHERE  pm.user_id = v_my_id LIMIT 1;

  IF v_my_role NOT IN ('admin','sergeant') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_req FROM public.platoon_join_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platoon_members
    WHERE user_id = v_my_id AND platoon_id = v_req.platoon_id
  ) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Edge case: applicant already joined another platoon
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_req.user_id) THEN
    DELETE FROM public.platoon_join_requests WHERE id = p_request_id;
    RETURN;
  END IF;

  INSERT INTO public.platoon_members (platoon_id, user_id, role)
  VALUES (v_req.platoon_id, v_req.user_id, 'member');

  UPDATE public.users
  SET    platoon_tag = (SELECT tag FROM public.platoons WHERE id = v_req.platoon_id)
  WHERE  id = v_req.user_id;

  DELETE FROM public.platoon_join_requests WHERE id = p_request_id;

  -- System board note
  SELECT COALESCE(leaderboard_name, name) INTO v_display_name
  FROM   public.users WHERE id = v_req.user_id;

  INSERT INTO public.platoon_posts (platoon_id, user_id, content)
  VALUES (v_req.platoon_id, NULL, COALESCE(v_display_name, 'A recruit') || ' has enlisted.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_join_request(uuid) TO authenticated;


-- ── 3. go_awol ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.go_awol();

CREATE OR REPLACE FUNCTION public.go_awol()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id      uuid;
  v_platoon      uuid;
  v_role         text;
  v_admins       int;
  v_display_name text;
BEGIN
  v_user_id := private_get_my_user_id();

  SELECT platoon_id, role INTO v_platoon, v_role
  FROM   public.platoon_members WHERE user_id = v_user_id LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;

  IF v_role = 'admin' THEN
    SELECT COUNT(*) INTO v_admins FROM public.platoon_members
    WHERE platoon_id = v_platoon AND role = 'admin';
    IF v_admins <= 1 THEN
      IF EXISTS (SELECT 1 FROM public.platoon_members
                 WHERE platoon_id = v_platoon AND user_id <> v_user_id LIMIT 1) THEN
        RAISE EXCEPTION 'must_transfer_admin';
      END IF;
      -- Sole admin, no other members — disband (platoon deleted, no board note needed)
      UPDATE public.users SET platoon_tag = NULL
      WHERE id IN (SELECT user_id FROM public.platoon_members WHERE platoon_id = v_platoon);
      DELETE FROM public.platoons WHERE id = v_platoon;
      RETURN;
    END IF;
  END IF;

  -- Resolve display name before we touch anything
  SELECT COALESCE(leaderboard_name, name) INTO v_display_name
  FROM   public.users WHERE id = v_user_id;

  -- System board note (user_id = NULL so it persists after member is removed)
  INSERT INTO public.platoon_posts (platoon_id, user_id, content)
  VALUES (v_platoon, NULL, COALESCE(v_display_name, 'A member') || ' has gone AWOL.');

  DELETE FROM public.platoon_members WHERE user_id = v_user_id AND platoon_id = v_platoon;
  UPDATE public.users SET platoon_tag = NULL WHERE id = v_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.go_awol() TO authenticated;
