-- ============================================================
-- Migration: ensure social_links column + SECURITY DEFINER RPC
-- Version:   20260325002
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   social_links was never formally migrated.  If update_social_links
--   was created without SECURITY DEFINER, the RLS policy on users
--   blocks the UPDATE silently (0 rows, no error) so links appear
--   in-memory but vanish on page refresh.
-- ============================================================

-- 1. Ensure the column exists
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '[]'::jsonb;

-- 2. Recreate update_social_links as SECURITY DEFINER
DROP FUNCTION IF EXISTS public.update_social_links(jsonb);

CREATE FUNCTION public.update_social_links(p_links jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.users
  SET social_links = p_links
  WHERE auth_id = auth.uid()::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_social_links(jsonb) TO authenticated;
