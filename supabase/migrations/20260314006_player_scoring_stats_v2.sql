-- ============================================================
-- Migration: Player Scoring Stats v2 — expanded coop + versus
-- Version:   20260314006
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHAT THIS DOES:
--   Replaces get_player_scoring_stats with a richer version that
--   breaks out coop and versus stats separately.
--
--   COOP columns (per-run, role IS NULL):
--     coop_runs          — total coop run rows
--     coop_avg_score     — avg coop effective score
--     coop_targets_pct   — % runs where all targets eliminated
--     coop_obj_pct       — % runs where objective completed
--     coop_avg_seconds   — avg elapsed time (seconds, 0 = no data)
--
--   VERSUS columns (per-run, role IS NOT NULL):
--     versus_runs          — total versus run rows
--     versus_avg_score     — avg versus effective score
--     versus_obj_pct       — % hunter runs where obj completed
--     versus_coyote_win_pct— % coyote runs where player group won
--     versus_wins          — session-level war wins
--     versus_losses        — session-level war losses
-- ============================================================

DROP FUNCTION IF EXISTS public.get_player_scoring_stats(uuid[]);

CREATE FUNCTION public.get_player_scoring_stats(p_user_ids uuid[])
RETURNS TABLE (
  user_id               uuid,
  avg_score             numeric,
  total_runs            bigint,
  -- Coop
  coop_runs             bigint,
  coop_avg_score        numeric,
  coop_targets_pct      numeric,
  coop_obj_pct          numeric,
  coop_avg_seconds      numeric,
  -- Versus
  versus_runs           bigint,
  versus_avg_score      numeric,
  versus_obj_pct        numeric,
  versus_coyote_win_pct numeric,
  versus_wins           bigint,
  versus_losses         bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH run_stats AS (
    SELECT
      vpr.player_id,

      -- Overall totals
      COUNT(*)                                                                AS total_runs,
      ROUND(AVG(vpr.effective_score)::numeric, 1)                            AS avg_score,

      -- ── COOP (role IS NULL means no role assigned = coop run) ──────────
      COUNT(*) FILTER (WHERE vpr.role IS NULL)                               AS coop_runs,

      ROUND(
        AVG(vpr.effective_score) FILTER (WHERE vpr.role IS NULL)::numeric
      , 1)                                                                    AS coop_avg_score,

      ROUND(
        100.0
        * COUNT(*) FILTER (WHERE vpr.role IS NULL AND vpr.targets_eliminated = true)
        / NULLIF(COUNT(*) FILTER (WHERE vpr.role IS NULL), 0)
      , 1)                                                                    AS coop_targets_pct,

      ROUND(
        100.0
        * COUNT(*) FILTER (WHERE vpr.role IS NULL AND vpr.objective_complete = true)
        / NULLIF(COUNT(*) FILTER (WHERE vpr.role IS NULL), 0)
      , 1)                                                                    AS coop_obj_pct,

      ROUND(
        AVG(vpr.elapsed_seconds)
          FILTER (WHERE vpr.role IS NULL AND vpr.elapsed_seconds > 0)::numeric
      , 0)                                                                    AS coop_avg_seconds,

      -- ── VERSUS (role IS NOT NULL = hunter or coyote run) ───────────────
      COUNT(*) FILTER (WHERE vpr.role IS NOT NULL)                           AS versus_runs,

      ROUND(
        AVG(vpr.effective_score) FILTER (WHERE vpr.role IS NOT NULL)::numeric
      , 1)                                                                    AS versus_avg_score,

      -- Hunter objective completion %
      ROUND(
        100.0
        * COUNT(*) FILTER (WHERE vpr.role = 'hunter' AND vpr.objective_complete = true)
        / NULLIF(COUNT(*) FILTER (WHERE vpr.role = 'hunter'), 0)
      , 1)                                                                    AS versus_obj_pct,

      -- Coyote win % (coyote runs where this player's group won)
      ROUND(
        100.0
        * COUNT(*) FILTER (WHERE vpr.role = 'coyote'
                             AND vpr.winning_team = vpr.player_group)
        / NULLIF(COUNT(*) FILTER (WHERE vpr.role = 'coyote'), 0)
      , 1)                                                                    AS versus_coyote_win_pct

    FROM v_player_runs vpr
    WHERE vpr.player_id = ANY(p_user_ids)
    GROUP BY vpr.player_id
  ),

  session_wl AS (
    -- Session-level W/L comes from v_player_sessions (war outcome)
    SELECT
      ps.player_id,
      SUM(ps.is_versus_win)  AS versus_wins,
      SUM(ps.is_versus_loss) AS versus_losses
    FROM v_player_sessions ps
    WHERE ps.player_id = ANY(p_user_ids)
    GROUP BY ps.player_id
  )

  SELECT
    u.id                                        AS user_id,
    COALESCE(rs.avg_score,              0)      AS avg_score,
    COALESCE(rs.total_runs,             0)      AS total_runs,
    COALESCE(rs.coop_runs,              0)      AS coop_runs,
    COALESCE(rs.coop_avg_score,         0)      AS coop_avg_score,
    COALESCE(rs.coop_targets_pct,       0)      AS coop_targets_pct,
    COALESCE(rs.coop_obj_pct,           0)      AS coop_obj_pct,
    COALESCE(rs.coop_avg_seconds,       0)      AS coop_avg_seconds,
    COALESCE(rs.versus_runs,            0)      AS versus_runs,
    COALESCE(rs.versus_avg_score,       0)      AS versus_avg_score,
    COALESCE(rs.versus_obj_pct,         0)      AS versus_obj_pct,
    COALESCE(rs.versus_coyote_win_pct,  0)      AS versus_coyote_win_pct,
    COALESCE(wl.versus_wins,            0)      AS versus_wins,
    COALESCE(wl.versus_losses,          0)      AS versus_losses

  FROM unnest(p_user_ids) AS u(id)
  LEFT JOIN run_stats  rs ON rs.player_id = u.id
  LEFT JOIN session_wl wl ON wl.player_id = u.id
$$;

GRANT EXECUTE ON FUNCTION public.get_player_scoring_stats(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_scoring_stats(uuid[]) TO anon;
