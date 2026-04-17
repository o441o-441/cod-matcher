-- Trigger to automatically update peak_rating when current_rating increases
-- Run once in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.fn_update_peak_rating()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  IF NEW.current_rating > COALESCE(OLD.peak_rating, 0) THEN
    NEW.peak_rating := NEW.current_rating;
  END IF;
  RETURN NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_update_peak_rating ON profiles;

CREATE TRIGGER trg_update_peak_rating
  BEFORE UPDATE OF current_rating ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_peak_rating();
