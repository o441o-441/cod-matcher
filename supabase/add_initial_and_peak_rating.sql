-- Add initial_rating and peak_rating columns to profiles
-- Run once in Supabase SQL Editor

-- initial_rating: the rating chosen during onboarding (1400/1500/1600)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS initial_rating integer NOT NULL DEFAULT 1500;

-- peak_rating: the highest current_rating ever achieved
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS peak_rating integer NOT NULL DEFAULT 1500;

-- Backfill peak_rating for existing users from current_rating
UPDATE profiles
SET peak_rating = GREATEST(COALESCE(current_rating, 1500), 1500)
WHERE peak_rating = 1500 AND COALESCE(current_rating, 1500) > 1500;
