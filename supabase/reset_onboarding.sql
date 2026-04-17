-- Force all players to redo onboarding (skill level selection)
-- Run once in Supabase SQL Editor

UPDATE users SET is_profile_complete = false;
UPDATE profiles SET is_onboarded = false;
