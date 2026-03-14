-- ============================================================
-- Migration: Add UNIQUE constraint on users.phone
-- Version:   20260314001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   Security Gap 2 from 2026-03-14 auth audit.
--   Without a DB-level constraint, duplicate phone records can
--   exist (e.g., two guest rows created before a user fills in
--   their profile). The application-level fetchUserByPhone()
--   returns an arbitrary first match when duplicates exist,
--   which could confuse the account-linking flow.
--
--   Gap 1 (code guard in handleCompleteProfile) was already
--   applied — this migration adds the DB-level backstop.
--
-- NOTE:
--   This is a PARTIAL unique index (WHERE phone IS NOT NULL)
--   so that multiple users with no phone number on file don't
--   conflict with each other.
--
--   Before running, verify there are no existing duplicate
--   phone numbers with the query below. If duplicates exist
--   they must be resolved first.
--
--   Duplicate check:
--     SELECT REGEXP_REPLACE(phone,'[^0-9]','','g') AS digits,
--            COUNT(*) AS cnt
--     FROM   public.users
--     WHERE  phone IS NOT NULL AND phone <> ''
--     GROUP BY 1
--     HAVING COUNT(*) > 1;
-- ============================================================

-- Normalize: strip any all-whitespace phone values to NULL
-- so they don't block the constraint.
UPDATE public.users
SET    phone = NULL
WHERE  phone IS NOT NULL
  AND  TRIM(phone) = '';

-- Add partial unique index (NULL values are excluded).
-- This lets many users have phone=NULL while enforcing
-- uniqueness among users who have provided a number.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON public.users (REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
  WHERE phone IS NOT NULL AND TRIM(phone) <> '';
