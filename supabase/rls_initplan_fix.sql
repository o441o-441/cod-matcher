-- ============================================================
-- RLS ポリシーの auth.uid() を (select auth.uid()) に書き換え (2026-10-22)
--
-- Supabase パフォーマンスアドバイザー (auth_rls_initplan) 対応。
-- RLS 式内の auth.uid() は行ごとに再評価されるが、スカラサブクエリで
-- 包むと InitPlan として1回だけ評価される。意味は完全に同一。
-- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
--
-- public スキーマの全ポリシーを走査し、未ラップの auth.uid() /
-- auth.role() / auth.jwt() を機械的にラップして ALTER POLICY する。
-- 冪等 (再実行してもラップ済みはスキップ)。新しいポリシーを素の
-- auth.uid() で書いてしまった時はこのファイルを再適用すればよい。
-- ============================================================

-- 置換ヘルパー (セッション限りの一時関数。終了時に自動消滅)
CREATE FUNCTION pg_temp._wrap_auth_fns(expr text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  IF expr IS NULL THEN RETURN NULL; END IF;
  -- 既にラップ済みの形 (デパース表現) をプレースホルダに退避してから
  -- 素の auth.*() を置換し、最後に戻す
  expr := replace(expr, '( SELECT auth.uid() AS uid)',   '__W_UID__');
  expr := replace(expr, '( SELECT auth.role() AS role)', '__W_ROLE__');
  expr := replace(expr, '( SELECT auth.jwt() AS jwt)',   '__W_JWT__');
  expr := replace(expr, 'auth.uid()',  '(select auth.uid())');
  expr := replace(expr, 'auth.role()', '(select auth.role())');
  expr := replace(expr, 'auth.jwt()',  '(select auth.jwt())');
  expr := replace(expr, '__W_UID__',  '(select auth.uid())');
  expr := replace(expr, '__W_ROLE__', '(select auth.role())');
  expr := replace(expr, '__W_JWT__',  '(select auth.jwt())');
  RETURN expr;
END;
$$;

DO $$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ((coalesce(qual, '')       ~ 'auth\.(uid|role|jwt)\(\)' AND coalesce(qual, '')       !~ 'SELECT auth\.(uid|role|jwt)\(\)')
        OR (coalesce(with_check, '') ~ 'auth\.(uid|role|jwt)\(\)' AND coalesce(with_check, '') !~ 'SELECT auth\.(uid|role|jwt)\(\)'))
  LOOP
    v_qual := pg_temp._wrap_auth_fns(r.qual);
    v_check := pg_temp._wrap_auth_fns(r.with_check);

    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_qual IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;

    EXECUTE v_sql;
    v_count := v_count + 1;
    RAISE NOTICE 'rewrote policy: %.% / %', r.tablename, r.policyname, v_sql;
  END LOOP;
  RAISE NOTICE 'auth_rls_initplan: % policies rewritten', v_count;
END;
$$;
