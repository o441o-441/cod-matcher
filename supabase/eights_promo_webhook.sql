-- ============================================================
-- 8s開催の外部サーバー告知 (@everyone でASCENTへ誘導) (2026-10-24)
--
-- 8sロビーの作成/再募集時に、ASCENT以外のDiscordサーバー
-- (コミュニティ/パートナーサーバー) へ @everyone 付きで告知し、
-- サイトのロビーURLとASCENT公式サーバーの招待リンクへ誘導する。
--
-- 必要な app_settings (未設定の間は何もしない):
--   discord_8s_promo_webhook      — 告知先サーバーのWebhook URL
--   discord_server_invite         — ASCENT公式サーバーの招待URL (任意)
--   discord_8s_promo_cooldown_min — @everyone連投防止の間隔 (分、既定30)
--
-- 内部管理 (自動書込): discord_8s_promo_last_at — 最終告知時刻
--
-- 呼び出し元: rpc_eights_create_lobby (rpc_eights_notify_prefs.sql) /
--             rpc_eights_reopen_lobby (eights_rematch.sql)
-- ベストエフォート (失敗してもロビー作成は成功)。
-- ============================================================

CREATE OR REPLACE FUNCTION public._eights_promo_post(
  p_lobby_id uuid,
  p_title text,
  p_host_name text,
  p_rate_label text,
  p_when_label text,
  p_member_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_webhook text;
  v_invite text;
  v_last text;
  v_cooldown int;
  v_page text := 'https://ascent-esports.com/custom/eights/' || p_lobby_id;
BEGIN
  SELECT value INTO v_webhook FROM app_settings WHERE key = 'discord_8s_promo_webhook';
  IF v_webhook IS NULL OR v_webhook = '' THEN RETURN; END IF;

  -- @everyone の連投防止 (既定30分に1回まで)
  SELECT coalesce(nullif(value, '')::int, 30) INTO v_cooldown
  FROM app_settings WHERE key = 'discord_8s_promo_cooldown_min';
  IF v_cooldown IS NULL THEN v_cooldown := 30; END IF;

  SELECT value INTO v_last FROM app_settings WHERE key = 'discord_8s_promo_last_at';
  IF v_last IS NOT NULL AND v_last <> '' AND v_last::timestamptz > now() - make_interval(mins => v_cooldown) THEN
    RETURN;
  END IF;
  INSERT INTO app_settings (key, value) VALUES ('discord_8s_promo_last_at', now()::text)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

  SELECT value INTO v_invite FROM app_settings WHERE key = 'discord_server_invite';

  PERFORM net.http_post(url := v_webhook, body := jsonb_build_object(
    'content',
      '@everyone' || E'\n'
      || '⚡ **CoDの4v4カスタム「8s」をASCENTで募集中！**（現在 ' || p_member_count || '/8人・開催: ' || p_when_label || '）' || E'\n'
      || '参加はこちら → ' || v_page
      || CASE WHEN v_invite IS NOT NULL AND v_invite <> ''
           THEN E'\n' || '🎮 ASCENT公式Discordサーバー → ' || v_invite
           ELSE '' END,
    'allowed_mentions', jsonb_build_object('parse', jsonb_build_array('everyone')),
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', '⚡ 8s 募集中: ' || p_title,
      'description', 'ASCENT は CoD 4v4 の対戦マッチングサイト。8s はレート変動なしの気軽な8人カスタムです。サイトからワンタップで参加できます！',
      'url', v_page,
      'color', 65535,
      'fields', jsonb_build_array(
        jsonb_build_object('name', '開催', 'value', p_when_label, 'inline', true),
        jsonb_build_object('name', 'ホスト', 'value', coalesce(p_host_name, '不明'), 'inline', true),
        jsonb_build_object('name', 'レート制限', 'value', p_rate_label, 'inline', true),
        jsonb_build_object('name', '参加状況', 'value', p_member_count || ' / 8', 'inline', true)
      ),
      'footer', jsonb_build_object('text', 'ASCENT · ascent-esports.com'),
      'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  ));
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- 内部専用: PostgREST からは呼べないようにする ([[function_grants_hardening.sql]] と同じ方針)
REVOKE EXECUTE ON FUNCTION public._eights_promo_post(uuid, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._eights_promo_post(uuid, text, text, text, text, integer) TO service_role;
