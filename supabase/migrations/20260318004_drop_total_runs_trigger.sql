-- ============================================================
-- Migration: Drop orphaned total_runs trigger on session_runs
-- Version:   20260318004
--
-- PROBLEM:
--   users.total_runs was dropped in 20260317002, but the trigger
--   function that incremented it on every session_runs INSERT was
--   not removed. Every call to createRun() now throws:
--     "column total_runs of relation users does not exist"
--
-- FIX:
--   Find every trigger on session_runs whose backing function body
--   references "total_runs" and drop it + its function.
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      t.tgname                            AS trigger_name,
      p.proname                           AS func_name,
      p.oid::regprocedure::text           AS func_sig
    FROM   pg_trigger      t
    JOIN   pg_class        c  ON c.oid = t.tgrelid
    JOIN   pg_namespace    ns ON ns.oid = c.relnamespace
    JOIN   pg_proc         p  ON p.oid = t.tgfoid
    WHERE  ns.nspname = 'public'
      AND  c.relname  = 'session_runs'
      AND  pg_get_functiondef(p.oid) ILIKE '%total_runs%'
  LOOP
    RAISE NOTICE 'Dropping trigger % and function %', r.trigger_name, r.func_sig;
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || ' ON public.session_runs';
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
END;
$$;
