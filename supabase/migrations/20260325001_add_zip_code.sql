-- ============================================================
-- Migration: add zip_code to users + update update_social_profile RPC
-- Version:   20260325001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   Stores the user's ZIP code so location data can be mapped.
--   ZIP is entered in the social profile editor and auto-resolved
--   to city/state via the zippopotam.us API on the client.
-- ============================================================

-- 1. Add column
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS zip_code text;

-- 2. Recreate update_social_profile to include zip_code
--    (drops old version regardless of existing signature)
-- Drop ALL overloads of update_social_profile dynamically
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname = 'update_social_profile'
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_social_profile(
  p_user_id          uuid,
  p_leaderboard_name text    DEFAULT NULL,
  p_avatar_url       text    DEFAULT NULL,
  p_motto            text    DEFAULT NULL,
  p_home_base_city   text    DEFAULT NULL,
  p_home_base_state  text    DEFAULT NULL,
  p_profession       text    DEFAULT NULL,
  p_bio              text    DEFAULT NULL,
  p_zip_code         text    DEFAULT NULL,
  p_hide_phone       boolean DEFAULT false,
  p_hide_email       boolean DEFAULT false,
  p_hide_name        boolean DEFAULT false,
  p_hide_avatar      boolean DEFAULT false,
  p_hide_motto       boolean DEFAULT false,
  p_hide_profession  boolean DEFAULT false,
  p_hide_home_base   boolean DEFAULT false,
  p_hide_bio         boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.users SET
    leaderboard_name = p_leaderboard_name,
    avatar_url       = p_avatar_url,
    motto            = p_motto,
    home_base_city   = p_home_base_city,
    home_base_state  = p_home_base_state,
    profession       = p_profession,
    bio              = p_bio,
    zip_code         = p_zip_code,
    hide_phone       = p_hide_phone,
    hide_email       = p_hide_email,
    hide_name        = p_hide_name,
    hide_avatar      = p_hide_avatar,
    hide_motto       = p_hide_motto,
    hide_profession  = p_hide_profession,
    hide_home_base   = p_hide_home_base,
    hide_bio         = p_hide_bio
  WHERE id = p_user_id
    AND (auth.uid()::text = auth_id OR auth.uid()::text IN (
      SELECT auth_id FROM public.users WHERE access IN ('staff','manager','admin')
    ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_social_profile TO authenticated;
