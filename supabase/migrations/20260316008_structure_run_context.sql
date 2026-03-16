-- ============================================================
-- Migration: 20260316008_structure_run_context
-- Version:   20260316008
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Extends the structures table and its RPCs so that:
--     1. The scoring table can push the full run context
--        (mode, objectives list, customer names) to each tablet
--        when a scoring session opens.
--     2. The tablet shows an idle/standby screen until activated.
--     3. Customer selections (objective, difficulty, visual, audio)
--        are written to the structures table and picked up by the
--        scoring modal via Realtime — true bidirectional sync.
--
--   Changes:
--     • Adds columns: active, mode, customer_names, objectives,
--       objective_id, difficulty
--     • Rebuilds activate_structure_run — new signature adds the
--       context columns, sets active=true, resets customer picks
--     • Rebuilds set_structure_environment — now also accepts
--       p_objective_id and p_difficulty so both the tablet and
--       scoring table can write all customer-selectable fields
--     • Adds deactivate_structure — called by scoring table on
--       modal close/commit, sets active=false and clears context
-- ============================================================

-- ── 1. Add new columns ───────────────────────────────────────
ALTER TABLE public.structures
  ADD COLUMN IF NOT EXISTS active         boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode           text        CHECK (mode IN ('coop','versus')),
  ADD COLUMN IF NOT EXISTS customer_names jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS objectives     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS objective_id   uuid,
  ADD COLUMN IF NOT EXISTS difficulty     text        NOT NULL DEFAULT 'NONE';


-- ── 2. Rebuild activate_structure_run ───────────────────────
-- Called by OpsView when a scoring session opens or when
-- "Log Run 1 → Run 2" fires.  Sets active=true and pushes
-- the full run context so the tablet knows what to show.
-- Resets objective_id/difficulty so the customer starts fresh.
DROP FUNCTION IF EXISTS public.activate_structure_run(text, uuid, int, text, text);

CREATE OR REPLACE FUNCTION public.activate_structure_run(
  p_structure        text,
  p_reservation_id   uuid,
  p_run_number       int,
  p_visual           text  DEFAULT 'V',
  p_audio            text  DEFAULT 'T',
  p_mode             text  DEFAULT NULL,
  p_customer_names   jsonb DEFAULT '[]'::jsonb,
  p_objectives       jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.structures
  SET    active_reservation_id = p_reservation_id,
         active_run_number     = p_run_number,
         visual                = p_visual,
         audio                 = p_audio,
         updated_at            = now(),
         updated_by            = 'scoring',
         active                = true,
         mode                  = p_mode,
         customer_names        = p_customer_names,
         objectives            = p_objectives,
         objective_id          = NULL,   -- customer picks fresh each run
         difficulty            = 'NONE'  -- reset for each run
  WHERE  id = p_structure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown structure: %', p_structure;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_structure_run
  (text, uuid, int, text, text, text, jsonb, jsonb)
  TO authenticated;


-- ── 3. Rebuild set_structure_environment ────────────────────
-- Now accepts objective_id and difficulty so the tablet (and
-- the scoring table's env controls) write ALL customer-selectable
-- fields in one call.  p_objective_id NULL means "clear selection".
DROP FUNCTION IF EXISTS public.set_structure_environment(text, text, text, text);

CREATE OR REPLACE FUNCTION public.set_structure_environment(
  p_structure    text,
  p_visual       text,
  p_audio        text,
  p_source       text  DEFAULT 'tablet',
  p_objective_id uuid  DEFAULT NULL,
  p_difficulty   text  DEFAULT 'NONE'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_visual NOT IN ('V','C','S','B','R') THEN
    RAISE EXCEPTION 'Invalid visual code: %', p_visual;
  END IF;
  IF p_audio NOT IN ('T','C','O') THEN
    RAISE EXCEPTION 'Invalid audio code: %', p_audio;
  END IF;

  UPDATE public.structures
  SET    visual       = p_visual,
         audio        = p_audio,
         objective_id = p_objective_id,
         difficulty   = p_difficulty,
         updated_at   = now(),
         updated_by   = p_source
  WHERE  id = p_structure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown structure: %', p_structure;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_structure_environment
  (text, text, text, text, uuid, text)
  TO authenticated;


-- ── 4. deactivate_structure ──────────────────────────────────
-- Called by OpsView when the scoring modal closes or scores are
-- committed.  Shows the idle/standby screen on the tablet.
CREATE OR REPLACE FUNCTION public.deactivate_structure(p_structure text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.structures
  SET    active                = false,
         active_reservation_id = NULL,
         active_run_number     = 1,
         mode                  = NULL,
         customer_names        = '[]'::jsonb,
         objectives            = '[]'::jsonb,
         objective_id          = NULL,
         difficulty            = 'NONE',
         updated_at            = now(),
         updated_by            = 'scoring'
  WHERE  id = p_structure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown structure: %', p_structure;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_structure(text) TO authenticated;
