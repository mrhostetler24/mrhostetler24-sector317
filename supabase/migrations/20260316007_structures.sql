-- ============================================================
-- Migration: 20260316007_structures
-- Version:   20260316007
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Creates the structures table — live state for Alpha and Bravo.
--   Both the structure tablet and scoring table read/write here.
--   The lighting bridge subscribes to this table via Realtime.
--
--   1. structures table — current visual/audio per structure
--   2. set_structure_environment RPC — write from tablet or scoring table
--   3. activate_structure_run RPC — called by scoring table when session
--      loads or when "Log Run 1 → Run 2" flip fires
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1 — structures table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.structures (
  id                    text        PRIMARY KEY CHECK (id IN ('Alpha', 'Bravo')),
  active_reservation_id uuid        REFERENCES public.reservations(id) ON DELETE SET NULL,
  active_run_number     int         NOT NULL DEFAULT 1 CHECK (active_run_number IN (1, 2)),
  visual                text        NOT NULL DEFAULT 'V' CHECK (visual IN ('V','C','S','B','R')),
  audio                 text        NOT NULL DEFAULT 'T' CHECK (audio IN ('T','C','O')),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text        -- 'tablet' | 'scoring'
);

-- Seed both structures so the rows always exist
INSERT INTO public.structures (id) VALUES ('Alpha'), ('Bravo')
  ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (tablet + scoring table + bridge)
CREATE POLICY "structures_select"
  ON public.structures FOR SELECT
  TO authenticated USING (true);

-- No direct writes — all mutations go through SECURITY DEFINER RPCs below


-- ────────────────────────────────────────────────────────────
-- PART 2 — set_structure_environment
-- Called by the structure tablet (or scoring table) to update
-- the current visual + audio selection for a structure.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_structure_environment(
  p_structure text,
  p_visual    text,
  p_audio     text,
  p_source    text DEFAULT 'tablet'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_visual NOT IN ('V','C','S','B','R') THEN
    RAISE EXCEPTION 'Invalid visual code: %', p_visual;
  END IF;
  IF p_audio NOT IN ('T','C','O') THEN
    RAISE EXCEPTION 'Invalid audio code: %', p_audio;
  END IF;

  UPDATE public.structures
  SET    visual     = p_visual,
         audio      = p_audio,
         updated_at = now(),
         updated_by = p_source
  WHERE  id = p_structure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown structure: %', p_structure;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_structure_environment TO authenticated;


-- ────────────────────────────────────────────────────────────
-- PART 3 — activate_structure_run
-- Called by OpsView when a scoring session loads or when
-- "Log Run 1 → Run 2" fires. Sets which reservation + run
-- number is active on each structure and resets to defaults.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.activate_structure_run(
  p_structure           text,
  p_reservation_id      uuid,
  p_run_number          int,
  p_visual              text DEFAULT 'V',
  p_audio               text DEFAULT 'T'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.structures
  SET    active_reservation_id = p_reservation_id,
         active_run_number     = p_run_number,
         visual                = p_visual,
         audio                 = p_audio,
         updated_at            = now(),
         updated_by            = 'scoring'
  WHERE  id = p_structure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown structure: %', p_structure;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_structure_run TO authenticated;
