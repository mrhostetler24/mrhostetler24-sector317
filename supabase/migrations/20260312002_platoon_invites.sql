-- ============================================================
-- Migration: Platoon Invite System
-- Version:   20260312002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Creates platoon_invites table
--   2. SECURITY DEFINER RPCs for send/cancel/accept/decline invite
--   3. search_invitable_players RPC (name or phone, excludes existing
--      platoon members and already-invited users)
--   4. get_my_platoon_invites RPC for the invitee's inbox
--
-- SAFE TO RE-RUN: DROP IF EXISTS + CREATE OR REPLACE throughout.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 1 — Table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platoon_invites (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  platoon_id   uuid        NOT NULL REFERENCES public.platoons(id)  ON DELETE CASCADE,
  from_user_id uuid        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  to_user_id   uuid        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (platoon_id, to_user_id)
);

-- ────────────────────────────────────────────────────────────
-- PART 2 — RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.platoon_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_select" ON public.platoon_invites;
DROP POLICY IF EXISTS "invites_insert" ON public.platoon_invites;
DROP POLICY IF EXISTS "invites_delete" ON public.platoon_invites;

-- No TO clause = applies to PUBLIC (all roles), covering SECURITY DEFINER
-- functions that run as 'postgres'. Authorization lives inside the RPCs.
CREATE POLICY "invites_select" ON public.platoon_invites FOR SELECT USING (true);
CREATE POLICY "invites_insert" ON public.platoon_invites FOR INSERT WITH CHECK (true);
CREATE POLICY "invites_delete" ON public.platoon_invites FOR DELETE USING (true);


-- ────────────────────────────────────────────────────────────
-- PART 3 — RPCs
-- ────────────────────────────────────────────────────────────

-- Search players who can be invited:
--   • Not already in any platoon (platoon_tag IS NULL)
--   • Not already invited to this platoon
--   • Not already a member of this platoon
--   • Name or full phone number matches the query
CREATE OR REPLACE FUNCTION public.search_invitable_players(p_platoon_id uuid, p_query text)
RETURNS TABLE (
  id              uuid,
  leaderboard_name text,
  phone_last4     text,
  avatar_url      text,
  hide_avatar     boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id,
         u.leaderboard_name,
         CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
              ELSE RIGHT(REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g'), 4)
         END AS phone_last4,
         u.avatar_url,
         u.hide_avatar
  FROM   public.users u
  WHERE  u.platoon_tag IS NULL
    AND  u.access != 'kiosk'
    AND  NOT EXISTS (
           SELECT 1 FROM public.platoon_invites pi
           WHERE  pi.platoon_id = p_platoon_id
             AND  pi.to_user_id = u.id
         )
    AND  NOT EXISTS (
           SELECT 1 FROM public.platoon_members pm
           WHERE  pm.platoon_id = p_platoon_id
             AND  pm.user_id = u.id
         )
    AND  (
           u.leaderboard_name ILIKE '%' || p_query || '%'
        OR u.phone            ILIKE '%' || p_query || '%'
         )
  ORDER  BY u.leaderboard_name
  LIMIT  20;
$$;
GRANT EXECUTE ON FUNCTION public.search_invitable_players(uuid, text) TO authenticated;

-- Send an invite (any platoon member can invite)
CREATE OR REPLACE FUNCTION public.invite_to_platoon(p_to_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id      uuid := private_get_my_user_id();
  v_platoon_id uuid;
  v_invite_id  uuid;
BEGIN
  -- Caller must be a platoon member
  SELECT platoon_id INTO v_platoon_id
  FROM   public.platoon_members
  WHERE  user_id = v_my_id;

  IF v_platoon_id IS NULL THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  -- Target must not already be in a platoon
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = p_to_user_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
  END IF;

  -- Insert; ignore duplicate (idempotent)
  INSERT INTO public.platoon_invites (platoon_id, from_user_id, to_user_id)
  VALUES (v_platoon_id, v_my_id, p_to_user_id)
  ON CONFLICT (platoon_id, to_user_id) DO NOTHING
  RETURNING public.platoon_invites.id INTO v_invite_id;

  RETURN v_invite_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.invite_to_platoon(uuid) TO authenticated;

-- Cancel an outgoing invite (inviter only)
CREATE OR REPLACE FUNCTION public.cancel_platoon_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id uuid := private_get_my_user_id();
BEGIN
  DELETE FROM public.platoon_invites
  WHERE  id = p_invite_id
    AND  from_user_id = v_my_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_platoon_invite(uuid) TO authenticated;

-- Invitee: list all pending invites addressed to them
CREATE OR REPLACE FUNCTION public.get_my_platoon_invites()
RETURNS TABLE (
  id                    uuid,
  platoon_id            uuid,
  platoon_tag           text,
  platoon_name          text,
  platoon_badge_url     text,
  from_leaderboard_name text,
  created_at            timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT pi.id,
         pi.platoon_id,
         p.tag,
         p.name,
         p.badge_url,
         u.leaderboard_name AS from_leaderboard_name,
         pi.created_at
  FROM   public.platoon_invites pi
  JOIN   public.platoons         p ON p.id = pi.platoon_id
  JOIN   public.users            u ON u.id = pi.from_user_id
  WHERE  pi.to_user_id = private_get_my_user_id()
  ORDER  BY pi.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_platoon_invites() TO authenticated;

-- Accept an invite — joins the platoon as a member
CREATE OR REPLACE FUNCTION public.accept_platoon_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id      uuid := private_get_my_user_id();
  v_platoon_id uuid;
  v_tag        text;
BEGIN
  -- Verify invite is addressed to the caller
  SELECT platoon_id INTO v_platoon_id
  FROM   public.platoon_invites
  WHERE  id = p_invite_id
    AND  to_user_id = v_my_id;

  IF v_platoon_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  -- Cannot already be in a platoon
  IF EXISTS (SELECT 1 FROM public.platoon_members WHERE user_id = v_my_id) THEN
    RAISE EXCEPTION 'already_in_platoon';
  END IF;

  SELECT tag INTO v_tag FROM public.platoons WHERE id = v_platoon_id;

  -- Join as member
  INSERT INTO public.platoon_members (platoon_id, user_id, role)
  VALUES (v_platoon_id, v_my_id, 'member');

  -- Stamp denormalized tag
  UPDATE public.users SET platoon_tag = v_tag WHERE id = v_my_id;

  -- Clean up all invites for this user (they can only be in one platoon)
  DELETE FROM public.platoon_invites WHERE to_user_id = v_my_id;

  -- Clean up any pending join requests
  DELETE FROM public.platoon_join_requests WHERE user_id = v_my_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_platoon_invite(uuid) TO authenticated;

-- Decline an invite
CREATE OR REPLACE FUNCTION public.decline_platoon_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id uuid := private_get_my_user_id();
BEGIN
  DELETE FROM public.platoon_invites
  WHERE  id = p_invite_id
    AND  to_user_id = v_my_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decline_platoon_invite(uuid) TO authenticated;
