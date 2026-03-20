-- Tighten platoon table grants.
-- All platoon mutations go through SECURITY DEFINER RPCs which handle
-- their own authorization. Direct table access should be SELECT-only
-- for authenticated users, and nothing for anon.

-- Revoke everything from anon
REVOKE ALL ON public.platoons              FROM anon;
REVOKE ALL ON public.platoon_members       FROM anon;
REVOKE ALL ON public.platoon_join_requests FROM anon;
REVOKE ALL ON public.platoon_posts         FROM anon;
REVOKE ALL ON public.platoon_invites       FROM anon;

-- Revoke write/admin privileges from authenticated (keep SELECT only)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platoons              FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platoon_members       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platoon_join_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platoon_posts         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platoon_invites       FROM authenticated;
