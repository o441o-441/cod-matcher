-- ============================================================
-- RLS Ownership Policies
-- Ensures users can only modify their own data.
-- Run via Supabase Dashboard → SQL Editor.
-- ============================================================

-- ============================================================
-- posts — UPDATE/DELETE only by author or admin
-- ============================================================
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY posts_select_all ON public.posts
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY posts_insert_own ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (author_user_id = auth.uid());

CREATE POLICY posts_update_own ON public.posts
  FOR UPDATE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY posts_delete_own ON public.posts
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ============================================================
-- post_comments — UPDATE/DELETE only by author or admin
-- ============================================================
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_select_all ON public.post_comments
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY comments_insert_own ON public.post_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_user_id = auth.uid());

CREATE POLICY comments_update_own ON public.post_comments
  FOR UPDATE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY comments_delete_own ON public.post_comments
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ============================================================
-- users — UPDATE only own row
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid());

-- ============================================================
-- profiles — SELECT public, UPDATE only own row
-- ============================================================
-- (profiles.id = auth.uid() by convention)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_all ON public.profiles
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- ============================================================
-- direct_messages — only sender or receiver can see
-- ============================================================
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY dm_select_own ON public.direct_messages
  FOR SELECT TO authenticated
  USING (sender_user_id = auth.uid() OR receiver_user_id = auth.uid());

CREATE POLICY dm_insert_own ON public.direct_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid());

CREATE POLICY dm_delete_own ON public.direct_messages
  FOR DELETE TO authenticated
  USING (sender_user_id = auth.uid());
