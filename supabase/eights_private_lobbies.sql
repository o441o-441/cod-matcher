-- ============================================================
-- 8s の非公開ロビー (静かに募集) (2026-10-24)
--
-- 「すでに決まった3人で開きたい」等、告知なしで8sを開けるようにする。
--   - eights_lobbies.is_private = true のロビーは
--     (1) 一覧・LIVE統計に出ない (RLS + rpc_live_stats)
--     (2) 作成/再募集時の通知4系統 (サイト内・Discord・X・外部プロモ)
--         を一切送らない
--     (3) メンバー宛ての8人成立・開催リマインド・編成確定も Discord
--         (#8s-lobby) へは出さず、サイト内通知のみ (公開チャンネルに
--         出すと非公開開催の存在がバレるため。eights_full_notify.sql /
--         eights_scheduled.sql / discord_eights_button.sql を参照)
--   - 招待は URL (/custom/eights/{id}) の共有のみ。UUID が鍵の代わり。
--     未参加者はロビー行をSELECTできないため、詳細ページは
--     rpc_eights_lobby_preview で最小情報 (タイトル・人数等) を表示し、
--     参加は従来の rpc_eights_join_lobby (SECURITY DEFINER) がそのまま通る
--   - ホストは rpc_eights_publish_lobby でいつでも全体公開でき、
--     通常の開催と同じ告知が現在の参加人数付きで飛ぶ
--
-- 告知処理は _eights_announce に集約 (作成時と公開時で共用)。
-- rpc_eights_create_lobby 本体は rpc_eights_notify_prefs.sql、
-- 再募集の告知スキップは eights_rematch.sql、
-- LIVE統計の除外は rpc_live_stats.sql を参照。
-- ============================================================

-- ------------------------------------------------------------
-- 1) カラム
-- ------------------------------------------------------------
ALTER TABLE public.eights_lobbies ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 2) メンバー判定ヘルパー
--    eights_lobbies のSELECTポリシーから eights_lobby_members を
--    参照すると members 側ポリシー経由で相互再帰になるため、
--    RLSをバイパスする SECURITY DEFINER 関数で判定を切り離す。
--    (ポリシー式は実行ユーザー権限で評価されるため EXECUTE が必要)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._eights_is_lobby_member(p_lobby_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM eights_lobby_members
    WHERE lobby_id = p_lobby_id AND user_id = p_user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public._eights_is_lobby_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._eights_is_lobby_member(uuid, uuid) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3) RLS: 非公開ロビーはホスト・メンバーのみ閲覧可
--    メンバー行は「ロビーが見える人にだけ見える」(lobbies のRLSに委譲)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS eights_lobbies_select_all ON public.eights_lobbies;
DROP POLICY IF EXISTS eights_lobbies_select_visible ON public.eights_lobbies;
CREATE POLICY eights_lobbies_select_visible ON public.eights_lobbies
  FOR SELECT USING (
    NOT is_private
    OR host_user_id = (SELECT auth.uid())
    OR _eights_is_lobby_member(id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS elm_select_all ON public.eights_lobby_members;
DROP POLICY IF EXISTS elm_select_visible ON public.eights_lobby_members;
CREATE POLICY elm_select_visible ON public.eights_lobby_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM eights_lobbies l WHERE l.id = eights_lobby_members.lobby_id)
  );

-- ------------------------------------------------------------
-- 4) 開催告知 (作成時/公開時で共用)
--    旧 rpc_eights_create_lobby 内の通知4系統を関数化したもの。
--    参加状況は実人数で送る (作成時=1人、後から公開時=確定済み人数)。
--    呼び出し元でベストエフォートに包むこと。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._eights_announce(p_lobby_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lobby record;
  v_cnt int;
  v_host_name text;
  v_host_peak integer;
  v_rate_label text;
  v_when_label text;
  v_sched timestamptz;
  v_hour integer;
  v_recipients uuid[];
  v_mention_ids text[];
  v_chunk text[];
  v_embed jsonb;
  v_total integer;
  v_pos integer;
  v_webhook_url text;
  v_announce_url text;
  v_announce_secret text;
BEGIN
  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL OR v_lobby.status <> 'open' THEN RETURN; END IF;

  SELECT count(*) INTO v_cnt FROM eights_lobby_members WHERE lobby_id = p_lobby_id;
  IF v_cnt >= 8 THEN RETURN; END IF; -- 満員なら募集告知は不要

  SELECT display_name, peak_rating INTO v_host_name, v_host_peak FROM profiles WHERE id = v_lobby.host_user_id;
  v_rate_label := CASE WHEN v_lobby.rate_cap IS NOT NULL THEN '≤ ' || v_lobby.rate_cap ELSE 'なし' END;
  -- 開催時刻が過ぎてから公開された予約ロビーは「今すぐ」扱い
  v_sched := CASE WHEN v_lobby.scheduled_at IS NOT NULL AND v_lobby.scheduled_at > now() THEN v_lobby.scheduled_at END;
  v_when_label := CASE WHEN v_sched IS NULL THEN '今すぐ'
    ELSE to_char(v_sched AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') END;

  -- (1) 通知対象者の抽出 + サイト内通知 (オプトイン者のみ)
  BEGIN
    -- 時間帯フィルタは「開催時刻」基準 (予約開催なら開催時刻のJST時)
    v_hour := extract(hour FROM coalesce(v_sched, now()) AT TIME ZONE 'Asia/Tokyo')::integer;

    SELECT array_agg(user_id) INTO v_recipients FROM (
      SELECT np.user_id
      FROM eights_notify_prefs np
      JOIN profiles pr ON pr.id = np.user_id
      WHERE np.enabled
        AND np.user_id <> v_lobby.host_user_id
        AND NOT pr.is_banned
        AND (pr.suspended_until IS NULL OR pr.suspended_until < now())
        -- 参加できないロビーは通知しない (ピークレート上限)
        AND (v_lobby.rate_cap IS NULL OR pr.peak_rating <= v_lobby.rate_cap)
        -- 時間帯指定 (JST)。start=end は常時扱い、start>end は日跨ぎ
        AND (np.hour_start IS NULL
             OR np.hour_start = np.hour_end
             OR (np.hour_start < np.hour_end AND v_hour >= np.hour_start AND v_hour < np.hour_end)
             OR (np.hour_start > np.hour_end AND (v_hour >= np.hour_start OR v_hour < np.hour_end)))
        -- レート帯指定: ホストのピークレートが関心帯に入っているか
        AND (np.rating_min IS NULL OR coalesce(v_host_peak, 1500) >= np.rating_min)
        AND (np.rating_max IS NULL OR coalesce(v_host_peak, 1500) <= np.rating_max)
        -- このロビーの確定済みメンバーには通知不要
        -- (複数参加の解禁により「他ロビー参加中」は除外しない。eights_multi_join.sql)
        AND NOT EXISTS (
          SELECT 1 FROM eights_lobby_members m
          WHERE m.lobby_id = p_lobby_id AND m.user_id = np.user_id)
        -- 直近10分に8s通知を受けた人はスキップ (開催連投によるスパム防止)
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
             '⚡ 8s 開催: ' || v_lobby.title || '（開催: ' || v_when_label || ' / ホスト: ' || coalesce(v_host_name, '不明') || ' / レート制限: ' || v_rate_label || '）',
             '/custom/eights/' || p_lobby_id,
             false
      FROM unnest(v_recipients) AS r;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- (2) Discord 通知 (条件に合致した人だけ個人メンション。80人ずつ分割送信)
  BEGIN
    IF v_recipients IS NOT NULL THEN
      SELECT array_agg(i.provider_id ORDER BY i.provider_id)
      INTO v_mention_ids
      FROM auth.identities i
      WHERE i.provider = 'discord'
        AND i.user_id = ANY(v_recipients)
        AND i.provider_id ~ '^\d+$';
    END IF;

    -- Bot送信 (「参加する」ボタン付き) が設定済みなら Edge Function 経由で送る
    SELECT value INTO v_announce_url FROM app_settings WHERE key = 'discord_announce_url';
    SELECT value INTO v_announce_secret FROM app_settings WHERE key = 'edge_internal_secret';
    IF v_announce_url IS NOT NULL AND v_announce_secret IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_announce_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_announce_secret),
        body := jsonb_build_object(
          'lobby_id', p_lobby_id,
          'title', v_lobby.title,
          'host_name', coalesce(v_host_name, '不明'),
          'rate_label', v_rate_label,
          'when_label', v_when_label,
          'member_count', v_cnt,
          'mention_ids', coalesce(to_jsonb(v_mention_ids), '[]'::jsonb)
        )
      );
    ELSE
      -- フォールバック: 従来の Webhook 送信 (ボタンなし)
      SELECT value INTO v_webhook_url FROM app_settings WHERE key = 'discord_8s_webhook';

      IF v_webhook_url IS NOT NULL THEN
        v_total := coalesce(array_length(v_mention_ids, 1), 0);

        v_embed := jsonb_build_array(jsonb_build_object(
          'title', '⚡ 8s 開催: ' || v_lobby.title,
          'description', '8人カスタムマッチのロビーが作成されました。参加者募集中！',
          'url', 'https://ascent-esports.com/custom/eights/' || p_lobby_id,
          'color', 65535,
          'fields', jsonb_build_array(
            jsonb_build_object('name', '開催', 'value', v_when_label, 'inline', true),
            jsonb_build_object('name', 'ホスト', 'value', coalesce(v_host_name, '不明'), 'inline', true),
            jsonb_build_object('name', 'レート制限', 'value', v_rate_label, 'inline', true),
            jsonb_build_object('name', '参加状況', 'value', v_cnt || ' / 8', 'inline', true)
          ),
          'footer', jsonb_build_object('text', 'ASCENT · 8s Lobby'),
          'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ));

        IF v_total = 0 THEN
          -- 対象者なし: メンションなしの Embed のみ
          PERFORM net.http_post(url := v_webhook_url, body := jsonb_build_object(
            'content', '',
            'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()),
            'embeds', v_embed
          ));
        ELSE
          -- 80人ずつ分割。Embed は先頭メッセージのみ、2通目以降はメンションのみ
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

  -- (3) X (plze) への告知 (ベストエフォート。_x_post 未設定ならスキップ)
  BEGIN
    PERFORM _x_post(
      '⚡ 8s（プライベートマッチ）募集中！【' || v_when_label || ' 開催】ホスト: ' || coalesce(v_host_name, '不明')
      || CASE WHEN v_lobby.rate_cap IS NOT NULL THEN '（レート ≤ ' || v_lobby.rate_cap || '）' ELSE '' END || E'\n'
      || '参加はこちら → https://ascent-esports.com/custom/eights/' || p_lobby_id || E'\n'
      || 'plze #cod #MW4'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- (4) 外部Discordサーバーへの @everyone 告知 (eights_promo_webhook.sql。未設定ならスキップ)
  BEGIN
    PERFORM _eights_promo_post(p_lobby_id, v_lobby.title, v_host_name, v_rate_label, v_when_label, v_cnt);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

-- 内部専用: PostgREST からは呼べないようにする ([[function_grants_hardening.sql]] と同じ方針)
REVOKE EXECUTE ON FUNCTION public._eights_announce(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._eights_announce(uuid) TO service_role;

-- ------------------------------------------------------------
-- 5) 非公開ロビーの全体公開 (ホスト or 管理者)
--    一覧に載せ、通常の開催と同じ告知を現在の人数付きで送る
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_publish_lobby(p_lobby_id uuid)
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
  IF v_lobby.status <> 'open' THEN RAISE EXCEPTION '募集中のロビーのみ公開できます'; END IF;
  IF NOT v_lobby.is_private THEN RAISE EXCEPTION 'このロビーは既に公開されています'; END IF;

  UPDATE eights_lobbies SET is_private = false WHERE id = p_lobby_id;

  BEGIN
    PERFORM _eights_announce(p_lobby_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- 6) 招待URL閲覧用の最小プレビュー
--    非公開ロビーはRLSで未参加者からSELECTできないため、
--    URL (= UUID) を知っている人にだけ参加判断に必要な情報を返す。
--    終了済みロビーは返さない。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_lobby_preview(p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lobby record;
  v_cnt int;
  v_host_name text;
BEGIN
  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL OR v_lobby.status NOT IN ('open', 'drafting') THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_cnt FROM eights_lobby_members WHERE lobby_id = p_lobby_id;
  SELECT display_name INTO v_host_name FROM profiles WHERE id = v_lobby.host_user_id;

  RETURN json_build_object(
    'title', v_lobby.title,
    'status', v_lobby.status,
    'rate_cap', v_lobby.rate_cap,
    'scheduled_at', v_lobby.scheduled_at,
    'is_private', v_lobby.is_private,
    'host_name', coalesce(v_host_name, '不明'),
    'member_count', v_cnt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_eights_lobby_preview(uuid) TO anon, authenticated, service_role;
