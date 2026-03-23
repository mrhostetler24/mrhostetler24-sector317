-- Migration: 20260321001_unlink_social_auth
-- Allows a customer to remove their social (OAuth) auth link.
-- Clears auth_id and email so a re-login via OAuth triggers CompleteProfile,
-- letting them reclaim the account by phone or start fresh.
-- Account data (reservations, history, etc.) is fully preserved.
-- Staff/manager/admin accounts are blocked from this operation.

CREATE OR REPLACE FUNCTION public.unlink_social_auth()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_access  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, access INTO v_user_id, v_access
  FROM public.users
  WHERE auth_id = auth.uid()::text;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_access IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'Staff accounts cannot be deleted.';
  END IF;

  -- Clear the social auth link so re-login prompts account setup
  UPDATE public.users
  SET auth_id       = NULL,
      email         = NULL,
      auth_provider = 'phone'
  WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlink_social_auth() TO authenticated;
