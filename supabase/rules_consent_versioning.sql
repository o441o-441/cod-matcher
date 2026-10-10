-- ============================================================
-- GAルール同意のバージョン管理
--
-- 従来: /match の RulesGate が localStorage['rules_accepted_v1'] に
--       記録するだけで、一度同意すると端末ごとに二度と表示されない。
-- 変更: 現行ルールバージョンを app_settings key='rules_version' に置き、
--       ユーザーの同意バージョンを profiles.rules_accepted_version に記録。
--       GA改定時に rules_version を上げると全員に再同意ゲートが出る。
--
-- ■ GA改定時の運用手順 (これだけで全ユーザーに再同意を要求できる):
--   update app_settings set value = '2' where key = 'rules_version';
--   ※ 値は任意の文字列 (改定ごとに変えればよい。日付 '2026-10-10' でも可)
-- ============================================================

-- 現行バージョン (初期値 '1')
INSERT INTO app_settings (key, value) VALUES ('rules_version', '1')
ON CONFLICT (key) DO NOTHING;

-- ユーザーごとの同意記録
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rules_accepted_version text;

-- ------------------------------------------------------------
-- 現行バージョンと自分の同意状態を返す
-- (app_settings はクライアント読取不可のためRPCで公開。
--  未ログインでも version は返す)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_rules_consent()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version text;
  v_accepted text;
BEGIN
  SELECT value INTO v_version FROM app_settings WHERE key = 'rules_version';
  v_version := coalesce(v_version, '1');
  IF v_uid IS NOT NULL THEN
    SELECT rules_accepted_version INTO v_accepted FROM profiles WHERE id = v_uid;
  END IF;
  RETURN json_build_object('version', v_version, 'accepted_version', v_accepted);
END;
$$;

-- ------------------------------------------------------------
-- 現行バージョンに同意する
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_accept_rules()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT value INTO v_version FROM app_settings WHERE key = 'rules_version';
  v_version := coalesce(v_version, '1');
  UPDATE profiles SET rules_accepted_version = v_version, updated_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok', true, 'version', v_version);
END;
$$;
