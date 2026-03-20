-- Allow mixed-case platoon tags and special characters
ALTER TABLE public.platoons
  DROP CONSTRAINT IF EXISTS platoons_tag_format,
  ADD CONSTRAINT platoons_tag_format CHECK (tag ~ '^[^ \t\r\n]{2,5}$');
