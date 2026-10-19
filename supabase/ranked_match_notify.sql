-- ============================================================
-- ランクマッチ成立の通知
--
-- マッチ成立 (matches INSERT, queue_type='ranked') の瞬間に、
-- 対戦する8人へサイト内通知 + Discord個人メンションを送る。
-- 1人が気づかないと残り7人が止まるため、取りこぼし防止が目的。
--
-- メンバー行 (match_team_members) は matches と同一トランザクションで
-- 後から INSERT されるため、コミット時に発火する遅延制約トリガーを使う。
-- 送信先: app_settings key='discord_ranked_webhook' (#ランクマ通知)
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_notify_ranked_match_found()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_ids uuid[];
  v_mention_ids text[];
  v_link text;
BEGIN
  IF NEW.queue_type <> 'ranked' OR NEW.status <> 'banpick' THEN RETURN NEW; END IF;

  SELECT array_agg(mtm.user_id) INTO v_user_ids
  FROM match_teams mt
  JOIN match_team_members mtm ON mtm.match_team_id = mt.id
  WHERE mt.match_id = NEW.id;
  IF v_user_ids IS NULL THEN RETURN NEW; END IF;

  v_link := '/match/' || NEW.id || '/banpick';

  -- サイト内通知 (8人全員)
  BEGIN
    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT u, 'match_found',
           '⚔️ ランクマッチが成立しました！BAN/PICKを開始してください',
           v_link, false
    FROM unnest(v_user_ids) AS u;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Discord 個人メンション (#ランクマ通知、30分後に自動削除 — discord_notify_cleanup.sql)
  BEGIN
    SELECT array_agg(provider_id) INTO v_mention_ids
    FROM auth.identities
    WHERE provider = 'discord' AND user_id = ANY(v_user_ids) AND provider_id ~ '^\d+$';

    PERFORM _discord_post_tracked('discord_ranked_webhook', jsonb_build_object(
      'content',
        coalesce((SELECT string_agg('<@' || x || '>', ' ') FROM unnest(v_mention_ids) AS x), '')
        || E'\n⚔️ **ランクマッチが成立しました！BAN/PICKを開始してください**',
      'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_mention_ids), '[]'::jsonb)),
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '⚔️ マッチ成立 — BAN/PICKへ',
        'url', 'https://ascent-esports.com' || v_link,
        'color', 65535,
        'footer', jsonb_build_object('text', 'ASCENT · Ranked'),
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ))
    ), 30);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ranked_match_found ON public.matches;
CREATE CONSTRAINT TRIGGER trg_notify_ranked_match_found
  AFTER INSERT ON public.matches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_ranked_match_found();
