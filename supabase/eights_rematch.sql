-- ============================================================
-- 8s の「続行再募集」機能
--
-- 遊び終わった後、やめる人だけが退出し、残るメンバーを保持した
-- まま不足分を再募集できるようにする。
--   (1) rpc_eights_reopen_lobby — ホストが drafting → open に戻す。
--       チーム振り分けをリセットし、不足枠を通知 (サイト内 + Discord)。
--       開催時刻はクリア (再募集は常に「今すぐ」扱い)。
--       full_notified_at もクリアするので、8人に戻った時の集合通知が再発火する。
--   (2) rpc_eights_leave_lobby — ホストが退出してもロビーを閉じず、
--       残メンバーの最古参へホストを引き継ぐ (誰も残らなければ closed)。
--   (3) rpc_eights_close_lobby — 明示的な解散 (従来のホスト退出=解散の代替)。
-- X への再投稿はしない (連投スパム防止。Discord/サイト内通知のみ)。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 続行メンバーを保持したまま再募集 (ホスト or 管理者)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_reopen_lobby(p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lobby record;
  v_cnt int;
  v_slots int;
  v_host_name text;
  v_host_peak integer;
  v_rate_label text;
  v_hour integer;
  v_recipients uuid[];
  v_mention_ids text[];
  v_chunk text[];
  v_embed jsonb;
  v_total integer;
  v_pos integer;
  v_announce_url text;
  v_announce_secret text;
  v_webhook_url text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL THEN RAISE EXCEPTION 'ロビーが見つかりません'; END IF;
  IF v_lobby.host_user_id <> v_uid AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN
    RAISE EXCEPTION 'ホストのみ実行できます';
  END IF;
  IF v_lobby.status <> 'drafting' THEN
    RAISE EXCEPTION 'チーム振り分け後のロビーのみ再募集できます';
  END IF;

  -- 振り分けをリセットして募集状態へ戻す
  UPDATE eights_lobby_members SET team_side = NULL WHERE lobby_id = p_lobby_id;
  UPDATE eights_lobbies
  SET status = 'open',
      full_notified_at = NULL,
      scheduled_at = NULL,
      start_notified_at = NULL
  WHERE id = p_lobby_id;

  SELECT count(*) INTO v_cnt FROM eights_lobby_members WHERE lobby_id = p_lobby_id;
  v_slots := 8 - v_cnt;

  -- 全員残っている (再振り分け目的) なら通知は出さない
  IF v_slots <= 0 THEN
    RETURN json_build_object('ok', true, 'member_count', v_cnt, 'slots', 0);
  END IF;

  -- 非公開ロビーは告知しない (URL共有のみで再募集。eights_private_lobbies.sql)
  IF v_lobby.is_private THEN
    RETURN json_build_object('ok', true, 'member_count', v_cnt, 'slots', v_slots);
  END IF;

  SELECT display_name, peak_rating INTO v_host_name, v_host_peak FROM profiles WHERE id = v_lobby.host_user_id;
  v_rate_label := CASE WHEN v_lobby.rate_cap IS NOT NULL THEN '≤ ' || v_lobby.rate_cap ELSE 'なし' END;

  -- 通知対象者の抽出 + サイト内通知 (rpc_eights_create_lobby と同じ条件)
  BEGIN
    v_hour := extract(hour FROM now() AT TIME ZONE 'Asia/Tokyo')::integer;

    SELECT array_agg(user_id) INTO v_recipients FROM (
      SELECT np.user_id
      FROM eights_notify_prefs np
      JOIN profiles pr ON pr.id = np.user_id
      WHERE np.enabled
        AND np.user_id <> v_uid
        AND NOT pr.is_banned
        AND (pr.suspended_until IS NULL OR pr.suspended_until < now())
        AND (v_lobby.rate_cap IS NULL OR pr.peak_rating <= v_lobby.rate_cap)
        AND (np.hour_start IS NULL
             OR np.hour_start = np.hour_end
             OR (np.hour_start < np.hour_end AND v_hour >= np.hour_start AND v_hour < np.hour_end)
             OR (np.hour_start > np.hour_end AND (v_hour >= np.hour_start OR v_hour < np.hour_end)))
        AND (np.rating_min IS NULL OR coalesce(v_host_peak, 1500) >= np.rating_min)
        AND (np.rating_max IS NULL OR coalesce(v_host_peak, 1500) <= np.rating_max)
        -- 継続メンバーには通知不要
        -- (複数参加の解禁により「他ロビー参加中」は除外しない。eights_multi_join.sql)
        AND NOT EXISTS (
          SELECT 1 FROM eights_lobby_members m
          WHERE m.lobby_id = p_lobby_id AND m.user_id = np.user_id)
        -- 直近10分に8s通知を受けた人はスキップ (連投スパム防止)
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = np.user_id AND n.type = 'eights_lobby'
            AND n.created_at > now() - interval '10 minutes')
      LIMIT 500
    ) s;

    IF v_recipients IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, body, link, is_read)
      SELECT r,
             'eights_lobby',
             '🔁 8s 再募集: ' || v_lobby.title || '（残り' || v_slots || '枠 / ホスト: ' || coalesce(v_host_name, '不明') || ' / レート制限: ' || v_rate_label || '）',
             '/custom/eights/' || p_lobby_id,
             false
      FROM unnest(v_recipients) AS r;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Discord 通知 (条件に合致した人だけ個人メンション)
  BEGIN
    IF v_recipients IS NOT NULL THEN
      SELECT array_agg(i.provider_id ORDER BY i.provider_id)
      INTO v_mention_ids
      FROM auth.identities i
      WHERE i.provider = 'discord'
        AND i.user_id = ANY(v_recipients)
        AND i.provider_id ~ '^\d+$';
    END IF;

    SELECT value INTO v_announce_url FROM app_settings WHERE key = 'discord_announce_url';
    SELECT value INTO v_announce_secret FROM app_settings WHERE key = 'edge_internal_secret';
    IF v_announce_url IS NOT NULL AND v_announce_secret IS NOT NULL THEN
      -- Bot送信 (「参加する」ボタン付き)
      PERFORM net.http_post(
        url := v_announce_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_announce_secret),
        body := jsonb_build_object(
          'kind', 'reopen',
          'lobby_id', p_lobby_id,
          'title', v_lobby.title,
          'host_name', coalesce(v_host_name, '不明'),
          'rate_label', v_rate_label,
          'when_label', '今すぐ',
          'member_count', v_cnt,
          'mention_ids', coalesce(to_jsonb(v_mention_ids), '[]'::jsonb)
        )
      );
    ELSE
      -- フォールバック: Webhook 送信 (ボタンなし)
      SELECT value INTO v_webhook_url FROM app_settings WHERE key = 'discord_8s_webhook';
      IF v_webhook_url IS NOT NULL THEN
        v_total := coalesce(array_length(v_mention_ids, 1), 0);

        v_embed := jsonb_build_array(jsonb_build_object(
          'title', '🔁 8s 再募集: ' || v_lobby.title,
          'description', '試合を終えたロビーが続行メンバーを保持したまま再募集中！残り' || v_slots || '枠です。',
          'url', 'https://ascent-esports.com/custom/eights/' || p_lobby_id,
          'color', 65535,
          'fields', jsonb_build_array(
            jsonb_build_object('name', '開催', 'value', '今すぐ', 'inline', true),
            jsonb_build_object('name', 'ホスト', 'value', coalesce(v_host_name, '不明'), 'inline', true),
            jsonb_build_object('name', 'レート制限', 'value', v_rate_label, 'inline', true),
            jsonb_build_object('name', '参加状況', 'value', v_cnt || ' / 8', 'inline', true)
          ),
          'footer', jsonb_build_object('text', 'ASCENT · 8s Lobby'),
          'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ));

        IF v_total = 0 THEN
          PERFORM net.http_post(url := v_webhook_url, body := jsonb_build_object(
            'content', '',
            'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()),
            'embeds', v_embed
          ));
        ELSE
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
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 外部Discordサーバーへの @everyone 告知 (eights_promo_webhook.sql。クールダウンは作成時と共有)
  BEGIN
    PERFORM _eights_promo_post(p_lobby_id, v_lobby.title, v_host_name, v_rate_label, '今すぐ', v_cnt);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object('ok', true, 'member_count', v_cnt, 'slots', v_slots);
END;
$$;

-- ------------------------------------------------------------
-- 2) 退出: ホストが抜けてもロビーを閉じず、最古参へホストを引き継ぐ
--    (従来は「ホスト退出 = ロビー終了」。解散は rpc_eights_close_lobby へ分離)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_leave_lobby(p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lobby record;
  v_new_host uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL THEN RAISE EXCEPTION 'ロビーが見つかりません'; END IF;

  DELETE FROM eights_lobby_members WHERE lobby_id = p_lobby_id AND user_id = v_uid;

  IF v_lobby.host_user_id = v_uid AND v_lobby.status IN ('open', 'drafting') THEN
    SELECT user_id INTO v_new_host
    FROM eights_lobby_members
    WHERE lobby_id = p_lobby_id
    ORDER BY joined_at
    LIMIT 1;

    IF v_new_host IS NULL THEN
      -- 誰も残っていなければ従来どおり終了
      UPDATE eights_lobbies SET status = 'closed' WHERE id = p_lobby_id;
    ELSE
      UPDATE eights_lobbies SET host_user_id = v_new_host WHERE id = p_lobby_id;
      -- 新ホストへ通知 (ベストエフォート)
      BEGIN
        INSERT INTO notifications (user_id, type, body, link, is_read)
        VALUES (v_new_host, 'eights_host',
                '👑 8s「' || v_lobby.title || '」のホストを引き継ぎました。振り分け・再募集・解散の操作ができます',
                '/custom/eights/' || p_lobby_id, false);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'new_host', v_new_host);
END;
$$;

-- ------------------------------------------------------------
-- 3) ロビー解散 (ホスト or 管理者)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_close_lobby(p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lobby record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL THEN RAISE EXCEPTION 'ロビーが見つかりません'; END IF;
  IF v_lobby.host_user_id <> v_uid AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN
    RAISE EXCEPTION 'ホストのみ実行できます';
  END IF;
  IF v_lobby.status NOT IN ('open', 'drafting') THEN
    RETURN json_build_object('ok', true); -- 既に終了済み
  END IF;

  UPDATE eights_lobbies SET status = 'closed' WHERE id = p_lobby_id;
  RETURN json_build_object('ok', true);
END;
$$;
