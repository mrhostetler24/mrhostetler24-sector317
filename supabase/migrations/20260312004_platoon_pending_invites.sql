-- ============================================================
-- Migration: Platoon Pending Invites (member tab view)
-- Version:   20260312004
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. get_platoon_pending_invites() — returns all pending outgoing
--      invites for the caller's platoon (any member can view)
--   2. Updates cancel_platoon_invite to also allow admin/sergeant
--      of the platoon to cancel any invite (not just the sender)
-- ============================================================


-- ── 1. get_platoon_pending_invites ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_platoon_pending_invites()
RETURNS TABLE (
  id                    uuid,
  to_user_id            uuid,
  to_leaderboard_name   text,
  from_user_id          uuid,
  from_leaderboard_name text,
  created_at            timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pi.id,
    pi.to_user_id,
    COALESCE(tu.leaderboard_name, tu.name) AS to_leaderboard_name,
    pi.from_user_id,
    COALESCE(fu.leaderboard_name, fu.name) AS from_leaderboard_name,
    pi.created_at
  FROM platoon_invites pi
  JOIN users tu ON tu.id = pi.to_user_id
  JOIN users fu ON fu.id = pi.from_user_id
  WHERE pi.platoon_id = (
    SELECT platoon_id FROM platoon_members
    WHERE user_id = private_get_my_user_id() LIMIT 1
  )
  ORDER BY pi.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_platoon_pending_invites() TO authenticated;


-- ── 2. cancel_platoon_invite — allow admin/sergeant to also cancel ────────

CREATE OR REPLACE FUNCTION public.cancel_platoon_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id   uuid := private_get_my_user_id();
  v_role    text;
BEGIN
  SELECT role INTO v_role FROM platoon_members WHERE user_id = v_my_id LIMIT 1;

  DELETE FROM public.platoon_invites
  WHERE id = p_invite_id
    AND (
      from_user_id = v_my_id
      OR v_role IN ('admin', 'sergeant')
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_platoon_invite(uuid) TO authenticated;
