-- Add team column to reservation_players for versus match team assignment
ALTER TABLE public.reservation_players
  ADD COLUMN IF NOT EXISTS team smallint
  CONSTRAINT reservation_players_team_check CHECK (team IN (1, 2));
