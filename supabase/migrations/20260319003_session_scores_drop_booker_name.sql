-- Remove booker_name (PII) from v_session_scores.
-- The field is never read by the app; fetchPlayerSessionHistory
-- only uses booker_id, date, start_time, type_id, status, total_score, run_count.

DROP VIEW IF EXISTS public.v_session_scores;
CREATE VIEW public.v_session_scores AS
SELECT
  r.id              AS reservation_id,
  r.user_id         AS booker_id,
  r.date,
  r.start_time,
  r.type_id,
  r.status,
  COALESCE(SUM(sr.score), 0)       AS total_score,
  COUNT(DISTINCT sr.run_number)    AS run_count
FROM   public.reservations r
LEFT   JOIN public.session_runs sr ON sr.reservation_id = r.id
WHERE  r.status = 'completed'
GROUP  BY r.id, r.user_id, r.date, r.start_time, r.type_id, r.status;

GRANT SELECT ON public.v_session_scores TO authenticated;
REVOKE SELECT ON public.v_session_scores FROM anon;
