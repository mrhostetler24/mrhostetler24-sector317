-- ============================================================
-- Sector 317 — Daily Test Data Seed
-- ============================================================
-- PURPOSE:
--   Populates today's schedule with realistic test reservations
--   (~65-70% of available lane-slots filled).  Run from the
--   Supabase SQL Editor any day you want fresh test data.
--   Safe to run only on days with no existing reservations —
--   the script aborts if any reservations for today already exist.
--
-- RESERVATION MIX:
--   • Open-play coop  : 1-3 players per group, 2-3 groups per lane
--   • Open-play versus: 4-6 players per group, 1-2 groups per lane
--   • Private coop    : 4-6 players (near-full lane)
--   • Private versus  : 8-12 players (near-full lane)
--
-- REQUIREMENTS:
--   • Active entries in reservation_types (mode, style columns)
--   • Active session_templates for today's day-of-week
--   • At least a handful of users with access='customer'
-- ============================================================

DO $$
DECLARE
  -- ── Today ────────────────────────────────────────────────────────────────────
  v_today  date := CURRENT_DATE;
  v_dow    text := TO_CHAR(CURRENT_DATE, 'FMDay');  -- e.g. 'Monday'

  -- ── Type ID buckets (populated from reservation_types) ───────────────────────
  v_oc_ids  text[];   -- open   + coop
  v_ov_ids  text[];   -- open   + versus
  v_pc_ids  text[];   -- private + coop
  v_pv_ids  text[];   -- private + versus
  v_have_oc bool := false;
  v_have_ov bool := false;
  v_have_pc bool := false;
  v_have_pv bool := false;

  -- ── Weight helpers ────────────────────────────────────────────────────────────
  v_w_oc    float;
  v_w_ov    float;
  v_w_pc    float;
  v_w_pv    float;
  v_w_total float;
  v_roll    float;
  v_bucket  text;

  -- ── Slot iteration ────────────────────────────────────────────────────────────
  v_tmpl    record;
  v_lane_i  int;

  -- ── Per-reservation state ─────────────────────────────────────────────────────
  v_res_id     uuid;
  v_type_id    text;
  v_mode       text;
  v_style      text;
  v_price      numeric;
  v_groups        int;    -- how many separate bookings share this open-play lane
  v_gi            int;    -- group index (1-based)
  v_gsize         int;    -- players in this specific booking
  v_group_team    smallint;  -- team for open-play versus groups
  v_lane_capacity int;    -- max players allowed in this open-play lane (6 coop / 12 versus)
  v_lane_used     int;    -- running player count for the current lane

  -- ── Per-player state ──────────────────────────────────────────────────────────
  v_pi         int;
  v_pname      text;
  v_team       smallint;
  v_booker_id  uuid;
  v_booker_nm  text;
  v_player_id  uuid;
  v_player_nm  text;

  -- ── Summary counters ─────────────────────────────────────────────────────────
  v_lanes_total  int := 0;
  v_lanes_filled int := 0;
  v_res_total    int := 0;

  -- ── Random array-pick helper (1-based) ───────────────────────────────────────
  v_alen int;

BEGIN
  RAISE NOTICE '── Sector 317 daily seed: % (%) ──', v_today, v_dow;

  -- ── 0. Safety check — abort if today already has reservations ───────────────
  IF EXISTS (SELECT 1 FROM public.reservations WHERE date = v_today LIMIT 1) THEN
    RAISE EXCEPTION 'Reservations already exist for %. Aborting to prevent data loss.', v_today;
  END IF;

  -- ── 1. Collect type IDs by category ──────────────────────────────────────────
  SELECT ARRAY_AGG(id ORDER BY random()) INTO v_oc_ids
  FROM public.reservation_types WHERE active = true AND style = 'open' AND mode = 'coop';

  SELECT ARRAY_AGG(id ORDER BY random()) INTO v_ov_ids
  FROM public.reservation_types WHERE active = true AND style = 'open' AND mode = 'versus';

  SELECT ARRAY_AGG(id ORDER BY random()) INTO v_pc_ids
  FROM public.reservation_types WHERE active = true AND style = 'private' AND mode = 'coop';

  SELECT ARRAY_AGG(id ORDER BY random()) INTO v_pv_ids
  FROM public.reservation_types WHERE active = true AND style = 'private' AND mode = 'versus';

  v_have_oc := (v_oc_ids IS NOT NULL AND array_length(v_oc_ids, 1) > 0);
  v_have_ov := (v_ov_ids IS NOT NULL AND array_length(v_ov_ids, 1) > 0);
  v_have_pc := (v_pc_ids IS NOT NULL AND array_length(v_pc_ids, 1) > 0);
  v_have_pv := (v_pv_ids IS NOT NULL AND array_length(v_pv_ids, 1) > 0);

  RAISE NOTICE 'Types found — OC:%  OV:%  PC:%  PV:%',
    COALESCE(array_length(v_oc_ids,1),0),
    COALESCE(array_length(v_ov_ids,1),0),
    COALESCE(array_length(v_pc_ids,1),0),
    COALESCE(array_length(v_pv_ids,1),0);

  IF NOT (v_have_oc OR v_have_ov OR v_have_pc OR v_have_pv) THEN
    RAISE EXCEPTION 'No active reservation types found. Add types before seeding.';
  END IF;

  -- ── 2. Build customer pool ────────────────────────────────────────────────────
  DROP TABLE IF EXISTS _seed_users;
  CREATE TEMP TABLE _seed_users AS
  SELECT id, COALESCE(name, 'Guest') AS uname
  FROM public.users
  WHERE access = 'customer' AND is_real = true AND email IS NULL
  ORDER BY random();

  RAISE NOTICE 'Customer pool: % users', (SELECT COUNT(*) FROM _seed_users);

  IF NOT EXISTS (SELECT 1 FROM _seed_users) THEN
    RAISE EXCEPTION 'No eligible customers found (access=''customer'', is_real=true, email IS NULL). Seed uses email-less accounts only to prevent accidental notifications.';
  END IF;

  -- ── 3. Iterate every timeslot available today ─────────────────────────────────
  FOR v_tmpl IN
    SELECT start_time, max_sessions
    FROM public.session_templates
    WHERE day_of_week = v_dow AND active = true
    ORDER BY start_time
  LOOP
    -- Process each lane in the timeslot independently
    FOR v_lane_i IN 1..v_tmpl.max_sessions LOOP
      v_lanes_total := v_lanes_total + 1;

      -- ── 65–70 % fill rate (roll per lane) ──────────────────────────────────
      IF random() > (0.65 + random() * 0.05) THEN
        CONTINUE;
      END IF;
      v_lanes_filled := v_lanes_filled + 1;

      -- ── Pick bucket with normalized weights ───────────────────────────────
      -- Raw weights: OC=35% OV=30% PC=20% PV=15% — zeroed for missing types
      v_w_oc := CASE WHEN v_have_oc THEN 0.35 ELSE 0 END;
      v_w_ov := CASE WHEN v_have_ov THEN 0.30 ELSE 0 END;
      v_w_pc := CASE WHEN v_have_pc THEN 0.20 ELSE 0 END;
      v_w_pv := CASE WHEN v_have_pv THEN 0.15 ELSE 0 END;
      v_w_total := v_w_pc + v_w_pv + v_w_oc + v_w_ov;

      IF v_w_total = 0 THEN CONTINUE; END IF;

      -- Normalize and pick
      v_w_oc := v_w_oc / v_w_total;
      v_w_ov := v_w_ov / v_w_total;
      v_w_pc := v_w_pc / v_w_total;
      -- v_w_pv gets the remainder (no need to normalize explicitly)

      v_roll := random();
      IF    v_roll < v_w_oc                        THEN v_bucket := 'oc';
      ELSIF v_roll < v_w_oc + v_w_ov               THEN v_bucket := 'ov';
      ELSIF v_roll < v_w_oc + v_w_ov + v_w_pc      THEN v_bucket := 'pc';
      ELSE                                               v_bucket := 'pv';
      END IF;

      -- ── Resolve type_id, mode, style, group count ─────────────────────────
      CASE v_bucket
        WHEN 'pc' THEN
          v_alen    := array_length(v_pc_ids, 1);
          v_type_id := v_pc_ids[1 + (floor(random() * v_alen))::int];
          v_mode    := 'coop';    v_style := 'private';
          v_groups  := 1;        -- private = single booking per lane

        WHEN 'pv' THEN
          v_alen    := array_length(v_pv_ids, 1);
          v_type_id := v_pv_ids[1 + (floor(random() * v_alen))::int];
          v_mode    := 'versus';  v_style := 'private';
          v_groups  := 1;

        WHEN 'oc' THEN
          v_alen    := array_length(v_oc_ids, 1);
          v_type_id := v_oc_ids[1 + (floor(random() * v_alen))::int];
          v_mode    := 'coop';    v_style := 'open';
          v_groups  := 2 + floor(random() * 2)::int;  -- 2-3 small groups

        WHEN 'ov' THEN
          v_alen    := array_length(v_ov_ids, 1);
          v_type_id := v_ov_ids[1 + (floor(random() * v_alen))::int];
          v_mode    := 'versus';  v_style := 'open';
          v_groups  := 2 + floor(random() * 2)::int;  -- 2-3 groups (need 2+ for a match)
      END CASE;

      SELECT price INTO v_price FROM public.reservation_types WHERE id = v_type_id;

      -- Lane capacity limits for open play (matches laneCapacity() in utils.js)
      v_lane_capacity := CASE
        WHEN v_style = 'open' AND v_mode = 'coop'    THEN 6
        WHEN v_style = 'open' AND v_mode = 'versus'  THEN 12
        ELSE 999  -- private: no shared-lane cap
      END;
      v_lane_used := 0;

      -- ── Create one booking per group ──────────────────────────────────────
      FOR v_gi IN 1..v_groups LOOP

        -- Stop adding groups once the lane is full
        IF v_lane_used >= v_lane_capacity THEN EXIT; END IF;

        -- Player count for this specific group
        v_gsize := CASE
          WHEN v_style = 'private' AND v_mode = 'coop'    THEN 4 + floor(random() * 3)::int   -- 4-6
          WHEN v_style = 'private' AND v_mode = 'versus'  THEN 8 + floor(random() * 5)::int   -- 8-12
          WHEN v_style = 'open'    AND v_mode = 'coop'    THEN 1 + floor(random() * 3)::int   -- 1-3
          WHEN v_style = 'open'    AND v_mode = 'versus'  THEN 4 + floor(random() * 3)::int   -- 4-6
          ELSE 2
        END;

        -- Clamp to remaining capacity so we never exceed the lane limit
        v_gsize := LEAST(v_gsize, v_lane_capacity - v_lane_used);
        IF v_gsize <= 0 THEN EXIT; END IF;

        -- Team for open-play versus: groups alternate Blue/Red
        v_group_team := CASE
          WHEN v_mode = 'versus' AND v_style = 'open'
          THEN (((v_gi - 1) % 2) + 1)::smallint
          ELSE NULL
        END;

        -- Pick a random customer as the booker
        SELECT id, uname INTO v_booker_id, v_booker_nm
        FROM _seed_users ORDER BY random() LIMIT 1;

        -- Insert the reservation
        v_res_id := gen_random_uuid();
        INSERT INTO public.reservations
          (id, type_id, user_id, customer_name, date, start_time,
           player_count, amount, status, paid)
        VALUES (
          v_res_id,
          v_type_id,
          v_booker_id,
          v_booker_nm,
          v_today,
          v_tmpl.start_time,
          v_gsize,
          v_price * CASE WHEN v_style = 'open' THEN v_gsize ELSE 1 END,
          'confirmed',
          (random() < 0.55)  -- ~55% paid at booking
        );

        v_res_total  := v_res_total + 1;
        v_lane_used  := v_lane_used + v_gsize;

        -- ── Add players to reservation ────────────────────────────────────
        FOR v_pi IN 1..v_gsize LOOP

          IF v_pi = 1 THEN
            -- First slot = the booker
            v_player_id := v_booker_id;
            v_pname     := v_booker_nm;
          ELSE
            -- Remaining = other random customers
            SELECT id, uname INTO v_player_id, v_player_nm
            FROM _seed_users ORDER BY random() LIMIT 1;
            v_pname := v_player_nm;
          END IF;

          -- Team assignment:
          --   private versus  → split evenly (first half=1, second half=2)
          --   open    versus  → entire group is one team (v_group_team)
          --   coop (any)      → NULL
          v_team := CASE
            WHEN v_mode = 'versus' AND v_style = 'private'
              THEN CASE WHEN (v_pi * 2) <= v_gsize THEN 1 ELSE 2 END::smallint
            WHEN v_mode = 'versus' AND v_style = 'open'
              THEN v_group_team
            ELSE NULL
          END;

          INSERT INTO public.reservation_players
            (reservation_id, user_id, name, team)
          VALUES (v_res_id, v_player_id, v_pname, v_team);

        END LOOP;  -- players

      END LOOP;  -- groups

    END LOOP;  -- lanes
  END LOOP;  -- timeslots

  -- ── Cleanup ───────────────────────────────────────────────────────────────────
  DROP TABLE IF EXISTS _seed_users;

  RAISE NOTICE '';
  RAISE NOTICE '══ Seed complete ══════════════════════════════════════';
  RAISE NOTICE '  Date         : %', v_today;
  RAISE NOTICE '  Lane-slots   : % available, % filled (%.0f%%)',
    v_lanes_total,
    v_lanes_filled,
    CASE WHEN v_lanes_total > 0
         THEN 100.0 * v_lanes_filled / v_lanes_total
         ELSE 0 END;
  RAISE NOTICE '  Reservations : % created', v_res_total;
  RAISE NOTICE '══════════════════════════════════════════════════════';
END $$;
