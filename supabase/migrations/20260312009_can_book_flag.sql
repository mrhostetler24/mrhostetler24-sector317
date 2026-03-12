-- ============================================================
-- Migration: can_book flag on users
-- Version:   20260312009
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Adds can_book boolean column to users (DEFAULT false)
--   2. Sets ALL existing users to false
--   3. Updates admin_update_user RPC to accept p_can_book param
-- ============================================================


-- ── 1. Add column ─────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_book boolean NOT NULL DEFAULT false;


-- ── 2. Set all existing users to false ────────────────────────────────────────

UPDATE public.users SET can_book = false;


-- ── 3. Update admin_update_user RPC to support can_book ───────────────────────
--
--   Drop and recreate with optional p_can_book param.
--   All existing callers continue to work (param is optional).

DROP FUNCTION IF EXISTS public.admin_update_user(uuid,text,text,text,text,boolean);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid,text,text,text,text,boolean,text,boolean);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid,text,text,text,text,boolean,text,boolean,boolean);

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id              uuid,
  p_name                 text    DEFAULT NULL,
  p_phone                text    DEFAULT NULL,
  p_access               text    DEFAULT NULL,
  p_role                 text    DEFAULT NULL,
  p_active               boolean DEFAULT NULL,
  p_leaderboard_name     text    DEFAULT NULL,
  p_hide_from_leaderboard boolean DEFAULT NULL,
  p_can_book             boolean DEFAULT NULL
)
RETURNS SETOF public.users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.users
  SET
    name                  = COALESCE(p_name,                 name),
    phone                 = COALESCE(p_phone,                phone),
    access                = COALESCE(p_access,               access),
    role                  = COALESCE(p_role,                 role),
    active                = COALESCE(p_active,               active),
    leaderboard_name      = CASE WHEN p_leaderboard_name      IS NOT NULL THEN p_leaderboard_name      ELSE leaderboard_name      END,
    hide_from_leaderboard = CASE WHEN p_hide_from_leaderboard IS NOT NULL THEN p_hide_from_leaderboard ELSE hide_from_leaderboard END,
    can_book              = CASE WHEN p_can_book              IS NOT NULL THEN p_can_book              ELSE can_book              END
  WHERE id = p_user_id;

  RETURN QUERY SELECT * FROM public.users WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid,text,text,text,text,boolean,text,boolean,boolean) TO authenticated;
