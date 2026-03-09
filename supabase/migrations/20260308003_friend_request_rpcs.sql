-- Secure read RPCs for friend_requests so RLS cannot silently block them.
-- Mirrors the pattern used by other SECURITY DEFINER RPCs in this project.

-- Returns pending incoming friend requests for a given user (by public.users.id)
CREATE OR REPLACE FUNCTION public.get_pending_friend_requests(p_for_user uuid)
RETURNS TABLE (id uuid, from_user_id uuid, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, from_user_id, created_at
  FROM   public.friend_requests
  WHERE  to_user_id = p_for_user
  ORDER  BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_pending_friend_requests(uuid) TO authenticated;

-- Returns outgoing friend requests sent by a given user (by public.users.id)
CREATE OR REPLACE FUNCTION public.get_sent_friend_requests(p_for_user uuid)
RETURNS TABLE (id uuid, to_user_id uuid, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, to_user_id, created_at
  FROM   public.friend_requests
  WHERE  from_user_id = p_for_user
  ORDER  BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_sent_friend_requests(uuid) TO authenticated;
