-- ============================================================
-- ランクマ通知のDiscordメッセージを30分後に自動削除する (2026-10-19適用済み)
--
-- 仕組み:
--   1. 通知投稿を _discord_post_tracked() 経由にする。
--      webhook URL に ?wait=true を付けて投稿し、pg_net の
--      リクエストIDを discord_cleanup_queue に記録する
--   2. pg_cron (5分おき) の fn_discord_cleanup() が、期限が来た行の
--      レスポンス (net._http_response) から message_id を取り出し、
--      webhook の DELETE エンドポイントで削除する
--
-- 利用側: ranked_match_notify.sql (マッチ成立) と
--         match_report_timeout.sql (結果報告) の2つの通知。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.discord_cleanup_queue (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL,   -- net.http_post のリクエストID
  webhook_key text NOT NULL,    -- app_settings のキー (URL変更に追従)
  delete_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.discord_cleanup_queue ENABLE ROW LEVEL SECURITY; -- ポリシー無し = サーバー専用

-- 通知を投稿して削除予約する (失敗しても呼び出し元は巻き込まない)
CREATE OR REPLACE FUNCTION public._discord_post_tracked(
  p_webhook_key text,
  p_body jsonb,
  p_delete_after_minutes integer DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_webhook text;
  v_req bigint;
BEGIN
  SELECT value INTO v_webhook FROM app_settings WHERE key = p_webhook_key;
  IF v_webhook IS NULL THEN RETURN; END IF;
  v_req := net.http_post(url := v_webhook || '?wait=true', body := p_body);
  IF p_delete_after_minutes IS NOT NULL AND p_delete_after_minutes > 0 THEN
    INSERT INTO discord_cleanup_queue (request_id, webhook_key, delete_after)
    VALUES (v_req, p_webhook_key, now() + make_interval(mins => p_delete_after_minutes));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- 期限が来た通知メッセージを削除する (pg_cronから5分おき)
CREATE OR REPLACE FUNCTION public.fn_discord_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_webhook text;
  v_msg_id text;
BEGIN
  FOR r IN
    SELECT id, request_id, webhook_key FROM discord_cleanup_queue
    WHERE delete_after <= now()
    ORDER BY delete_after
    LIMIT 50
  LOOP
    BEGIN
      SELECT value INTO v_webhook FROM app_settings WHERE key = r.webhook_key;
      SELECT (content::jsonb)->>'id' INTO v_msg_id
      FROM net._http_response WHERE id = r.request_id;
      IF v_webhook IS NOT NULL AND v_msg_id ~ '^\d+$' THEN
        PERFORM net.http_delete(url := v_webhook || '/messages/' || v_msg_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; -- レスポンス期限切れ等は諦めて行だけ消す
    END;
    DELETE FROM discord_cleanup_queue WHERE id = r.id;
  END LOOP;
END;
$$;

SELECT cron.schedule('discord-notify-cleanup', '*/5 * * * *', $$SELECT public.fn_discord_cleanup()$$);
