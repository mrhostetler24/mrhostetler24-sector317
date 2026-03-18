-- ============================================================
-- Migration: update_structure_players RPC
-- Version:   20260318003
--
-- Lightweight RPC that updates only the players column on a
-- structure row. Used when an instructor reassigns a player
-- between teams on the scoring table — avoids the full
-- activate_structure_run cycle which would reset objective_id
-- and difficulty (wiping the customer's in-progress selections).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_structure_players(
  p_structure  text,
  p_players    jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.structures
  SET players    = p_players,
      updated_at = now(),
      updated_by = 'scoring'
  WHERE id = p_structure;
$$;

GRANT EXECUTE ON FUNCTION public.update_structure_players(text, jsonb) TO authenticated;
