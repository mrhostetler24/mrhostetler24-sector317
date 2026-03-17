-- ============================================================
-- Migration: Fix total_runs in get_friend_profile
-- Version:   20260317001
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & Run
--
-- WHY THIS EXISTS:
--   get_friend_profile computed total_runs from v_leaderboard
--   (LEFT JOIN). v_leaderboard filters by u.is_real = true and
--   u.hide_from_leaderboard = false. Users hidden from the
--   leaderboard (e.g. staff) get a NULL join → COALESCE(NULL,0) = 0,
--   even though they have real run data.
--
--   avg_score and best_run already use direct session_runs subqueries
--   (unaffected by leaderboard visibility), so those are correct.
--   This makes total_runs consistent with them.
--
--   Fix: count runs directly from session_runs using the same logic
--   as get_friend_extended (coop + versus), removing the v_leaderboard
--   join entirely from this RPC.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_friend_profile(uuid);

CREATE FUNCTION public.get_friend_profile(p_user_id uuid)
RETURNS TABLE (
  leaderboard_name    text,
  real_name           text,
  avatar_url          text,
  hide_avatar         boolean,
  profession          text,
  home_base_city      text,
  home_base_state     text,
  phone               text,
  email               text,
  motto               text,
  bio                 text,
  total_runs          bigint,
  avg_score           numeric,
  best_run            numeric,
  access              text,
  platoon_tag         text,
  platoon_badge_color text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(u.leaderboard_name, u.name)                                   AS leaderboard_name,
    CASE WHEN COALESCE(u.hide_name, false)       THEN NULL ELSE u.name       END AS real_name,
    u.avatar_url,
    COALESCE(u.hide_avatar, false)                                         AS hide_avatar,
    CASE WHEN COALESCE(u.hide_profession, false) THEN NULL ELSE u.profession END AS profession,
    CASE WHEN COALESCE(u.hide_home_base, false)  THEN NULL ELSE u.home_base_city  END AS home_base_city,
    CASE WHEN COALESCE(u.hide_home_base, false)  THEN NULL ELSE u.home_base_state END AS home_base_state,
    CASE WHEN COALESCE(u.hide_phone, false) THEN NULL
         ELSE NULLIF(REGEXP_REPLACE(COALESCE(u.phone,''), '[^0-9]', '', 'g'), '')
    END                                                                    AS phone,
    CASE WHEN COALESCE(u.hide_email, false) THEN NULL ELSE u.email END     AS email,
    CASE WHEN COALESCE(u.hide_motto, false) THEN NULL ELSE u.motto END     AS motto,
    CASE WHEN COALESCE(u.hide_bio,   false) THEN NULL ELSE u.bio   END     AS bio,
    -- Count runs directly from session_runs — same logic as get_friend_extended.
    -- Avoids v_leaderboard which excludes hide_from_leaderboard users.
    (SELECT COUNT(*)::bigint
     FROM   public.session_runs sr_cnt
     JOIN   public.reservation_players rp_cnt
       ON   rp_cnt.reservation_id = sr_cnt.reservation_id
       AND  rp_cnt.user_id = u.id
     WHERE  sr_cnt.role IS NULL   -- co-op: all runs
         OR (sr_cnt.team = rp_cnt.team
             OR (rp_cnt.team IS NULL AND sr_cnt.team = 1))) -- versus: player's team
                                                                           AS total_runs,
    (SELECT ROUND(AVG(sr.score)::numeric, 1)
     FROM   public.reservation_players rp
     JOIN   public.session_runs sr ON sr.reservation_id = rp.reservation_id
     WHERE  rp.user_id = u.id
       AND  (sr.team IS NULL OR sr.team = rp.team))                        AS avg_score,
    (SELECT ROUND(MAX(sr.score)::numeric, 1)
     FROM   public.reservation_players rp
     JOIN   public.session_runs sr ON sr.reservation_id = rp.reservation_id
     WHERE  rp.user_id = u.id
       AND  (sr.team IS NULL OR sr.team = rp.team))                        AS best_run,
    u.access,
    u.platoon_tag,
    pl.badge_color                                                         AS platoon_badge_color
  FROM   public.users   u
  LEFT JOIN public.platoons pl ON pl.tag = u.platoon_tag
  WHERE  u.id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_profile(uuid) TO authenticated;
