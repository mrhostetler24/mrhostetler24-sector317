-- ============================================================
-- Migration: 20260316009_structures_realtime
-- Version:   20260316009
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Enables Supabase Realtime on the structures table so that
--   postgres_changes subscriptions (tablet + scoring table) receive
--   full row payloads when the table is updated.
--
--   Without REPLICA IDENTITY FULL, only the primary key (id) is
--   included in the change payload — all other columns come back
--   as null/undefined, so applyRow() on the tablet has nothing to
--   apply and the UI never updates.
-- ============================================================

-- Send the full row (before + after) on every UPDATE/DELETE
ALTER TABLE public.structures REPLICA IDENTITY FULL;

-- Add to the Supabase Realtime publication so postgres_changes
-- events are broadcast to subscribers
ALTER PUBLICATION supabase_realtime ADD TABLE public.structures;
