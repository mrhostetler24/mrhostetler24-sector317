-- ============================================================
-- Migration: 20260316011_structure_players
-- Version:   20260316011
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Adds a `players` JSONB column to structures so the tablet
--   can display team members with rank and platoon tag.
--   Updates activate_structure_run to accept and store player data.
--   Updates deactivate_structure to clear player data on close.
-- ============================================================

-- ── 1. Add players column ─────────────────────────────────────
ALTER TABLE public.structures
  ADD COLUMN IF NOT EXISTS players jsonb NOT NULL DEFAULT '[]'::jsonb;


-- ── 2. Rebuild activate_structure_run ────────────────────────
DROP FUNCTION IF EXISTS public.activate_structure_run(text, uuid, int, text, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.activate_structure_run(
  p_structure        text,
  p_reservation_id   uuid,
  p_run_number       int,
  p_visual           text  DEFAULT 'V',
  p_audio            text  DEFAULT 'T',
  p_mode             text  DEFAULT NULL,
  p_customer_names   jsonb DEFAULT '[]'::jsonb,
  p_objectives       jsonb DEFAULT '[]'::jsonb,
  p_players          jsonb DEFAULT '[]'::jsonb
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
         players               = p_players,
         objective_id          = NULL,
         difficulty            = 'NONE'
  WHERE  id = p_structure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown structure: %', p_structure;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_structure_run
  (text, uuid, int, text, text, text, jsonb, jsonb, jsonb)
  TO authenticated;


-- ── 3. Rebuild deactivate_structure ──────────────────────────
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
         players               = '[]'::jsonb,
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
