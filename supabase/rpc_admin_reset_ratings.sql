CREATE OR REPLACE FUNCTION public.rpc_admin_reset_ratings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  -- Reset logic:
  --   base = initial_rating (chosen during onboarding: 1400/1500/1600)
  --   if peak_rating >= 1600 → reset to 1600
  --   else if peak_rating >= 1500 → reset to 1500
  --   else → reset to initial_rating
  UPDATE profiles
  SET current_rating = GREATEST(
    COALESCE(initial_rating, 1500),
    CASE
      WHEN COALESCE(peak_rating, 0) >= 1600 THEN 1600
      WHEN COALESCE(peak_rating, 0) >= 1500 THEN 1500
      ELSE COALESCE(initial_rating, 1500)
    END
  );
end;
$$;
