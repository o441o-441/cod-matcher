-- ============================================================
-- 8s 通知のオプトイン化
--
-- 従来: 8s開催時に Discord #8s-lobby へ @everyone 一斉通知のみ。
-- 変更: 「8s通知を受け取る」をオプトインした人にだけ届ける。
--   (1) サイト内通知 (notifications) — レート帯・時間帯の条件付き
--   (2) Discord はロールメンションに変更 (@everyone 廃止)
--       ロールIDは app_settings key='discord_8s_role_id' に設定。
--       未設定ならメンションなしの Embed のみ送信。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 通知設定テーブル
--    hour_start / hour_end: JSTの時 (0-23)。両方 NULL = 常時。
--    hour_start > hour_end は日跨ぎ (例 22→2 = 22:00〜02:00)。
--    rating_min / rating_max: ホストのピークレートに対する関心帯。
--    NULL = 指定なし。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eights_notify_prefs (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  hour_start smallint CHECK (hour_start BETWEEN 0 AND 23),
  hour_end smallint CHECK (hour_end BETWEEN 0 AND 23),
  rating_min integer CHECK (rating_min BETWEEN 0 AND 4000),
  rating_max integer CHECK (rating_max BETWEEN 0 AND 4000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((hour_start IS NULL) = (hour_end IS NULL)),
  CHECK (rating_min IS NULL OR rating_max IS NULL OR rating_min <= rating_max)
);

ALTER TABLE public.eights_notify_prefs ENABLE ROW LEVEL SECURITY;

-- 読み取りは本人のみ。書き込みは RPC 経由のみ (ポリシーを作らない)。
DROP POLICY IF EXISTS eights_notify_prefs_select_own ON public.eights_notify_prefs;
CREATE POLICY eights_notify_prefs_select_own ON public.eights_notify_prefs
  FOR SELECT USING (auth.uid() = user_id);

-- 開催時の対象者抽出用 (enabled のみ部分インデックス)
CREATE INDEX IF NOT EXISTS idx_eights_notify_prefs_enabled
  ON public.eights_notify_prefs (user_id) WHERE enabled;

-- ------------------------------------------------------------
-- 2) 通知設定の保存 RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_set_notify_prefs(
  p_enabled boolean,
  p_hour_start integer DEFAULT NULL,
  p_hour_end integer DEFAULT NULL,
  p_rating_min integer DEFAULT NULL,
  p_rating_max integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF (p_hour_start IS NULL) <> (p_hour_end IS NULL) THEN
    RAISE EXCEPTION '時間帯は開始と終了の両方を指定してください';
  END IF;
  IF p_hour_start IS NOT NULL AND (p_hour_start NOT BETWEEN 0 AND 23 OR p_hour_end NOT BETWEEN 0 AND 23) THEN
    RAISE EXCEPTION '時間帯は 0〜23 時で指定してください';
  END IF;
  IF p_rating_min IS NOT NULL AND p_rating_max IS NOT NULL AND p_rating_min > p_rating_max THEN
    RAISE EXCEPTION 'レート帯の下限が上限を超えています';
  END IF;
  IF (p_rating_min IS NOT NULL AND p_rating_min NOT BETWEEN 0 AND 4000)
     OR (p_rating_max IS NOT NULL AND p_rating_max NOT BETWEEN 0 AND 4000) THEN
    RAISE EXCEPTION 'レート帯は 0〜4000 で指定してください';
  END IF;

  INSERT INTO eights_notify_prefs (user_id, enabled, hour_start, hour_end, rating_min, rating_max, updated_at)
  VALUES (v_uid, p_enabled, p_hour_start, p_hour_end, p_rating_min, p_rating_max, now())
  ON CONFLICT (user_id) DO UPDATE SET
    enabled = excluded.enabled,
    hour_start = excluded.hour_start,
    hour_end = excluded.hour_end,
    rating_min = excluded.rating_min,
    rating_max = excluded.rating_max,
    updated_at = now();

  RETURN json_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- 3) ロビー作成 RPC を更新
--    - サイト内通知: オプトイン者のうち条件 (時間帯/レート帯/参加可否) に
--      合う人へ INSERT。直近10分に8s通知を受けた人はスキップ (連投対策)。
--    - Discord: @everyone をやめ、discord_8s_role_id のロールメンションに。
--    どちらもベストエフォート (失敗してもロビー作成は成功)。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_create_lobby(p_title text, p_rate_cap integer DEFAULT NULL::integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lid uuid;
  v_webhook_url text;
  v_role_id text;
  v_host_name text;
  v_host_peak integer;
  v_rate_label text;
  v_payload jsonb;
  v_hour integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(trim(p_title)) < 1 THEN RAISE EXCEPTION 'タイトルを入力してください'; END IF;
  IF EXISTS (SELECT 1 FROM eights_lobby_members m JOIN eights_lobbies l ON l.id = m.lobby_id WHERE m.user_id = v_uid AND l.status IN ('open','drafting')) THEN
    RAISE EXCEPTION '既に他のロビーに参加しています';
  END IF;

  INSERT INTO eights_lobbies (host_user_id, title, rate_cap) VALUES (v_uid, trim(p_title), p_rate_cap) RETURNING id INTO v_lid;
  INSERT INTO eights_lobby_members (lobby_id, user_id, weapon_role) VALUES (v_lid, v_uid, 'FLEX');

  SELECT display_name, peak_rating INTO v_host_name, v_host_peak FROM profiles WHERE id = v_uid;
  v_rate_label := CASE WHEN p_rate_cap IS NOT NULL THEN '≤ ' || p_rate_cap ELSE 'なし' END;

  -- サイト内通知 (オプトイン者のみ)
  BEGIN
    v_hour := extract(hour FROM now() AT TIME ZONE 'Asia/Tokyo')::integer;

    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT np.user_id,
           'eights_lobby',
           '⚡ 8s 開催: ' || trim(p_title) || '（ホスト: ' || coalesce(v_host_name, '不明') || ' / レート制限: ' || v_rate_label || '）',
           '/custom/eights/' || v_lid,
           false
    FROM eights_notify_prefs np
    JOIN profiles pr ON pr.id = np.user_id
    WHERE np.enabled
      AND np.user_id <> v_uid
      AND NOT pr.is_banned
      AND (pr.suspended_until IS NULL OR pr.suspended_until < now())
      -- 参加できないロビーは通知しない (ピークレート上限)
      AND (p_rate_cap IS NULL OR pr.peak_rating <= p_rate_cap)
      -- 時間帯指定 (JST)。start=end は常時扱い、start>end は日跨ぎ
      AND (np.hour_start IS NULL
           OR np.hour_start = np.hour_end
           OR (np.hour_start < np.hour_end AND v_hour >= np.hour_start AND v_hour < np.hour_end)
           OR (np.hour_start > np.hour_end AND (v_hour >= np.hour_start OR v_hour < np.hour_end)))
      -- レート帯指定: ホストのピークレートが関心帯に入っているか
      AND (np.rating_min IS NULL OR coalesce(v_host_peak, 1500) >= np.rating_min)
      AND (np.rating_max IS NULL OR coalesce(v_host_peak, 1500) <= np.rating_max)
      -- 既にアクティブなロビーに居る人はどうせ参加できないので除外
      AND NOT EXISTS (
        SELECT 1 FROM eights_lobby_members m JOIN eights_lobbies l ON l.id = m.lobby_id
        WHERE m.user_id = np.user_id AND l.status IN ('open','drafting'))
      -- 直近10分に8s通知を受けた人はスキップ (開催連投によるスパム防止)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = np.user_id AND n.type = 'eights_lobby'
          AND n.created_at > now() - interval '10 minutes')
    LIMIT 500;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Discord 通知 (ロールメンション)
  BEGIN
    SELECT value INTO v_webhook_url FROM app_settings WHERE key = 'discord_8s_webhook';
    SELECT value INTO v_role_id FROM app_settings WHERE key = 'discord_8s_role_id';
    IF v_role_id IS NOT NULL AND v_role_id !~ '^\d+$' THEN v_role_id := NULL; END IF;

    v_payload := jsonb_build_object(
      'content', CASE WHEN v_role_id IS NOT NULL THEN '<@&' || v_role_id || '>' ELSE '' END,
      'allowed_mentions', CASE WHEN v_role_id IS NOT NULL
        THEN jsonb_build_object('parse', jsonb_build_array(), 'roles', jsonb_build_array(v_role_id))
        ELSE jsonb_build_object('parse', jsonb_build_array()) END,
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '⚡ 8s 開催: ' || trim(p_title),
        'description', '8人カスタムマッチのロビーが作成されました。参加者募集中！',
        'color', 65535,
        'fields', jsonb_build_array(
          jsonb_build_object('name', 'ホスト', 'value', coalesce(v_host_name, '不明'), 'inline', true),
          jsonb_build_object('name', 'レート制限', 'value', v_rate_label, 'inline', true),
          jsonb_build_object('name', '参加状況', 'value', '1 / 8', 'inline', true)
        ),
        'footer', jsonb_build_object('text', 'ASCENT · 8s Lobby'),
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ))
    );

    IF v_webhook_url IS NOT NULL THEN
      PERFORM net.http_post(url := v_webhook_url, body := v_payload);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object('ok', true, 'lobby_id', v_lid);
END;
$$;
