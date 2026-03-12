-- ============================================================
-- Migration: Denormalize platoon_badge_color onto users table
-- Version:   20260312008
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   1. Adds platoon_badge_color column to users table
--   2. Backfills existing members from their platoon's badge_color
--   3. Creates a trigger that auto-syncs badge_color whenever
--      platoon_tag changes (covers join/leave/kick/disband)
--   4. Updates update_platoon_badge_color RPC to cascade the
--      new color to all current members
-- ============================================================


-- ── 1. Add column ─────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS platoon_badge_color text;


-- ── 2. Backfill existing members ──────────────────────────────────────────────

UPDATE public.users u
SET    platoon_badge_color = pl.badge_color
FROM   public.platoons pl
WHERE  pl.tag = u.platoon_tag
  AND  u.platoon_badge_color IS NULL;


-- ── 3. Trigger: auto-sync badge_color when platoon_tag changes ────────────────

CREATE OR REPLACE FUNCTION public.sync_platoon_badge_color()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.platoon_tag IS DISTINCT FROM OLD.platoon_tag THEN
    IF NEW.platoon_tag IS NULL THEN
      NEW.platoon_badge_color := NULL;
    ELSE
      SELECT badge_color INTO NEW.platoon_badge_color
      FROM   public.platoons
      WHERE  tag = NEW.platoon_tag;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_platoon_badge_color ON public.users;
CREATE TRIGGER trg_sync_platoon_badge_color
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_platoon_badge_color();


-- ── 4. update_platoon_badge_color — cascade to members ───────────────────────
--
--   When admin changes the platoon color, push it to all member rows so
--   their cached platoon_badge_color stays current.

CREATE OR REPLACE FUNCTION public.update_platoon_badge_color(p_color text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id     uuid := private_get_my_user_id();
  v_platoon_id uuid;
  v_tag        text;
BEGIN
  SELECT platoon_id INTO v_platoon_id
  FROM   platoon_members
  WHERE  user_id = v_my_id AND role = 'admin';

  IF v_platoon_id IS NULL THEN
    RAISE EXCEPTION 'not admin';
  END IF;

  UPDATE platoons
  SET    badge_color = p_color
  WHERE  id = v_platoon_id
  RETURNING tag INTO v_tag;

  -- Cascade to all current members
  UPDATE public.users
  SET    platoon_badge_color = p_color
  WHERE  platoon_tag = v_tag;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_platoon_badge_color(text) TO authenticated;
