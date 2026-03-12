-- ============================================================
-- Migration: Platoon (Guild/Clan) System
-- Version:   20260312001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Creates platoons, platoon_members, platoon_join_requests,
--      platoon_posts tables
--   2. Adds platoon_tag (denormalized) column to users for fast
--      leaderboard display
--   3. All SECURITY DEFINER RPCs for create/join/leave/manage
--   4. Updates get_friend_profile RPC to return access + platoon_tag
--   5. Rebuilds leaderboard views to include platoon_tag
--
-- SAFE TO RE-RUN: CREATE OR REPLACE + IF NOT EXISTS throughout.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 1 — Tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platoons (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tag         text        NOT NULL,
  name        text        NOT NULL,
  description text,
  badge_url   text,
  is_open     boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES public.users(id),
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT platoons_tag_unique  UNIQUE (tag),
  CONSTRAINT platoons_name_unique UNIQUE (name),
  CONSTRAINT platoons_tag_format  CHECK (tag ~ '^[A-Z0-9]{2,5}$')
);

-- One platoon per user enforced by UNIQUE(user_id)
CREATE TABLE IF NOT EXISTS public.platoon_members (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  platoon_id uuid        NOT NULL REFERENCES public.platoons(id)  ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('admin','sergeant','member')),
  joined_at  timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.platoon_join_requests (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  platoon_id   uuid        NOT NULL REFERENCES public.platoons(id)  ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  message      text,
  requested_at timestamptz DEFAULT now(),
  UNIQUE (platoon_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.platoon_posts (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  platoon_id uuid        NOT NULL REFERENCES public.platoons(id)  ON DELETE CASCADE,
  user_id    uuid        REFERENCES public.users(id),
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Denormalized platoon tag on users for fast leaderboard display
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS platoon_tag text;


-- ────────────────────────────────────────────────────────────
-- PART 2 — RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.platoons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platoon_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platoon_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platoon_posts         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platoons_select"        ON public.platoons;
DROP POLICY IF EXISTS "platoons_insert"        ON public.platoons;
DROP POLICY IF EXISTS "platoons_update"        ON public.platoons;
DROP POLICY IF EXISTS "platoons_delete"        ON public.platoons;
DROP POLICY IF EXISTS "platoon_members_select" ON public.platoon_members;
DROP POLICY IF EXISTS "platoon_members_insert" ON public.platoon_members;
DROP POLICY IF EXISTS "platoon_members_update" ON public.platoon_members;
DROP POLICY IF EXISTS "platoon_members_delete" ON public.platoon_members;
DROP POLICY IF EXISTS "platoon_posts_select"   ON public.platoon_posts;
DROP POLICY IF EXISTS "platoon_posts_insert"   ON public.platoon_posts;
DROP POLICY IF EXISTS "platoon_posts_update"   ON public.platoon_posts;
DROP POLICY IF EXISTS "platoon_posts_delete"   ON public.platoon_posts;
DROP POLICY IF EXISTS "join_requests_select"   ON public.platoon_join_requests;
DROP POLICY IF EXISTS "join_requests_insert"   ON public.platoon_join_requests;
DROP POLICY IF EXISTS "join_requests_delete"   ON public.platoon_join_requests;

-- SELECT: all authenticated users can read platoon data
CREATE POLICY "platoons_select"        ON public.platoons              FOR SELECT TO authenticated USING (true);
CREATE POLICY "platoon_members_select" ON public.platoon_members       FOR SELECT TO authenticated USING (true);
CREATE POLICY "platoon_posts_select"   ON public.platoon_posts         FOR SELECT TO authenticated USING (true);
CREATE POLICY "join_requests_select"   ON public.platoon_join_requests FOR SELECT TO authenticated USING (true);

-- INSERT / UPDATE / DELETE: allow authenticated so SECURITY DEFINER RPCs can write
-- (authorization logic lives inside the RPCs, not in these policies)
CREATE POLICY "platoons_insert"        ON public.platoons              FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "platoons_update"        ON public.platoons              FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "platoons_delete"        ON public.platoons              FOR DELETE TO authenticated USING (true);
CREATE POLICY "platoon_members_insert" ON public.platoon_members       FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "platoon_members_update" ON public.platoon_members       FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "platoon_members_delete" ON public.platoon_members       FOR DELETE TO authenticated USING (true);
CREATE POLICY "join_requests_insert"   ON public.platoon_join_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "join_requests_delete"   ON public.platoon_join_requests FOR DELETE TO authenticated USING (true);
CREATE POLICY "platoon_posts_insert"   ON public.platoon_posts         FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "platoon_posts_update"   ON public.platoon_posts         FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "platoon_posts_delete"   ON public.platoon_posts         FOR DELETE TO authenticated USING (true);


-- ────────────────────────────────────────────────────────────
-- PART 3 — Helper: resolve calling user's public.users.id
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private_get_my_user_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid()::text LIMIT 1;
$$;


-- ────────────────────────────────────────────────────────────
-- PART 4 — Platoon RPCs
-- ────────────────────────────────────────────────────────────

-- ── 4.1 search_platoons ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_platoons(p_query text DEFAULT '')
RETURNS TABLE (
  id           uuid,
  tag          text,
  name         text,
  description  text,
  badge_url    text,
  is_open      boolean,
  member_count bigint,
  created_at   timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.tag, p.name, p.description, p.badge_url, p.is_open,
         COUNT(pm.id) AS member_count, p.created_at
  FROM   public.platoons p
  LEFT   JOIN public.platoon_members pm ON pm.platoon_id = p.id
  WHERE  p_query = ''
      OR p.tag  ILIKE '%' || p_query || '%'
      OR p.name ILIKE '%' || p_query || '%'
  GROUP  BY p.id
  ORDER  BY member_count DESC, p.name;
$$;
GRANT EXECUTE ON FUNCTION public.search_platoons(text) TO authenticated;


-- ── 4.2 get_platoon_for_user ─────────────────────────────────
-- Returns the platoon the given user belongs to (or NULL row)
CREATE OR REPLACE FUNCTION public.get_platoon_for_user(p_user_id uuid)
RETURNS TABLE (
  id           uuid,
  tag          text,
  name         text,
  description  text,
  badge_url    text,
  is_open      boolean,
  member_count bigint,
  my_role      text,
  created_at   timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.tag, p.name, p.description, p.badge_url, p.is_open,
         (SELECT COUNT(*) FROM public.platoon_members WHERE platoon_id = p.id) AS member_count,
         pm.role AS my_role,
         p.created_at
  FROM   public.platoon_members pm
  JOIN   public.platoons p ON p.id = pm.platoon_id
  WHERE  pm.user_id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_for_user(uuid) TO authenticated;


-- ── 4.3 get_platoon_members ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_platoon_members(p_platoon_id uuid)
RETURNS TABLE (
  user_id        uuid,
  role           text,
  joined_at      timestamptz,
  leaderboard_name text,
  real_name      text,
  avatar_url     text,
  hide_avatar    boolean,
  platoon_tag    text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT pm.user_id, pm.role, pm.joined_at,
         COALESCE(u.leaderboard_name, u.name) AS leaderboard_name,
         u.name AS real_name,
         u.avatar_url,
         COALESCE(u.hide_avatar, false) AS hide_avatar,
         u.platoon_tag
  FROM   public.platoon_members pm
  JOIN   public.users u ON u.id = pm.user_id
  WHERE  pm.platoon_id = p_platoon_id
  ORDER  BY
    CASE pm.role WHEN 'admin' THEN 1 WHEN 'sergeant' THEN 2 ELSE 3 END,
    pm.joined_at;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_members(uuid) TO authenticated;


-- ── 4.4 get_platoon_join_requests ───────────────────────────
-- Only admin/sergeant of the caller's own platoon can see requests
CREATE OR REPLACE FUNCTION public.get_platoon_join_requests()
RETURNS TABLE (
  id             uuid,
  platoon_id     uuid,
  user_id        uuid,
  message        text,
  requested_at   timestamptz,
  leaderboard_name text,
  real_name      text,
  avatar_url     text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT pjr.id, pjr.platoon_id, pjr.user_id, pjr.message, pjr.requested_at,
         COALESCE(u.leaderboard_name, u.name) AS leaderboard_name,
         u.name AS real_name, u.avatar_url
  FROM   public.platoon_join_requests pjr
  JOIN   public.users u ON u.id = pjr.user_id
  WHERE  pjr.platoon_id = (
    SELECT platoon_id FROM public.platoon_members
    WHERE  user_id = private_get_my_user_id()
    LIMIT  1
  )
  AND (
    SELECT role FROM public.platoon_members
    WHERE  user_id = private_get_my_user_id() LIMIT 1
  ) IN ('admin','sergeant')
  ORDER  BY pjr.requested_at;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_join_requests() TO authenticated;


-- ── 4.5 get_platoon_posts ────────────────────────────────────
-- Members only; paginated newest-first
CREATE OR REPLACE FUNCTION public.get_platoon_posts(
  p_platoon_id uuid,
  p_limit      int  DEFAULT 20,
  p_offset     int  DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  platoon_id       uuid,
  user_id          uuid,
  content          text,
  created_at       timestamptz,
  leaderboard_name text,
  avatar_url       text,
  hide_avatar      boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  -- Verify caller is a member
  SELECT pp.id, pp.platoon_id, pp.user_id, pp.content, pp.created_at,
         COALESCE(u.leaderboard_name, u.name) AS leaderboard_name,
         u.avatar_url,
         COALESCE(u.hide_avatar, false) AS hide_avatar
  FROM   public.platoon_posts pp
  JOIN   public.users u ON u.id = pp.user_id
  WHERE  pp.platoon_id = p_platoon_id
  AND    EXISTS (
    SELECT 1 FROM public.platoon_members
    WHERE  platoon_id = p_platoon_id
    AND    user_id = private_get_my_user_id()
  )
  ORDER  BY pp.created_at DESC
  LIMIT  p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_posts(uuid, int, int) TO authenticated;


-- ── 4.6 get_platoon_sessions ─────────────────────────────────
-- Past reservations where ≥1 platoon member played
CREATE OR REPLACE FUNCTION public.get_platoon_sessions(p_platoon_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  date           date,
  type_name      text,
  mode           text,
  member_players jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (r.id)
    r.id AS reservation_id,
    r.date,
    rt.name AS type_name,
    rt.mode,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'leaderboard_name', COALESCE(u.leaderboard_name, u.name),
        'avatar_url', u.avatar_url
      ))
      FROM   public.reservation_players rp2
      JOIN   public.platoon_members pm2 ON pm2.user_id = rp2.user_id AND pm2.platoon_id = p_platoon_id
      JOIN   public.users u ON u.id = rp2.user_id
      WHERE  rp2.reservation_id = r.id
    ) AS member_players
  FROM   public.reservations r
  JOIN   public.reservation_types rt ON rt.id = r.type_id
  JOIN   public.reservation_players rp ON rp.reservation_id = r.id
  JOIN   public.platoon_members pm ON pm.user_id = rp.user_id AND pm.platoon_id = p_platoon_id
  WHERE  r.date < CURRENT_DATE
    AND  EXISTS (
      SELECT 1 FROM public.platoon_members
      WHERE  platoon_id = p_platoon_id
      AND    user_id = private_get_my_user_id()
    )
  ORDER  BY r.id, r.date DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_sessions(uuid) TO authenticated;


-- ── 4.7 get_platoon_upcoming ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_platoon_upcoming(p_platoon_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  date           date,
  start_time     text,
  type_name      text,
  member_players jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (r.id)
    r.id AS reservation_id,
    r.date,
    r.start_time::text,
    rt.name AS type_name,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'leaderboard_name', COALESCE(u.leaderboard_name, u.name),
        'avatar_url', u.avatar_url
      ))
      FROM   public.reservation_players rp2
      JOIN   public.platoon_members pm2 ON pm2.user_id = rp2.user_id AND pm2.platoon_id = p_platoon_id
      JOIN   public.users u ON u.id = rp2.user_id
      WHERE  rp2.reservation_id = r.id
    ) AS member_players
  FROM   public.reservations r
  JOIN   public.reservation_types rt ON rt.id = r.type_id
  JOIN   public.reservation_players rp ON rp.reservation_id = r.id
  JOIN   public.platoon_members pm ON pm.user_id = rp.user_id AND pm.platoon_id = p_platoon_id
  WHERE  r.date >= CURRENT_DATE
    AND  EXISTS (
      SELECT 1 FROM public.platoon_members
      WHERE  platoon_id = p_platoon_id
      AND    user_id = private_get_my_user_id()
    )
  ORDER  BY r.id, r.date ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_upcoming(uuid) TO authenticated;


-- ── 4.8 create_platoon ───────────────────────────────────────
-- Returns the new platoon's uuid (avoids OUT-param name conflicts with column names)
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
BEGIN
  v_user_id := private_get_my_user_id();
  v_tag := UPPER(TRIM(p_tag));

  -- Must not already be in a platoon
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
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


-- ── 4.9 join_platoon ─────────────────────────────────────────
-- Open platoons only; closed platoons use request_to_join
CREATE OR REPLACE FUNCTION public.join_platoon(p_platoon_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_is_open boolean;
BEGIN
  v_user_id := private_get_my_user_id();

  -- Check caller not already in a platoon
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
  END IF;

  SELECT is_open INTO v_is_open FROM public.platoons WHERE id = p_platoon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'platoon_not_found'; END IF;
  IF NOT v_is_open THEN RAISE EXCEPTION 'platoon_requires_approval'; END IF;

  INSERT INTO public.platoon_members (platoon_id, user_id, role)
  VALUES (p_platoon_id, v_user_id, 'member');

  -- Update denormalized tag
  UPDATE public.users SET platoon_tag = (SELECT tag FROM public.platoons WHERE id = p_platoon_id)
  WHERE id = v_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_platoon(uuid) TO authenticated;


-- ── 4.10 request_to_join ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_to_join(p_platoon_id uuid, p_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := private_get_my_user_id();

  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platoons WHERE id = p_platoon_id) THEN
    RAISE EXCEPTION 'platoon_not_found';
  END IF;

  INSERT INTO public.platoon_join_requests (platoon_id, user_id, message)
  VALUES (p_platoon_id, v_user_id, p_message)
  ON CONFLICT (platoon_id, user_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_to_join(uuid, text) TO authenticated;


-- ── 4.11 cancel_join_request ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_join_request(p_platoon_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.platoon_join_requests
  WHERE platoon_id = p_platoon_id
    AND user_id = private_get_my_user_id();
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_join_request(uuid) TO authenticated;


-- ── 4.12 approve_join_request ────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id    uuid;
  v_my_role  text;
  v_req      record;
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

  -- Verify the request belongs to our platoon
  IF NOT EXISTS (
    SELECT 1 FROM public.platoon_members
    WHERE user_id = v_my_id AND platoon_id = v_req.platoon_id
  ) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Already in a platoon? (edge case)
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_req.user_id) THEN
    DELETE FROM public.platoon_join_requests WHERE id = p_request_id;
    RETURN;
  END IF;

  INSERT INTO public.platoon_members (platoon_id, user_id, role)
  VALUES (v_req.platoon_id, v_req.user_id, 'member');

  UPDATE public.users SET platoon_tag = (SELECT tag FROM public.platoons WHERE id = v_req.platoon_id)
  WHERE id = v_req.user_id;

  DELETE FROM public.platoon_join_requests WHERE id = p_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_join_request(uuid) TO authenticated;


-- ── 4.13 deny_join_request ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.deny_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id uuid;
  v_my_role text;
  v_platoon_id uuid;
BEGIN
  v_my_id := private_get_my_user_id();

  SELECT pm.role, pm.platoon_id INTO v_my_role, v_platoon_id
  FROM   public.platoon_members pm WHERE pm.user_id = v_my_id LIMIT 1;

  IF v_my_role NOT IN ('admin','sergeant') THEN RAISE EXCEPTION 'not_authorized'; END IF;

  DELETE FROM public.platoon_join_requests
  WHERE id = p_request_id AND platoon_id = v_platoon_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.deny_join_request(uuid) TO authenticated;


-- ── 4.14 go_awol ─────────────────────────────────────────────
-- Leave current platoon. Admin must transfer first if sole admin.
CREATE OR REPLACE FUNCTION public.go_awol()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id  uuid;
  v_platoon  uuid;
  v_role     text;
  v_admins   int;
BEGIN
  v_user_id := private_get_my_user_id();

  SELECT platoon_id, role INTO v_platoon, v_role
  FROM   public.platoon_members WHERE user_id = v_user_id LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;

  IF v_role = 'admin' THEN
    SELECT COUNT(*) INTO v_admins FROM public.platoon_members
    WHERE platoon_id = v_platoon AND role = 'admin';
    IF v_admins <= 1 THEN
      -- Check if there are other members who could take admin
      IF EXISTS (SELECT 1 FROM public.platoon_members
                 WHERE platoon_id = v_platoon AND user_id <> v_user_id LIMIT 1) THEN
        RAISE EXCEPTION 'must_transfer_admin';
      END IF;
      -- Sole admin, no other members — disband
      UPDATE public.users SET platoon_tag = NULL
      WHERE id IN (SELECT user_id FROM public.platoon_members WHERE platoon_id = v_platoon);
      DELETE FROM public.platoons WHERE id = v_platoon;
      RETURN;
    END IF;
  END IF;

  DELETE FROM public.platoon_members WHERE user_id = v_user_id AND platoon_id = v_platoon;
  UPDATE public.users SET platoon_tag = NULL WHERE id = v_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.go_awol() TO authenticated;


-- ── 4.15 kick_member ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kick_platoon_member(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id    uuid;
  v_my_role  text;
  v_platoon  uuid;
  v_tgt_role text;
BEGIN
  v_my_id := private_get_my_user_id();

  SELECT platoon_id, role INTO v_platoon, v_my_role
  FROM   public.platoon_members WHERE user_id = v_my_id LIMIT 1;

  IF v_my_role NOT IN ('admin','sergeant') THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT role INTO v_tgt_role FROM public.platoon_members
  WHERE user_id = p_target_user_id AND platoon_id = v_platoon;

  IF NOT FOUND THEN RAISE EXCEPTION 'target_not_in_platoon'; END IF;

  -- Sergeants can only kick members
  IF v_my_role = 'sergeant' AND v_tgt_role <> 'member' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  DELETE FROM public.platoon_members WHERE user_id = p_target_user_id AND platoon_id = v_platoon;
  UPDATE public.users SET platoon_tag = NULL WHERE id = p_target_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kick_platoon_member(uuid) TO authenticated;


-- ── 4.16 set_member_role ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_platoon_member_role(p_target_user_id uuid, p_new_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id  uuid;
  v_platoon uuid;
  v_my_role text;
BEGIN
  v_my_id := private_get_my_user_id();
  IF p_new_role NOT IN ('sergeant','member') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_target_user_id = v_my_id THEN RAISE EXCEPTION 'cannot_change_own_role'; END IF;

  SELECT platoon_id, role INTO v_platoon, v_my_role
  FROM   public.platoon_members WHERE user_id = v_my_id LIMIT 1;

  IF v_my_role <> 'admin' THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.platoon_members
  SET    role = p_new_role
  WHERE  user_id = p_target_user_id AND platoon_id = v_platoon;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_platoon_member_role(uuid, text) TO authenticated;


-- ── 4.17 transfer_admin ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_platoon_admin(p_new_admin_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id  uuid;
  v_platoon uuid;
  v_my_role text;
BEGIN
  v_my_id := private_get_my_user_id();
  IF p_new_admin_user_id = v_my_id THEN RAISE EXCEPTION 'invalid_target'; END IF;

  SELECT platoon_id, role INTO v_platoon, v_my_role
  FROM   public.platoon_members WHERE user_id = v_my_id LIMIT 1;

  IF v_my_role <> 'admin' THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platoon_members
                 WHERE user_id = p_new_admin_user_id AND platoon_id = v_platoon) THEN
    RAISE EXCEPTION 'target_not_in_platoon';
  END IF;

  UPDATE public.platoon_members SET role = 'admin'    WHERE user_id = p_new_admin_user_id AND platoon_id = v_platoon;
  UPDATE public.platoon_members SET role = 'sergeant' WHERE user_id = v_my_id             AND platoon_id = v_platoon;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_platoon_admin(uuid) TO authenticated;


-- ── 4.18 disband_platoon ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.disband_platoon()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platoon uuid;
  v_my_role text;
BEGIN
  SELECT platoon_id, role INTO v_platoon, v_my_role
  FROM   public.platoon_members WHERE user_id = private_get_my_user_id() LIMIT 1;

  IF v_my_role <> 'admin' THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Clear all member tags
  UPDATE public.users SET platoon_tag = NULL
  WHERE  id IN (SELECT user_id FROM public.platoon_members WHERE platoon_id = v_platoon);

  -- CASCADE handles members, join_requests, posts
  DELETE FROM public.platoons WHERE id = v_platoon;
END;
$$;
GRANT EXECUTE ON FUNCTION public.disband_platoon() TO authenticated;


-- ── 4.19 post_platoon_message ────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_platoon_message(p_platoon_id uuid, p_content text)
RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_id uuid;
  v_ts timestamptz;
BEGIN
  v_user_id := private_get_my_user_id();

  IF NOT EXISTS (
    SELECT 1 FROM public.platoon_members
    WHERE platoon_id = p_platoon_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'not_a_member'; END IF;

  INSERT INTO public.platoon_posts (platoon_id, user_id, content)
  VALUES (p_platoon_id, v_user_id, TRIM(p_content))
  RETURNING public.platoon_posts.id, public.platoon_posts.created_at INTO v_id, v_ts;

  RETURN QUERY SELECT v_id, v_ts;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_platoon_message(uuid, text) TO authenticated;


-- ── 4.20 delete_platoon_post ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_platoon_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_post    record;
  v_role    text;
BEGIN
  v_user_id := private_get_my_user_id();

  SELECT * INTO v_post FROM public.platoon_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found'; END IF;

  -- Own post?
  IF v_post.user_id = v_user_id THEN
    DELETE FROM public.platoon_posts WHERE id = p_post_id;
    RETURN;
  END IF;

  -- Admin/sergeant of the platoon?
  SELECT role INTO v_role FROM public.platoon_members
  WHERE user_id = v_user_id AND platoon_id = v_post.platoon_id;

  IF v_role IN ('admin','sergeant') THEN
    DELETE FROM public.platoon_posts WHERE id = p_post_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'not_authorized';
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_platoon_post(uuid) TO authenticated;


-- ── 4.21 update_platoon_settings ─────────────────────────────
CREATE OR REPLACE FUNCTION public.update_platoon_settings(
  p_name        text,
  p_description text,
  p_is_open     boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platoon uuid;
  v_role    text;
BEGIN
  SELECT platoon_id, role INTO v_platoon, v_role
  FROM   public.platoon_members WHERE user_id = private_get_my_user_id() LIMIT 1;

  IF v_role <> 'admin' THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.platoons
  SET name = TRIM(p_name), description = TRIM(p_description), is_open = p_is_open
  WHERE id = v_platoon;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_platoon_settings(text, text, boolean) TO authenticated;


-- ── 4.22 update_platoon_badge ────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_platoon_badge(p_badge_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platoon uuid;
  v_role    text;
BEGIN
  SELECT platoon_id, role INTO v_platoon, v_role
  FROM   public.platoon_members WHERE user_id = private_get_my_user_id() LIMIT 1;

  IF v_role <> 'admin' THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.platoons SET badge_url = p_badge_url WHERE id = v_platoon;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_platoon_badge(text) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- PART 5 — Update get_friend_profile to return access + platoon_tag
-- ────────────────────────────────────────────────────────────
-- Must DROP first because return type is changing (new columns).

DROP FUNCTION IF EXISTS public.get_friend_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_friend_profile(p_user_id uuid)
RETURNS TABLE (
  leaderboard_name text,
  real_name        text,
  avatar_url       text,
  hide_avatar      boolean,
  profession       text,
  home_base_city   text,
  home_base_state  text,
  phone_last4      text,
  email            text,
  motto            text,
  bio              text,
  total_runs       bigint,
  avg_score        numeric,
  best_run         numeric,
  access           text,
  platoon_tag      text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(u.leaderboard_name, u.name)   AS leaderboard_name,
    CASE WHEN COALESCE(u.hide_name, false) THEN NULL ELSE u.name END AS real_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)         AS hide_avatar,
    CASE WHEN COALESCE(u.hide_profession, false) THEN NULL ELSE u.profession END AS profession,
    CASE WHEN COALESCE(u.hide_home_base, false)  THEN NULL ELSE u.home_base_city  END AS home_base_city,
    CASE WHEN COALESCE(u.hide_home_base, false)  THEN NULL ELSE u.home_base_state END AS home_base_state,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE RIGHT(REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g'), 4)
    END AS phone_last4,
    CASE WHEN COALESCE(u.hide_email, false) THEN NULL ELSE u.email END AS email,
    CASE WHEN COALESCE(u.hide_motto, false) THEN NULL ELSE u.motto END AS motto,
    CASE WHEN COALESCE(u.hide_bio,   false) THEN NULL ELSE u.bio   END AS bio,
    (SELECT COUNT(*) FROM public.reservation_players rp WHERE rp.user_id = u.id)::bigint AS total_runs,
    (SELECT ROUND(AVG(sr.score)::numeric, 1)
     FROM   public.reservation_players rp
     JOIN   public.session_runs sr ON sr.reservation_id = rp.reservation_id
     WHERE  rp.user_id = u.id
       AND  (sr.team IS NULL OR sr.team = rp.team))                                 AS avg_score,
    (SELECT ROUND(MAX(sr.score)::numeric, 1)
     FROM   public.reservation_players rp
     JOIN   public.session_runs sr ON sr.reservation_id = rp.reservation_id
     WHERE  rp.user_id = u.id
       AND  (sr.team IS NULL OR sr.team = rp.team))                                 AS best_run,
    u.access,
    u.platoon_tag
  FROM public.users u
  WHERE u.id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_friend_profile(uuid) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- PART 6 — Rebuild leaderboard views to include platoon_tag
-- ────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_leaderboard_yearly_cumulative  CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_monthly_cumulative CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_weekly_cumulative  CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_cumulative         CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_yearly             CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_monthly            CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard_weekly             CASCADE;
DROP VIEW IF EXISTS public.v_leaderboard                    CASCADE;
DROP VIEW IF EXISTS public.v_player_sessions                CASCADE;
DROP VIEW IF EXISTS public.v_player_runs                    CASCADE;


CREATE OR REPLACE VIEW public.v_player_runs AS
SELECT
  rp.user_id        AS player_id,
  sr.id             AS run_id,
  sr.reservation_id,
  sr.run_number,
  sr.team,
  sr.role,
  rp.team           AS player_group,

  sr.score,

  CASE
    WHEN sr.role = 'hunter'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team = rp.team
    THEN CASE res.war_win_type
           WHEN 'SWEEP'    THEN 25.0
           WHEN 'TIEBREAK' THEN 15.0
           ELSE 0.0
         END
    ELSE 0.0
  END AS war_bonus,

  sr.score + CASE
    WHEN sr.role = 'hunter'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team = rp.team
    THEN CASE res.war_win_type
           WHEN 'SWEEP'    THEN 25.0
           WHEN 'TIEBREAK' THEN 15.0
           ELSE 0.0
         END
    ELSE 0.0
  END AS effective_score,

  CASE WHEN sr.role IS NULL OR sr.role = 'hunter' THEN sr.elapsed_seconds ELSE NULL END AS elapsed_seconds,
  sr.objective_complete,
  sr.targets_eliminated,
  sr.visual,
  sr.audio,
  sr.cranked,
  sr.live_op_difficulty,
  sr.winning_team,
  sr.created_at

FROM reservation_players rp
JOIN reservations res ON res.id = rp.reservation_id
JOIN session_runs sr
  ON  sr.reservation_id = rp.reservation_id
  AND (
        sr.team IS NULL
        OR (
          rp.team IS NOT NULL
          AND sr.team = rp.team
        )
      )
WHERE rp.user_id IS NOT NULL;


CREATE OR REPLACE VIEW public.v_player_sessions AS
SELECT
  vpr.player_id,
  vpr.reservation_id,
  vpr.player_group,
  res.date                                                AS session_date,
  rt.mode                                                 AS session_mode,
  SUM(vpr.effective_score)                                AS session_score,
  MAX(vpr.effective_score)                                AS best_run_score,
  MIN(CASE WHEN vpr.elapsed_seconds > 0
           THEN vpr.elapsed_seconds END)                  AS best_run_seconds,
  COUNT(*)                                                AS run_count,
  CASE
    WHEN rt.mode = 'versus'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team = vpr.player_group
    THEN 1 ELSE 0
  END AS is_versus_win,
  CASE
    WHEN rt.mode = 'versus'
      AND res.war_winner_team IS NOT NULL
      AND res.war_winner_team IS DISTINCT FROM vpr.player_group
      AND vpr.player_group IS NOT NULL
    THEN 1 ELSE 0
  END AS is_versus_loss,
  SUM(CASE WHEN vpr.elapsed_seconds > 0
           THEN vpr.elapsed_seconds ELSE 0 END)           AS total_elapsed,
  COUNT(CASE WHEN vpr.elapsed_seconds > 0
             THEN 1 END)                                  AS elapsed_count
FROM v_player_runs vpr
JOIN reservations res ON res.id = vpr.reservation_id
JOIN public.reservation_types rt ON rt.id = res.type_id
GROUP BY
  vpr.player_id, vpr.reservation_id, vpr.player_group,
  res.date, rt.mode, res.war_winner_team;


-- Helper macro: leaderboard CTE (all time avg)
CREATE OR REPLACE VIEW public.v_leaderboard AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_all_time
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_weekly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_weekly
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_monthly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_monthly
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_yearly AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score) / NULLIF(SUM(ps.run_count), 0) AS avg_score,
    MAX(ps.session_score)  AS best_session,
    SUM(ps.session_score)  AS total_score_all,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(avg_score::numeric, 1)       AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score_all::numeric, 1) AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY avg_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_yearly
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_all_time
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_weekly_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_weekly
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_monthly_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_monthly
FROM player_agg;


CREATE OR REPLACE VIEW public.v_leaderboard_yearly_cumulative AS
WITH player_agg AS (
  SELECT
    ps.player_id,
    COALESCE(u.leaderboard_name, u.name) AS player_name,
    u.platoon_tag,
    COUNT(*)               AS total_sessions,
    SUM(ps.session_score)  AS total_score,
    MAX(ps.session_score)  AS best_session,
    MAX(ps.best_run_score) AS best_run,
    SUM(ps.run_count)      AS total_run_count,
    MIN(ps.best_run_seconds)   AS best_seconds,
    SUM(ps.total_elapsed)::float / NULLIF(SUM(ps.elapsed_count), 0) AS avg_seconds_raw,
    SUM(ps.is_versus_win)      AS versus_wins,
    SUM(ps.is_versus_loss)     AS versus_losses
  FROM v_player_sessions ps
  JOIN public.users u ON u.id = ps.player_id
  WHERE u.is_real = true
    AND (u.hide_from_leaderboard IS NULL OR u.hide_from_leaderboard = false)
    AND ps.session_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY ps.player_id, u.leaderboard_name, u.name, u.platoon_tag
)
SELECT
  player_id, player_name, platoon_tag,
  ROUND(total_score::numeric, 1)     AS leaderboard_score,
  ROUND(best_session::numeric, 1)    AS best_session,
  ROUND(total_score::numeric, 1)     AS total_score_all,
  total_sessions::int                AS sessions_in_avg,
  total_sessions::int                AS total_sessions_played,
  total_run_count::int               AS runs_in_avg,
  total_run_count::int               AS total_runs,
  total_run_count::int               AS total_runs_played,
  best_run,
  ROUND(avg_seconds_raw)::int        AS avg_seconds,
  best_seconds::int                  AS best_seconds,
  versus_wins::int                   AS versus_wins,
  versus_losses::int                 AS versus_losses,
  RANK() OVER (ORDER BY total_score DESC NULLS LAST, avg_seconds_raw ASC NULLS LAST) AS rank_yearly
FROM player_agg;
