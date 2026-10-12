-- ============================================================
-- サイトロック (公開準備モード)
--
-- app_settings key='site_locked' が 'true' の間、管理者以外は
-- トップページ (/) と /login 以外へアクセスできない
-- (クライアントの SiteLockGate がリダイレクト)。
--
-- ■ 解除方法:
--   update app_settings set value = 'false' where key = 'site_locked';
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_site_lock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locked text;
BEGIN
  SELECT value INTO v_locked FROM app_settings WHERE key = 'site_locked';
  RETURN json_build_object('locked', coalesce(v_locked, 'false') = 'true');
END;
$$;

-- 初期状態: ロックON
INSERT INTO app_settings (key, value) VALUES ('site_locked', 'true')
ON CONFLICT (key) DO NOTHING;
