-- ============================================================
-- 内部専用関数の EXECUTE 権限ハードニング (2026-10-22)
--
-- Supabase セキュリティアドバイザー指摘への対応。
-- Postgres は関数に既定で PUBLIC へ EXECUTE を与えるため、
-- 内部ヘルパー (_x_post / _discord_post_tracked / _apply_match_rating 等)、
-- pg_cron 用 fn_*、トリガー関数 trg_* まで anon/authenticated から
-- PostgREST の /rpc/ 経由で直接呼べる状態だった。
-- 特に _x_post / _discord_post_tracked は内部に認証チェックがなく、
-- 未ログインでも公式X/Discordへ任意投稿できてしまう。
--
-- 対応: public の _% / fn_% / trg_% 関数から PUBLIC, anon,
-- authenticated の EXECUTE を剥奪し、service_role のみ再付与。
--   - SECURITY DEFINER 関数内部からの相互呼び出しは所有者権限で
--     実行されるため影響なし
--   - pg_cron はジョブ所有者 (postgres) として実行されるため影響なし
--   - トリガー発火時は EXECUTE 権限を再チェックしないため影響なし
--   - Edge Function (service_role) の _scrimboard_side_users 呼び出しは
--     GRANT to service_role で維持
-- 新しい内部関数を追加した時はこのファイルを再適用すること。
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE '\_%' ESCAPE '\'
           OR p.proname LIKE 'fn\_%' ESCAPE '\'
           OR p.proname LIKE 'trg\_%' ESCAPE '\')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;

-- 注意: 既定ACL (ALTER DEFAULT PRIVILEGES) は変更しない。
-- 変更すると今後 CREATE される rpc_* が authenticated から呼べず
-- サイレントに壊れるため、新しい内部関数はこのファイルの再適用で塞ぐ運用とする。
