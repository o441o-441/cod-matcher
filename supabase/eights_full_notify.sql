-- ============================================================
-- 8s: 8人揃った時の集合通知
--
-- eights_lobby_members への INSERT で8人目が入った瞬間に:
--   (1) Discord #8s-lobby へ8人全員の個人メンション付きで
--       「ASCENT公式サーバーのVCに集合」を通知
--   (2) 8人全員へサイト内通知 (Discordを見ていない人向け)
-- 通知はロビーごとに1回 (full_notified_at で管理)。ベストエフォート。
-- ============================================================

ALTER TABLE public.eights_lobbies ADD COLUMN IF NOT EXISTS full_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.trg_eights_lobby_full()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lobby record;
  v_count int;
  v_member_ids uuid[];
  v_mention_text text;
  v_mention_ids jsonb;
  v_webhook_url text;
  v_page text;
  v_gather text;
BEGIN
  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = NEW.lobby_id;
  IF v_lobby IS NULL THEN RETURN NEW; END IF;
  IF v_lobby.status NOT IN ('open', 'drafting') THEN RETURN NEW; END IF;
  IF v_lobby.full_notified_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT count(*), array_agg(user_id) INTO v_count, v_member_ids
  FROM eights_lobby_members WHERE lobby_id = NEW.lobby_id;
  IF v_count < 8 THEN RETURN NEW; END IF;

  -- 通知はロビーごとに1回
  UPDATE eights_lobbies SET full_notified_at = now() WHERE id = NEW.lobby_id;

  v_page := 'https://ascent-esports.com/custom/eights/' || NEW.lobby_id;
  -- 予約開催 (開催時刻が未来) なら「時間になったら集合」、即時なら「今すぐ集合」
  v_gather := CASE WHEN v_lobby.scheduled_at IS NOT NULL AND v_lobby.scheduled_at > now()
    THEN '開催は ' || to_char(v_lobby.scheduled_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || ' — 時間になったらASCENT公式サーバーのボイスチャットに集合してください'
    ELSE 'ASCENT公式サーバーのボイスチャットに集合してください' END;

  -- サイト内通知 (8人全員)
  BEGIN
    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT u, 'eights_full',
           '✅ 8s「' || v_lobby.title || '」が8人揃いました！' || v_gather,
           '/custom/eights/' || NEW.lobby_id, false
    FROM unnest(v_member_ids) AS u;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Discord 個人メンション
  BEGIN
    SELECT value INTO v_webhook_url FROM app_settings WHERE key = 'discord_8s_webhook';
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
        'content', coalesce(v_mention_text, '') || E'\n✅ **8人揃いました！** ' || v_gather,
        'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(v_mention_ids, '[]'::jsonb)),
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '✅ 8s 成立: ' || v_lobby.title,
          'description', 'メンバーが8人揃いました。VCに集合後、ホストがチームを振り分けます。',
          'url', v_page,
          'color', 65440,
          'footer', jsonb_build_object('text', 'ASCENT · 8s Lobby'),
          'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ))
      ));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eights_lobby_full ON public.eights_lobby_members;
CREATE TRIGGER trg_eights_lobby_full
  AFTER INSERT ON public.eights_lobby_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_eights_lobby_full();
