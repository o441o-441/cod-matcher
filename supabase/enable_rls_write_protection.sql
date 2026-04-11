-- =============================================================================
-- Re-enable RLS with write protection (INSERT/UPDATE/DELETE blocked for direct
-- client access) while keeping SELECT open so Supabase Realtime keeps working.
--
-- Strategy:
--   1. ENABLE ROW LEVEL SECURITY on each table.
--   2. Add a permissive SELECT policy (USING (true)) for authenticated + anon
--      roles so Realtime subscriptions and all read queries continue to work.
--   3. For tables written only via SECURITY DEFINER RPCs: no INSERT/UPDATE/DELETE
--      policies are created, so the default-deny kicks in for direct client
--      writes. The RPCs bypass RLS because they run as the function owner.
--   4. For post_likes (written directly from the frontend): add narrow
--      INSERT/DELETE policies checking auth.uid().
--
-- Run this once in the Supabase SQL editor (or via psql).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. matches
-- ---------------------------------------------------------------------------
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matches_select_all ON public.matches;
CREATE POLICY matches_select_all
  ON public.matches
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- No INSERT / UPDATE / DELETE policies → direct client writes are denied.
-- All writes go through SECURITY DEFINER RPCs (e.g. rpc_create_match_from_queue).


-- ---------------------------------------------------------------------------
-- 2. match_teams
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_teams_select_all ON public.match_teams;
CREATE POLICY match_teams_select_all
  ON public.match_teams
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 3. match_team_members
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_team_members_select_all ON public.match_team_members;
CREATE POLICY match_team_members_select_all
  ON public.match_team_members
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 4. match_messages
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_messages_select_all ON public.match_messages;
CREATE POLICY match_messages_select_all
  ON public.match_messages
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Messages are sent via rpc_send_match_message (SECURITY DEFINER), not direct writes.


-- ---------------------------------------------------------------------------
-- 5. banpick_sessions
-- ---------------------------------------------------------------------------
ALTER TABLE public.banpick_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banpick_sessions_select_all ON public.banpick_sessions;
CREATE POLICY banpick_sessions_select_all
  ON public.banpick_sessions
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 6. banpick_actions
-- ---------------------------------------------------------------------------
ALTER TABLE public.banpick_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banpick_actions_select_all ON public.banpick_actions;
CREATE POLICY banpick_actions_select_all
  ON public.banpick_actions
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 7. match_reports
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_reports_select_all ON public.match_reports;
CREATE POLICY match_reports_select_all
  ON public.match_reports
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 8. parties
-- ---------------------------------------------------------------------------
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parties_select_all ON public.parties;
CREATE POLICY parties_select_all
  ON public.parties
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 9. party_members
-- ---------------------------------------------------------------------------
ALTER TABLE public.party_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_members_select_all ON public.party_members;
CREATE POLICY party_members_select_all
  ON public.party_members
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 10. party_invites
-- ---------------------------------------------------------------------------
ALTER TABLE public.party_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_invites_select_all ON public.party_invites;
CREATE POLICY party_invites_select_all
  ON public.party_invites
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 11. queue_entries
-- ---------------------------------------------------------------------------
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS queue_entries_select_all ON public.queue_entries;
CREATE POLICY queue_entries_select_all
  ON public.queue_entries
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ---------------------------------------------------------------------------
-- 12. post_likes
--     Written directly from the frontend: the like-toggle code does
--       supabase.from('post_likes').insert(...)  and  .delete()
--     The user_id column holds auth.uid() (session.user.id).
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_likes_select_all   ON public.post_likes;
DROP POLICY IF EXISTS post_likes_insert_own   ON public.post_likes;
DROP POLICY IF EXISTS post_likes_delete_own   ON public.post_likes;

CREATE POLICY post_likes_select_all
  ON public.post_likes
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- A user may only insert a like for themselves.
CREATE POLICY post_likes_insert_own
  ON public.post_likes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- A user may only delete their own like.
CREATE POLICY post_likes_delete_own
  ON public.post_likes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy → updates are blocked (likes are insert-or-delete only).


-- ---------------------------------------------------------------------------
-- 13. monitor_reports
-- ---------------------------------------------------------------------------
ALTER TABLE public.monitor_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monitor_reports_select_all ON public.monitor_reports;
CREATE POLICY monitor_reports_select_all
  ON public.monitor_reports
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- =============================================================================
-- Done. Summary of access after running this script:
--
--   Table                  | SELECT | INSERT | UPDATE | DELETE
--   -----------------------+--------+--------+--------+--------
--   matches                |  open  |  RPC   |  RPC   |  RPC
--   match_teams            |  open  |  RPC   |  RPC   |  RPC
--   match_team_members     |  open  |  RPC   |  RPC   |  RPC
--   match_messages         |  open  |  RPC   |  RPC   |  RPC
--   banpick_sessions       |  open  |  RPC   |  RPC   |  RPC
--   banpick_actions        |  open  |  RPC   |  RPC   |  RPC
--   match_reports          |  open  |  RPC   |  RPC   |  RPC
--   parties                |  open  |  RPC   |  RPC   |  RPC
--   party_members          |  open  |  RPC   |  RPC   |  RPC
--   party_invites          |  open  |  RPC   |  RPC   |  RPC
--   queue_entries          |  open  |  RPC   |  RPC   |  RPC
--   post_likes             |  open  | own uid|   -    | own uid
--   monitor_reports        |  open  |  RPC   |  RPC   |  RPC
--
--   "open"    = USING (true) policy, everyone can read
--   "RPC"     = no direct-client policy; SECURITY DEFINER functions still work
--   "own uid" = auth.uid() must match user_id column
--   "-"       = no policy (blocked)
-- =============================================================================
