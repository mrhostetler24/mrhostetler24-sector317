-- ============================================================
-- Migration: Signed Waivers — permanent record table
-- Version:   20260314005
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Creates signed_waivers table — one row per signing event,
--      including a full snapshot of the waiver body and document
--      metadata at the moment of signing.
--
--      ON DELETE SET NULL on both FKs means the signed record is
--      never destroyed when a user account or waiver doc is deleted.
--
--   2. Replaces kiosk_sign_waiver — now also writes to signed_waivers
--      so every future signing creates a permanent archived record.
--
--   3. get_my_signed_waiver(p_waiver_doc_id) — authenticated users
--      can fetch their own most-recent signed waiver record (with
--      body snapshot) to display a printable legal copy.
--
--   4. deactivate_user(p_id) — safe soft-delete RPC: only sets
--      active=false. The row, waivers, leaderboard entries, payments,
--      and reservation history are ALL preserved.
-- ============================================================

-- ── 1. signed_waivers table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signed_waivers (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Both FKs use SET NULL so the record survives account deletion
  user_id             uuid        REFERENCES public.users(id)        ON DELETE SET NULL,
  waiver_doc_id       uuid        REFERENCES public.waiver_docs(id)  ON DELETE SET NULL,
  -- Snapshots captured at time of signing (document may change later)
  user_name           text,
  waiver_doc_name     text        NOT NULL,
  waiver_doc_version  text        NOT NULL,
  waiver_body         text        NOT NULL,
  -- The legal signature
  signed_name         text        NOT NULL,
  signed_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Users can only read their own signed waivers via this policy.
-- Staff/admin access is via SECURITY DEFINER RPCs below.
ALTER TABLE public.signed_waivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed_waivers_own_select"
  ON public.signed_waivers FOR SELECT TO authenticated
  USING (user_id = private_get_my_user_id());

-- ── 2. kiosk_sign_waiver (updated) ───────────────────────────────
-- Drops and recreates so it also inserts into signed_waivers.
DROP FUNCTION IF EXISTS public.kiosk_sign_waiver(uuid, text, uuid);

CREATE FUNCTION public.kiosk_sign_waiver(
  p_user_id       uuid,
  p_signed_name   text,
  p_waiver_doc_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc         waiver_docs%ROWTYPE;
  v_user_name   text;
  v_ts          timestamptz := now();
  v_entry       jsonb;
BEGIN
  -- Resolve waiver doc: use specified id, else fall back to active doc
  IF p_waiver_doc_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.waiver_docs WHERE id = p_waiver_doc_id;
  END IF;
  IF v_doc.id IS NULL THEN
    SELECT * INTO v_doc
    FROM   public.waiver_docs
    WHERE  active = true
    ORDER  BY created_at DESC
    LIMIT  1;
  END IF;

  -- Snapshot user name (preserved even if account is later deactivated)
  SELECT name INTO v_user_name FROM public.users WHERE id = p_user_id;

  -- Build the JSONB entry for the legacy users.waivers array
  v_entry := jsonb_build_object(
    'signedAt',    to_char(v_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'signedName',  p_signed_name,
    'waiverDocId', v_doc.id
  );

  -- Update users.waivers JSONB + clear any rewaiver requirement
  UPDATE public.users
  SET    waivers               = COALESCE(waivers, '[]'::jsonb) || jsonb_build_array(v_entry),
         needs_rewaiver_doc_id = NULL
  WHERE  id = p_user_id;

  -- Permanent archival record with full body snapshot
  IF v_doc.id IS NOT NULL THEN
    INSERT INTO public.signed_waivers (
      user_id,        user_name,
      waiver_doc_id,  waiver_doc_name, waiver_doc_version, waiver_body,
      signed_name,    signed_at
    ) VALUES (
      p_user_id,      v_user_name,
      v_doc.id,       v_doc.name,      v_doc.version,      v_doc.body,
      p_signed_name,  v_ts
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kiosk_sign_waiver(uuid, text, uuid) TO authenticated, anon;

-- ── 3. get_my_signed_waiver ───────────────────────────────────────
-- Returns the calling user's most-recent signed waiver record,
-- optionally filtered to a specific waiver doc.
-- The returned waiver_body is the snapshot captured at signing time,
-- not the current (possibly updated) document body.
DROP FUNCTION IF EXISTS public.get_my_signed_waiver(uuid);

CREATE FUNCTION public.get_my_signed_waiver(
  p_waiver_doc_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  waiver_doc_id       uuid,
  waiver_doc_name     text,
  waiver_doc_version  text,
  waiver_body         text,
  signed_name         text,
  signed_at           timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sw.id,
    sw.waiver_doc_id,
    sw.waiver_doc_name,
    sw.waiver_doc_version,
    sw.waiver_body,
    sw.signed_name,
    sw.signed_at
  FROM   public.signed_waivers sw
  WHERE  sw.user_id = private_get_my_user_id()
    AND  (p_waiver_doc_id IS NULL OR sw.waiver_doc_id = p_waiver_doc_id)
  ORDER  BY sw.signed_at DESC
  LIMIT  1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_signed_waiver(uuid) TO authenticated;

-- ── 4. deactivate_user (safe soft-delete) ────────────────────────
-- Sets active=false only. The user row, all signed waivers,
-- payments, reservations, leaderboard entries, and platoon history
-- are fully preserved. Call this instead of deleting the row.
DROP FUNCTION IF EXISTS public.deactivate_user(uuid);

CREATE FUNCTION public.deactivate_user(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_access text;
BEGIN
  SELECT access INTO v_caller_access
  FROM   public.users
  WHERE  id = private_get_my_user_id();

  IF v_caller_access NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'Permission denied — staff or higher required';
  END IF;

  UPDATE public.users
  SET    active = false
  WHERE  id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_user(uuid) TO authenticated;
