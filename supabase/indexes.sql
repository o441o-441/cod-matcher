-- Performance indexes for frequently queried columns
-- Run once in Supabase SQL Editor

-- queue_entries: polling every 3s during matchmaking
CREATE INDEX IF NOT EXISTS idx_queue_entries_status_type
  ON queue_entries (status, queue_type);
CREATE INDEX IF NOT EXISTS idx_queue_entries_party_id_status
  ON queue_entries (party_id, status);

-- party_members: loaded on every match page visit
CREATE INDEX IF NOT EXISTS idx_party_members_user_id
  ON party_members (user_id);

-- match_team_members: loaded on banpick/report/confirm
CREATE INDEX IF NOT EXISTS idx_match_team_members_match_team_id
  ON match_team_members (match_team_id);
CREATE INDEX IF NOT EXISTS idx_match_team_members_user_id
  ON match_team_members (user_id);
CREATE INDEX IF NOT EXISTS idx_match_team_members_queue_entry
  ON match_team_members (source_queue_entry_id);

-- match_teams: loaded on banpick/report/confirm
CREATE INDEX IF NOT EXISTS idx_match_teams_match_id
  ON match_teams (match_id);

-- matches: status filtering
CREATE INDEX IF NOT EXISTS idx_matches_status
  ON matches (status);

-- banpick_sessions: loaded on banpick page
CREATE INDEX IF NOT EXISTS idx_banpick_sessions_match_id
  ON banpick_sessions (match_id);

-- banpick_actions: loaded on banpick page
CREATE INDEX IF NOT EXISTS idx_banpick_actions_match_id
  ON banpick_actions (match_id);

-- match_messages: loaded on banpick/confirm/report
CREATE INDEX IF NOT EXISTS idx_match_messages_match_id
  ON match_messages (match_id);

-- notifications: polled on menu page
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications (user_id, is_read);

-- rating_history: loaded on mypage and user profiles
CREATE INDEX IF NOT EXISTS idx_rating_history_user_created
  ON rating_history (user_id, created_at);

-- friendships: loaded on friends page
CREATE INDEX IF NOT EXISTS idx_friendships_user1
  ON friendships (user_id_1);
CREATE INDEX IF NOT EXISTS idx_friendships_user2
  ON friendships (user_id_2);

-- team_members: loaded on menu/mypage/match
CREATE INDEX IF NOT EXISTS idx_team_members_user_id
  ON team_members (user_id);

-- profiles: loaded on nearly every page
CREATE INDEX IF NOT EXISTS idx_profiles_id
  ON profiles (id);

-- posts: blog listing and view
CREATE INDEX IF NOT EXISTS idx_posts_status_published
  ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_slug
  ON posts (slug);
