-- ============================================================
-- 混成ルームの募集通知
--
-- ルームメンバーが「通知を送る」ボタンで全ユーザーへ募集を告知できる。
--   - 1ルームにつき1日1回まで (scrim_mixed_rooms.last_notified_at)
--   - 受信はユーザー設定でOFF可能 (mixed_room_notify_prefs。
--     行が無い = ON のオプトアウト方式なので新規ユーザーも自動ON)
--   - サイト内通知 + Discord個人メンション
--     (専用チャンネル: app_settings key='discord_mixed_webhook')
-- ============================================================

ALTER TABLE public.scrim_mixed_rooms ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.mixed_room_notify_prefs (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mixed_room_notify_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mixed_room_notify_prefs_select_own ON public.mixed_room_notify_prefs;
CREATE POLICY mixed_room_notify_prefs_select_own ON public.mixed_room_notify_prefs
  FOR SELECT USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 受信設定の保存
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_room_notify_pref(p_enabled boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  INSERT INTO mixed_room_notify_prefs (user_id, enabled, updated_at)
  VALUES (v_uid, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = now();
  RETURN json_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- 募集通知の送信 (ルームメンバーのみ・1ルーム1日1回)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_room_notify(p_room_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room record;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_count int;
  v_recipients uuid[];
  v_mention_ids text[];
  v_chunk text[];
  v_embed jsonb;
  v_webhook_url text;
  v_total int;
  v_pos int;
  v_when text;
  v_body text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_room FROM scrim_mixed_rooms WHERE id = p_room_id;
  IF v_room IS NULL THEN RAISE EXCEPTION 'ルームが見つかりません'; END IF;
  IF v_room.status <> 'open' THEN RAISE EXCEPTION 'このルームは募集を終了しています'; END IF;
  IF v_room.date < v_today THEN RAISE EXCEPTION 'このルームの日付は過ぎています'; END IF;
  IF NOT EXISTS (SELECT 1 FROM scrim_mixed_room_members WHERE room_id = p_room_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'このルームのメンバーのみ通知を送れます';
  END IF;
  IF v_room.last_notified_at IS NOT NULL
     AND (v_room.last_notified_at AT TIME ZONE 'Asia/Tokyo')::date = v_today THEN
    RAISE EXCEPTION '本日は既に通知済みです（1ルームにつき1日1回まで）';
  END IF;

  UPDATE scrim_mixed_rooms SET last_notified_at = now() WHERE id = p_room_id;

  SELECT count(*) INTO v_count FROM scrim_mixed_room_members WHERE room_id = p_room_id;
  v_when := to_char(v_room.date, 'MM/DD') || ' ' || _scrimboard_slot_label(v_room.slot_start)
    || ' – ' || _scrimboard_slot_label(v_room.slot_end);
  v_body := '📣 混成ルーム「' || v_room.name || '」がメンバー募集中！（' || v_when || ' / 現在 ' || v_count || '/5人・あと' || greatest(0, 4 - v_count) || '人で成立）';

  -- 受信対象: OFFにしていない全アクティブユーザー
  -- (ルームメンバー本人・BAN/停止中・同日に別ルーム参加中の人は除外)
  SELECT array_agg(user_id) INTO v_recipients FROM (
    SELECT p.id AS user_id
    FROM profiles p
    LEFT JOIN mixed_room_notify_prefs np ON np.user_id = p.id
    WHERE coalesce(np.enabled, true)
      AND NOT p.is_banned
      AND (p.suspended_until IS NULL OR p.suspended_until < now())
      AND NOT EXISTS (SELECT 1 FROM scrim_mixed_room_members rm WHERE rm.room_id = p_room_id AND rm.user_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM scrim_mixed_room_members rm2
        JOIN scrim_mixed_rooms r2 ON r2.id = rm2.room_id
        WHERE rm2.user_id = p.id AND r2.date = v_room.date AND r2.status IN ('open', 'matched'))
    LIMIT 500
  ) s;

  IF v_recipients IS NULL THEN
    RETURN json_build_object('ok', true, 'notified', 0);
  END IF;

  -- サイト内通知
  BEGIN
    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT u, 'mixed_room', v_body, '/custom/board', false
    FROM unnest(v_recipients) AS u;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Discord 個人メンション (80人ずつ分割、混成通知の専用チャンネルへ)
  BEGIN
    SELECT value INTO v_webhook_url FROM app_settings WHERE key = 'discord_mixed_webhook';
    IF v_webhook_url IS NOT NULL THEN
      SELECT array_agg(i.provider_id ORDER BY i.provider_id) INTO v_mention_ids
      FROM auth.identities i
      WHERE i.provider = 'discord'
        AND i.user_id = ANY(v_recipients)
        AND i.provider_id ~ '^\d+$';
      v_total := coalesce(array_length(v_mention_ids, 1), 0);

      v_embed := jsonb_build_array(jsonb_build_object(
        'title', '📣 混成ルーム募集: ' || v_room.name,
        'description', 'チームの垣根なし・誰でも参加OK。4人集まるとボードに掲載され、対戦を組めます。',
        'url', 'https://ascent-esports.com/custom/board',
        'color', 9124086,
        'fields', jsonb_build_array(
          jsonb_build_object('name', '日時', 'value', v_when, 'inline', true),
          jsonb_build_object('name', 'メンバー', 'value', v_count || ' / 5人', 'inline', true)
        ),
        'footer', jsonb_build_object('text', 'ASCENT · Mixed Room'),
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ));

      IF v_total > 0 THEN
        v_pos := 1;
        WHILE v_pos <= v_total LOOP
          v_chunk := v_mention_ids[v_pos : least(v_pos + 79, v_total)];
          PERFORM net.http_post(url := v_webhook_url, body := jsonb_build_object(
            'content', (SELECT string_agg('<@' || x || '>', ' ') FROM unnest(v_chunk) AS x),
            'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', (SELECT jsonb_agg(x) FROM unnest(v_chunk) AS x)),
            'embeds', CASE WHEN v_pos = 1 THEN v_embed ELSE '[]'::jsonb END
          ));
          v_pos := v_pos + 80;
        END LOOP;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN json_build_object('ok', true, 'notified', coalesce(array_length(v_recipients, 1), 0));
END;
$$;
