-- ============================================================
-- 8s の開催時間指定 (予約開催)
--
-- eights_lobbies.scheduled_at (null = 今すぐ開催 / 従来通り)。
--   - 作成RPCに p_scheduled_at を追加 (未来〜48時間以内)
--   - 開催・8人成立の各通知に開催時刻を記載
--   - 通知の時間帯フィルタは開催時刻基準で判定
--   - 開催時刻になったらメンバー全員へリマインド
--     (サイト内通知 + Discord個人メンション。pg_cron 5分毎)
-- 関数本体の変更は rpc_eights_notify_prefs.sql (作成RPC) と
-- eights_full_notify.sql (8人成立トリガー) を参照。
-- ============================================================

ALTER TABLE public.eights_lobbies ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.eights_lobbies ADD COLUMN IF NOT EXISTS start_notified_at timestamptz;

-- 旧シグネチャ (2引数) は削除してオーバーロードの曖昧さを防ぐ
DROP FUNCTION IF EXISTS public.rpc_eights_create_lobby(text, integer);

-- ------------------------------------------------------------
-- 開催時刻リマインド (pg_cron から5分毎に実行)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_eights_start_reminder()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  l record;
  v_member_ids uuid[];
  v_count int;
  v_mention_text text;
  v_mention_ids jsonb;
  v_webhook_url text;
  v_page text;
BEGIN
  SELECT value INTO v_webhook_url FROM app_settings WHERE key = 'discord_8s_webhook';

  FOR l IN
    SELECT * FROM eights_lobbies
    WHERE scheduled_at IS NOT NULL
      AND scheduled_at <= now()
      AND start_notified_at IS NULL
      AND status IN ('open', 'drafting')
  LOOP
    UPDATE eights_lobbies SET start_notified_at = now() WHERE id = l.id;

    SELECT count(*), array_agg(user_id) INTO v_count, v_member_ids
    FROM eights_lobby_members WHERE lobby_id = l.id;
    IF v_count = 0 THEN CONTINUE; END IF;

    v_page := 'https://ascent-esports.com/custom/eights/' || l.id;

    -- サイト内通知
    BEGIN
      INSERT INTO notifications (user_id, type, body, link, is_read)
      SELECT u, 'eights_start',
             '🕙 8s「' || l.title || '」の開催時刻になりました！ASCENT公式サーバーのボイスチャットに集合してください（現在 ' || v_count || '/8人）',
             '/custom/eights/' || l.id, false
      FROM unnest(v_member_ids) AS u;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Discord 個人メンション
    BEGIN
      IF v_webhook_url IS NOT NULL THEN
        SELECT string_agg('<@' || t.provider_id || '>', ' '), jsonb_agg(t.provider_id)
        INTO v_mention_text, v_mention_ids
        FROM (
          SELECT DISTINCT i.provider_id
          FROM auth.identities i
          WHERE i.provider = 'discord'
            AND i.user_id = ANY(v_member_ids)
            AND i.provider_id ~ '^\d+$'
          LIMIT 20
        ) t;

        PERFORM net.http_post(url := v_webhook_url, body := jsonb_build_object(
          'content', coalesce(v_mention_text, '') || E'\n🕙 **「' || l.title || '」の開催時刻になりました！ASCENT公式サーバーのボイスチャットに集合してください**（現在 ' || v_count || '/8人）',
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(v_mention_ids, '[]'::jsonb)),
          'embeds', jsonb_build_array(jsonb_build_object(
            'title', '🕙 8s 開始: ' || l.title,
            'url', v_page,
            'color', 16755200,
            'footer', jsonb_build_object('text', 'ASCENT · 8s Lobby'),
            'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ))
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eights-start-reminder') THEN
    PERFORM cron.unschedule('eights-start-reminder');
  END IF;
  PERFORM cron.schedule('eights-start-reminder', '*/5 * * * *', 'select public.fn_eights_start_reminder()');
END;
$$;
