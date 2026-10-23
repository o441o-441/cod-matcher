-- ============================================================
-- 機能の段階公開ゲート (2026-10-22)
--
-- ローンチ後、機能を日時指定で順次公開する:
--   8s               : 2026-10-24 12:00 JST
--   ランクマッチ      : 2026-10-30 21:00 JST
--   交流戦ボード      : 2026-11-06 19:00 JST
--   大会機能          : 2026-11-06 19:00 JST
--
-- 仕組み:
--   - 公開日時は app_settings.feature_release_<key> (ISO timestamptz)。
--     日時を変えるだけで前後にずらせる (再デプロイ不要)。NULL/行なし = 公開済み扱い。
--   - フロントは rpc_feature_releases() でスケジュールとサーバー時刻を取得し、
--     ロック画面 / NEWバッジ (公開から5日間) を表示する。
--   - 実効ガードは各機能の書き込みテーブルの BEFORE INSERT トリガー
--     (trg_feature_gate)。SECURITY DEFINER RPC 経由でも発火する。
--     管理者と内部処理 (auth.uid() が NULL = cron/service) はバイパス。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 公開スケジュール
-- ------------------------------------------------------------
INSERT INTO public.app_settings (key, value) VALUES
  ('feature_release_8s',         '2026-10-24T12:00:00+09:00'),
  ('feature_release_ranked',     '2026-10-30T21:00:00+09:00'),
  ('feature_release_scrim',      '2026-11-06T19:00:00+09:00'),
  ('feature_release_tournament', '2026-11-06T19:00:00+09:00')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- ------------------------------------------------------------
-- 2) 公開済み判定 (誰でも実行可)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.feature_released(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_release text;
BEGIN
  SELECT value INTO v_release FROM app_settings WHERE key = 'feature_release_' || p_key;
  RETURN v_release IS NULL OR v_release::timestamptz <= now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.feature_released(text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3) フロント向け: スケジュール一覧 + サーバー時刻
--    (クライアント時計のずれに依存しないよう now も返す)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_feature_releases()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT json_build_object(
    'now', now(),
    'releases', (
      SELECT coalesce(json_object_agg(replace(key, 'feature_release_', ''), value), '{}'::json)
      FROM app_settings WHERE key LIKE 'feature\_release\_%' ESCAPE '\'
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.rpc_feature_releases() TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4) 書き込みゲートのトリガー関数
--    TG_ARGV[0] = 機能キー ('8s' | 'ranked' | 'scrim' | 'tournament')
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_feature_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := TG_ARGV[0];
  v_uid uuid := auth.uid();
  v_release text;
BEGIN
  IF feature_released(v_key) THEN RETURN NEW; END IF;
  -- 内部処理 (pg_cron / service_role の直接実行など JWT なし) は通す
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  -- 管理者は公開前でも動作確認できる
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN RETURN NEW; END IF;

  SELECT value INTO v_release FROM app_settings WHERE key = 'feature_release_' || v_key;
  RAISE EXCEPTION 'この機能は % 公開予定です',
    to_char(v_release::timestamptz AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI');
END;
$$;

-- ------------------------------------------------------------
-- 5) 各機能の入口テーブルにトリガーを張る
-- ------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('eights_lobbies',          '8s'),
      ('eights_lobby_members',    '8s'),
      ('queue_entries',           'ranked'),
      ('scrim_mixed_rooms',       'scrim'),
      ('scrim_mixed_room_members','scrim'),
      ('member_availability',     'scrim'),
      ('scrim_matches',           'scrim'),
      ('tournaments',             'tournament'),
      ('tournament_entries',      'tournament')
    ) AS v(tbl, feature)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS feature_gate ON public.%I', t.tbl);
    EXECUTE format(
      'CREATE TRIGGER feature_gate BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_feature_gate(%L)',
      t.tbl, t.feature);
  END LOOP;
END;
$$;
