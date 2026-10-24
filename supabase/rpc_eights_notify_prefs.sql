-- ============================================================
-- 8s 通知のオプトイン化
--
-- 従来: 8s開催時に Discord #8s-lobby へ @everyone 一斉通知のみ。
-- 変更: 「8s通知を受け取る」をオプトインした人にだけ届ける。
--   (1) サイト内通知 (notifications) — レート帯・時間帯の条件付き
--   (2) Discord は条件に合致した人への個人メンション (@everyone 廃止)
--       サイト内通知と同じ絞り込みがDiscord側にも効く。
--       Discord ID は auth.identities (provider='discord') から取得。
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
--    告知 (サイト内/Discord/X/外部プロモ) は _eights_announce
--    (eights_private_lobbies.sql) に集約。
--    p_private = true の非公開ロビーは告知を一切送らない
--    (URL共有のみで募集。後から rpc_eights_publish_lobby で公開可)。
-- ------------------------------------------------------------
-- 旧シグネチャ (3引数) は削除してオーバーロードの曖昧さを防ぐ
DROP FUNCTION IF EXISTS public.rpc_eights_create_lobby(text, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.rpc_eights_create_lobby(p_title text, p_rate_cap integer DEFAULT NULL::integer, p_scheduled_at timestamptz DEFAULT NULL, p_private boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(trim(p_title)) < 1 THEN RAISE EXCEPTION 'タイトルを入力してください'; END IF;
  IF p_scheduled_at IS NOT NULL THEN
    IF p_scheduled_at <= now() THEN RAISE EXCEPTION '開催時刻は未来の時刻を指定してください'; END IF;
    IF p_scheduled_at > now() + interval '48 hours' THEN RAISE EXCEPTION '開催時刻は48時間以内で指定してください'; END IF;
  END IF;
  -- 多重ホストOK (例: 21時の予約開催 + 今すぐ開催)。乱立防止に3件まで
  -- (複数参加の解禁: eights_multi_join.sql)
  IF (SELECT count(*) FROM eights_lobbies WHERE host_user_id = v_uid AND status IN ('open','drafting')) >= 3 THEN
    RAISE EXCEPTION '同時に開催できるロビーは3件までです。先に解散するか、終了してから開催してください';
  END IF;

  INSERT INTO eights_lobbies (host_user_id, title, rate_cap, scheduled_at, is_private)
  VALUES (v_uid, trim(p_title), p_rate_cap, p_scheduled_at, coalesce(p_private, false))
  RETURNING id INTO v_lid;
  INSERT INTO eights_lobby_members (lobby_id, user_id, weapon_role) VALUES (v_lid, v_uid, 'FLEX');

  -- 告知 (ベストエフォート。失敗してもロビー作成は成功)
  IF NOT coalesce(p_private, false) THEN
    BEGIN
      PERFORM _eights_announce(v_lid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN json_build_object('ok', true, 'lobby_id', v_lid);
END;
$$;
