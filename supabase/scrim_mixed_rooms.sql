-- ============================================================
-- 交流戦ボード: 混成ルーム (チームの垣根を越えた一時的な4人組)
--
-- チームの空き予定とは別に、「◯月◯日 この時間帯に混成でやりたい」
-- という使い捨てのルームを作り、誰でも参加できる (チーム所属不問)。
-- 4人以上集まったルームはボードにチームと同様の行として表示され、
-- 相手 (チーム or 混成ルーム) と通常の成立フローで対戦できる。
--
--   - ルームは単発: 1ルーム = 最大1対戦。成立で matched、
--     キャンセルで open に戻る。日付が過ぎたものは表示されない
--   - 1人が同じ日に参加できる open ルームは1つまで
--   - 定員5人 (4人+控え1人)
--   - ルームには Webhook が無いため、成立/キャンセル通知は
--     ルームメンバーへのサイト内通知で行う
-- ============================================================

-- ------------------------------------------------------------
-- 1) テーブル
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scrim_mixed_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  host_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  slot_start smallint NOT NULL CHECK (slot_start BETWEEN 0 AND 9),
  slot_end smallint NOT NULL CHECK (slot_end BETWEEN 1 AND 10),
  note text CHECK (char_length(note) <= 200),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start)
);

CREATE TABLE IF NOT EXISTS public.scrim_mixed_room_members (
  room_id uuid NOT NULL REFERENCES public.scrim_mixed_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scrim_mixed_rooms_date ON public.scrim_mixed_rooms (date) WHERE status = 'open';

ALTER TABLE public.scrim_mixed_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrim_mixed_room_members ENABLE ROW LEVEL SECURITY;

-- ルーム・メンバーは公開 (ボード表示に必要)。書き込みはRPCのみ。
DROP POLICY IF EXISTS scrim_mixed_rooms_select_all ON public.scrim_mixed_rooms;
CREATE POLICY scrim_mixed_rooms_select_all ON public.scrim_mixed_rooms FOR SELECT USING (true);
DROP POLICY IF EXISTS scrim_mixed_room_members_select_all ON public.scrim_mixed_room_members;
CREATE POLICY scrim_mixed_room_members_select_all ON public.scrim_mixed_room_members FOR SELECT USING (true);

-- ------------------------------------------------------------
-- 2) scrim_matches を「チーム or ルーム」両対応に拡張
-- ------------------------------------------------------------
ALTER TABLE public.scrim_matches ALTER COLUMN host_team_id DROP NOT NULL;
ALTER TABLE public.scrim_matches ALTER COLUMN guest_team_id DROP NOT NULL;
ALTER TABLE public.scrim_matches ADD COLUMN IF NOT EXISTS host_room_id uuid REFERENCES public.scrim_mixed_rooms(id);
ALTER TABLE public.scrim_matches ADD COLUMN IF NOT EXISTS guest_room_id uuid REFERENCES public.scrim_mixed_rooms(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scrim_matches_host_side') THEN
    ALTER TABLE public.scrim_matches ADD CONSTRAINT scrim_matches_host_side
      CHECK ((host_team_id IS NOT NULL)::int + (host_room_id IS NOT NULL)::int = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scrim_matches_guest_side') THEN
    ALTER TABLE public.scrim_matches ADD CONSTRAINT scrim_matches_guest_side
      CHECK ((guest_team_id IS NOT NULL)::int + (guest_room_id IS NOT NULL)::int = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scrim_matches_room_diff') THEN
    ALTER TABLE public.scrim_matches ADD CONSTRAINT scrim_matches_room_diff
      CHECK (host_room_id IS NULL OR guest_room_id IS NULL OR host_room_id <> guest_room_id);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3) 共有ヘルパー
-- ------------------------------------------------------------
-- サイド (チーム or ルーム) の表示名
CREATE OR REPLACE FUNCTION public._scrimboard_side_name(p_team_id uuid, p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  IF p_team_id IS NOT NULL THEN
    SELECT name INTO v_name FROM teams WHERE id = p_team_id;
    RETURN coalesce(v_name, '不明');
  END IF;
  SELECT name INTO v_name FROM scrim_mixed_rooms WHERE id = p_room_id;
  RETURN coalesce(v_name, '不明') || '【混成】';
END;
$$;

-- サイドの所属ユーザーID一覧
CREATE OR REPLACE FUNCTION public._scrimboard_side_users(p_team_id uuid, p_room_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_team_id IS NOT NULL THEN
    SELECT array_agg(user_id) INTO v_ids FROM team_members WHERE team_id = p_team_id;
  ELSIF p_room_id IS NOT NULL THEN
    SELECT array_agg(user_id) INTO v_ids FROM scrim_mixed_room_members WHERE room_id = p_room_id;
  END IF;
  RETURN coalesce(v_ids, '{}');
END;
$$;

-- ------------------------------------------------------------
-- 4) ルーム操作 RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_room_create(
  p_name text, p_date date, p_slot_start integer, p_slot_end integer, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_rid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF char_length(trim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'ルーム名は1〜30文字で入力してください'; END IF;
  IF p_date < v_today OR p_date > v_today + 13 THEN RAISE EXCEPTION '対象の日付が範囲外です'; END IF;
  IF p_slot_start < 0 OR p_slot_start > 9 OR p_slot_end < 1 OR p_slot_end > 10 OR p_slot_end <= p_slot_start THEN
    RAISE EXCEPTION '時間帯の指定が不正です';
  END IF;
  IF EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    JOIN scrim_mixed_rooms r ON r.id = rm.room_id
    WHERE rm.user_id = v_uid AND r.date = p_date AND r.status IN ('open', 'matched')
  ) THEN
    RAISE EXCEPTION 'この日は既に別の混成ルームに参加しています';
  END IF;

  INSERT INTO scrim_mixed_rooms (name, host_user_id, date, slot_start, slot_end, note)
  VALUES (trim(p_name), v_uid, p_date, p_slot_start, p_slot_end, nullif(trim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_rid;
  INSERT INTO scrim_mixed_room_members (room_id, user_id) VALUES (v_rid, v_uid);

  RETURN json_build_object('ok', true, 'room_id', v_rid);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_scrimboard_room_join(p_room_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room record;
  v_count int;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_room FROM scrim_mixed_rooms WHERE id = p_room_id;
  IF v_room IS NULL THEN RAISE EXCEPTION 'ルームが見つかりません'; END IF;
  IF v_room.status <> 'open' THEN RAISE EXCEPTION 'このルームは募集を終了しています'; END IF;
  IF v_room.date < v_today THEN RAISE EXCEPTION 'このルームの日付は過ぎています'; END IF;
  IF EXISTS (SELECT 1 FROM scrim_mixed_room_members WHERE room_id = p_room_id AND user_id = v_uid) THEN
    RAISE EXCEPTION '既にこのルームに参加しています';
  END IF;
  SELECT count(*) INTO v_count FROM scrim_mixed_room_members WHERE room_id = p_room_id;
  IF v_count >= 5 THEN RAISE EXCEPTION 'このルームは満員です (定員5人)'; END IF;
  IF EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    JOIN scrim_mixed_rooms r ON r.id = rm.room_id
    WHERE rm.user_id = v_uid AND r.date = v_room.date AND r.status IN ('open', 'matched')
  ) THEN
    RAISE EXCEPTION 'この日は既に別の混成ルームに参加しています';
  END IF;

  INSERT INTO scrim_mixed_room_members (room_id, user_id) VALUES (p_room_id, v_uid);
  RETURN json_build_object('ok', true, 'member_count', v_count + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_scrimboard_room_leave(p_room_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  SELECT * INTO v_room FROM scrim_mixed_rooms WHERE id = p_room_id;
  IF v_room IS NULL THEN RAISE EXCEPTION 'ルームが見つかりません'; END IF;
  IF NOT EXISTS (SELECT 1 FROM scrim_mixed_room_members WHERE room_id = p_room_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'このルームに参加していません';
  END IF;
  IF v_room.status = 'matched' THEN
    RAISE EXCEPTION '成立済みの対戦があるため抜けられません。先に試合ページから対戦をキャンセルしてください';
  END IF;

  IF v_room.host_user_id = v_uid THEN
    -- ホストが抜けたらルームごと解散
    UPDATE scrim_mixed_rooms SET status = 'cancelled' WHERE id = p_room_id;
    RETURN json_build_object('ok', true, 'disbanded', true);
  END IF;

  DELETE FROM scrim_mixed_room_members WHERE room_id = p_room_id AND user_id = v_uid;
  RETURN json_build_object('ok', true, 'disbanded', false);
END;
$$;

-- ------------------------------------------------------------
-- 5) 成立 RPC v2 (チーム/ルーム両対応)
--    旧シグネチャは削除してクライアントと同時切替
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_scrimboard_confirm(uuid, date, smallint, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.rpc_scrimboard_confirm(
  p_date date,
  p_slot_start smallint,
  p_hp_maps integer,
  p_snd_maps integer,
  p_ovl_maps integer,
  p_target_team_id uuid DEFAULT NULL,
  p_target_room_id uuid DEFAULT NULL,
  p_as_room_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_my_team_id uuid;
  v_as_room record;
  v_target_room record;
  v_hp_min int; v_snd_min int; v_ovl_min int;
  v_len int;
  v_end int;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_prefs record;
  v_ok_slots int;
  v_match_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF (p_target_team_id IS NULL) = (p_target_room_id IS NULL) THEN
    RAISE EXCEPTION '対戦相手の指定が不正です';
  END IF;

  -- 自分の立場: 混成ルーム or 自チーム
  IF p_as_room_id IS NOT NULL THEN
    SELECT * INTO v_as_room FROM scrim_mixed_rooms WHERE id = p_as_room_id;
    IF v_as_room IS NULL THEN RAISE EXCEPTION 'ルームが見つかりません'; END IF;
    IF NOT EXISTS (SELECT 1 FROM scrim_mixed_room_members WHERE room_id = p_as_room_id AND user_id = v_uid) THEN
      RAISE EXCEPTION 'このルームのメンバーのみ対戦を組めます';
    END IF;
  ELSE
    SELECT team_id INTO v_my_team_id FROM team_members WHERE user_id = v_uid LIMIT 1;
    IF v_my_team_id IS NULL THEN
      RAISE EXCEPTION 'チームに所属していないため対戦を組めません (混成ルームからも参加できます)';
    END IF;
  END IF;

  IF p_target_team_id IS NOT NULL AND p_target_team_id = v_my_team_id THEN RAISE EXCEPTION '自分のチームとは対戦できません'; END IF;
  IF p_target_room_id IS NOT NULL AND p_target_room_id = p_as_room_id THEN RAISE EXCEPTION '自分のルームとは対戦できません'; END IF;

  IF p_hp_maps < 0 OR p_hp_maps > 6 OR p_snd_maps < 0 OR p_snd_maps > 6 OR p_ovl_maps < 0 OR p_ovl_maps > 4 THEN
    RAISE EXCEPTION 'マップ数が不正です';
  END IF;

  SELECT minutes_per_map INTO v_hp_min FROM scrim_formats WHERE format = 'hp';
  SELECT minutes_per_map INTO v_snd_min FROM scrim_formats WHERE format = 'snd';
  SELECT minutes_per_map INTO v_ovl_min FROM scrim_formats WHERE format = 'ovl';
  v_hp_min := coalesce(v_hp_min, 15); v_snd_min := coalesce(v_snd_min, 20); v_ovl_min := coalesce(v_ovl_min, 15);

  v_len := (v_hp_min * p_hp_maps + 29) / 30 + (v_snd_min * p_snd_maps + 29) / 30 + (v_ovl_min * p_ovl_maps + 29) / 30;
  IF v_len <= 0 THEN RAISE EXCEPTION 'モードが選択されていません'; END IF;

  v_end := p_slot_start + v_len;
  IF p_slot_start < 0 OR p_slot_start > 9 OR v_end > 10 THEN
    RAISE EXCEPTION 'この開始時刻には収まりません';
  END IF;
  IF p_date < v_today OR p_date > v_today + 13 THEN
    RAISE EXCEPTION '対象の日付が範囲外です';
  END IF;
  -- 当日は、開始時刻を30分以上過ぎた枠 (終了済みの枠) では成立不可
  IF p_date = v_today
     AND (extract(hour FROM now() AT TIME ZONE 'Asia/Tokyo')::int * 60 + extract(minute FROM now() AT TIME ZONE 'Asia/Tokyo')::int)
         >= (20 * 60 + (p_slot_start + 1) * 30) THEN
    RAISE EXCEPTION 'この枠の開始時刻は過ぎています。現在時刻以降の枠を選んでください';
  END IF;

  -- 受付モード (相手がチームの場合のみ。ルームは時間帯で意思表示済み)
  IF p_target_team_id IS NOT NULL THEN
    SELECT * INTO v_prefs FROM scrim_team_prefs WHERE team_id = p_target_team_id;
    IF v_prefs IS NOT NULL THEN
      IF p_hp_maps > 0 AND NOT v_prefs.accept_hp THEN RAISE EXCEPTION '相手チームはハーポを受け付けていません'; END IF;
      IF p_snd_maps > 0 AND NOT v_prefs.accept_snd THEN RAISE EXCEPTION '相手チームはサーチを受け付けていません'; END IF;
      IF p_ovl_maps > 0 AND NOT v_prefs.accept_ovl THEN RAISE EXCEPTION '相手チームはオバロを受け付けていません'; END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(coalesce(p_target_team_id, p_target_room_id)::text));
  PERFORM pg_advisory_xact_lock(hashtext(coalesce(v_my_team_id, p_as_room_id)::text));

  -- 相手側の検証
  IF p_target_team_id IS NOT NULL THEN
    SELECT count(*) INTO v_ok_slots FROM (
      SELECT slot_index FROM member_availability
      WHERE team_id = p_target_team_id AND date = p_date
        AND slot_index >= p_slot_start AND slot_index < v_end
      GROUP BY slot_index HAVING count(*) >= 4
    ) s;
    IF v_ok_slots < v_len THEN RAISE EXCEPTION '相手チームの空きが4人未満の枠があります。ボードを更新してください'; END IF;
  ELSE
    SELECT * INTO v_target_room FROM scrim_mixed_rooms WHERE id = p_target_room_id;
    IF v_target_room IS NULL THEN RAISE EXCEPTION '相手のルームが見つかりません'; END IF;
    IF v_target_room.status <> 'open' THEN RAISE EXCEPTION 'この混成ルームは他の対戦が先に成立しています。ボードを更新してください'; END IF;
    IF v_target_room.date <> p_date THEN RAISE EXCEPTION 'ルームの日付が一致しません'; END IF;
    IF v_target_room.slot_start > p_slot_start OR v_target_room.slot_end < v_end THEN
      RAISE EXCEPTION '相手ルームの時間帯に収まりません';
    END IF;
    IF (SELECT count(*) FROM scrim_mixed_room_members WHERE room_id = p_target_room_id) < 4 THEN
      RAISE EXCEPTION '相手ルームのメンバーが4人未満です';
    END IF;
  END IF;

  -- 自分側の検証
  IF v_my_team_id IS NOT NULL THEN
    SELECT count(*) INTO v_ok_slots FROM (
      SELECT slot_index FROM member_availability
      WHERE team_id = v_my_team_id AND date = p_date
        AND slot_index >= p_slot_start AND slot_index < v_end
      GROUP BY slot_index HAVING count(*) >= 4
    ) s;
    IF v_ok_slots < v_len THEN RAISE EXCEPTION '自チームの空きが4人未満の枠があります。STEP1で空き時間を確認してください'; END IF;
  ELSE
    IF v_as_room.status <> 'open' THEN RAISE EXCEPTION '自分のルームは既に対戦が成立しています'; END IF;
    IF v_as_room.date <> p_date THEN RAISE EXCEPTION '自分のルームの日付が一致しません'; END IF;
    IF v_as_room.slot_start > p_slot_start OR v_as_room.slot_end < v_end THEN
      RAISE EXCEPTION '自分のルームの時間帯に収まりません';
    END IF;
    IF (SELECT count(*) FROM scrim_mixed_room_members WHERE room_id = p_as_room_id) < 4 THEN
      RAISE EXCEPTION '自分のルームのメンバーが4人未満です';
    END IF;
  END IF;

  -- 両サイドに同じプレイヤーが含まれていないか
  IF EXISTS (
    SELECT u FROM unnest(_scrimboard_side_users(p_target_team_id, p_target_room_id)) AS u
    INTERSECT
    SELECT u2 FROM unnest(_scrimboard_side_users(v_my_team_id, p_as_room_id)) AS u2
  ) THEN
    RAISE EXCEPTION '両サイドに同じプレイヤーが含まれています';
  END IF;

  -- チーム側の枠重複 (ルームは status で単発を保証)
  IF EXISTS (
    SELECT 1 FROM scrim_matches m
    WHERE m.status = 'confirmed' AND m.date = p_date
      AND (
        (v_my_team_id IS NOT NULL AND (m.host_team_id = v_my_team_id OR m.guest_team_id = v_my_team_id))
        OR (p_target_team_id IS NOT NULL AND (m.host_team_id = p_target_team_id OR m.guest_team_id = p_target_team_id))
      )
      AND int4range(m.slot_start::int, m.slot_end::int) && int4range(p_slot_start::int, v_end)
  ) THEN
    RAISE EXCEPTION 'この枠は他の対戦が先に成立しています。ボードを更新してください';
  END IF;

  -- ルームを matched に (原子的ガード)
  IF p_target_room_id IS NOT NULL THEN
    UPDATE scrim_mixed_rooms SET status = 'matched' WHERE id = p_target_room_id AND status = 'open';
    IF NOT FOUND THEN RAISE EXCEPTION 'この混成ルームは他の対戦が先に成立しています。ボードを更新してください'; END IF;
  END IF;
  IF p_as_room_id IS NOT NULL THEN
    UPDATE scrim_mixed_rooms SET status = 'matched' WHERE id = p_as_room_id AND status = 'open';
    IF NOT FOUND THEN RAISE EXCEPTION '自分のルームは既に対戦が成立しています'; END IF;
  END IF;

  BEGIN
    INSERT INTO scrim_matches (date, slot_start, slot_end, host_team_id, host_room_id, guest_team_id, guest_room_id, hp_maps, snd_maps, ovl_maps, created_by)
    VALUES (p_date, p_slot_start, v_end, p_target_team_id, p_target_room_id, v_my_team_id, p_as_room_id, p_hp_maps, p_snd_maps, p_ovl_maps, v_uid)
    RETURNING id INTO v_match_id;
  EXCEPTION WHEN unique_violation OR exclusion_violation THEN
    RAISE EXCEPTION 'この枠は他の対戦が先に成立しています。ボードを更新してください';
  END;

  BEGIN
    PERFORM _scrimboard_notify(v_match_id, 'confirmed');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN json_build_object('ok', true, 'match_id', v_match_id);
END;
$$;

-- ------------------------------------------------------------
-- 6) 通知 v2: チーム側は Webhook、ルーム側はメンバーへサイト内通知
-- ------------------------------------------------------------
-- ※ 最新定義は scrim_match_reminder.sql ('reminder' イベント + チームメンバーへのサイト内通知を追加)
CREATE OR REPLACE FUNCTION public._scrimboard_notify(p_match_id uuid, p_event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_m record;
  v_host_name text;
  v_guest_name text;
  v_host_wh text;
  v_guest_wh text;
  v_host_contact text;
  v_guest_contact text;
  v_host_mentions text[];
  v_guest_mentions text[];
  v_label text;
  v_when text;
  v_page text;
  v_content_host text;
  v_content_guest text;
  v_site_body text;
begin
  select * into v_m from scrim_matches where id = p_match_id;
  if v_m is null then return; end if;

  v_host_name := _scrimboard_side_name(v_m.host_team_id, v_m.host_room_id);
  v_guest_name := _scrimboard_side_name(v_m.guest_team_id, v_m.guest_room_id);
  if v_m.host_team_id is not null then
    select discord_webhook_url into v_host_wh from team_settings where team_id = v_m.host_team_id;
    select public_contact into v_host_contact from scrim_team_prefs where team_id = v_m.host_team_id;
    -- チームメンバーの個人メンション用 Discord ID
    select array_agg(i.provider_id) into v_host_mentions
    from team_members tm
    join auth.identities i on i.user_id = tm.user_id and i.provider = 'discord'
    where tm.team_id = v_m.host_team_id and i.provider_id ~ '^\d+$';
  end if;
  if v_m.guest_team_id is not null then
    select discord_webhook_url into v_guest_wh from team_settings where team_id = v_m.guest_team_id;
    select public_contact into v_guest_contact from scrim_team_prefs where team_id = v_m.guest_team_id;
    select array_agg(i.provider_id) into v_guest_mentions
    from team_members tm
    join auth.identities i on i.user_id = tm.user_id and i.provider = 'discord'
    where tm.team_id = v_m.guest_team_id and i.provider_id ~ '^\d+$';
  end if;

  v_label := _scrimboard_format_label(v_m.hp_maps, v_m.snd_maps, v_m.ovl_maps);
  v_when := to_char(v_m.date, 'MM/DD') || ' ' || _scrimboard_slot_label(v_m.slot_start)
    || ' – ' || _scrimboard_slot_label(v_m.slot_end);
  v_page := 'https://ascent-esports.com/custom/board/' || v_m.id;

  if p_event = 'confirmed' then
    v_content_host := '⚔️ **交流戦が成立しました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ホスト決め・ロビーコード共有は試合ページで: ' || v_page
      || case when v_guest_contact is not null then E'\n' || '相手チームの連絡先: ' || v_guest_contact else '' end;
    v_content_guest := '⚔️ **交流戦が成立しました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ホスト決め・ロビーコード共有は試合ページで: ' || v_page
      || case when v_host_contact is not null then E'\n' || '相手チームの連絡先: ' || v_host_contact else '' end;
    v_site_body := '⚔️ 交流戦が成立しました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || ' · ' || v_label || '）';
  else
    v_content_host := '⚠️ **交流戦がキャンセルされました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || '枠はボードに戻りました: https://ascent-esports.com/custom/board';
    v_content_guest := v_content_host;
    v_site_body := '⚠️ 交流戦がキャンセルされました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || '）';
  end if;

  -- チーム側: Webhook (自チームのメンバー全員をメンション)
  if v_host_wh is not null and v_host_wh like 'https://discord.com/api/webhooks/%' then
    begin
      perform net.http_post(
        url := v_host_wh,
        body := jsonb_build_object(
          'username', 'ASCENT 交流戦ボード',
          'content',
            coalesce((select string_agg('<@' || x || '>', ' ') from unnest(v_host_mentions) as x) || E'\n', '')
            || v_content_host,
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_host_mentions), '[]'::jsonb))
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end if;
  if v_guest_wh is not null and v_guest_wh like 'https://discord.com/api/webhooks/%' then
    begin
      perform net.http_post(
        url := v_guest_wh,
        body := jsonb_build_object(
          'username', 'ASCENT 交流戦ボード',
          'content',
            coalesce((select string_agg('<@' || x || '>', ' ') from unnest(v_guest_mentions) as x) || E'\n', '')
            || v_content_guest,
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_guest_mentions), '[]'::jsonb))
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end if;

  -- ルーム側: メンバーへサイト内通知
  begin
    insert into notifications (user_id, type, body, link, is_read)
    select rm.user_id, 'scrim_match', v_site_body, '/custom/board/' || v_m.id, false
    from scrim_mixed_room_members rm
    where rm.room_id in (v_m.host_room_id, v_m.guest_room_id);
  exception when others then null;
  end;
end;
$$;

-- ------------------------------------------------------------
-- 7) キャンセル v2 (ルーム対応: ルームを open に戻す)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_cancel(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_m record;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;

  select * into v_m from scrim_matches where id = p_match_id;
  if v_m is null then raise exception '対戦が見つかりません'; end if;
  if v_m.status <> 'confirmed' then raise exception 'この対戦はすでにキャンセル済みか終了しています'; end if;

  if not exists (
    select 1 from team_members tm
    where tm.user_id = v_uid and tm.team_id in (v_m.host_team_id, v_m.guest_team_id)
  ) and not exists (
    select 1 from scrim_mixed_room_members rm
    where rm.user_id = v_uid and rm.room_id in (v_m.host_room_id, v_m.guest_room_id)
  ) then
    raise exception 'この対戦の参加メンバーのみキャンセルできます';
  end if;

  update scrim_matches
  set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now()
  where id = p_match_id;

  -- ルームは募集中に戻す
  if v_m.host_room_id is not null then
    update scrim_mixed_rooms set status = 'open' where id = v_m.host_room_id and status = 'matched';
  end if;
  if v_m.guest_room_id is not null then
    update scrim_mixed_rooms set status = 'open' where id = v_m.guest_room_id and status = 'matched';
  end if;

  begin
    perform _scrimboard_notify(p_match_id, 'cancelled');
  exception when others then null;
  end;

  return json_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------
-- 8) チャット送信 v2 + 閲覧RLS (ルームメンバーも対象に)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_send_message(p_match_id uuid, p_body text, p_type text DEFAULT 'text'::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_m record;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;
  if p_type not in ('text','lobby_code') then raise exception '不正なメッセージ種別です'; end if;
  if p_body is null or char_length(trim(p_body)) = 0 then raise exception 'メッセージを入力してください'; end if;
  if char_length(p_body) > 500 then raise exception 'メッセージは500文字以内にしてください'; end if;

  select * into v_m from scrim_matches where id = p_match_id;
  if v_m is null then raise exception '試合が見つかりません'; end if;
  if v_m.status <> 'confirmed' then raise exception 'この試合はキャンセル済みか終了しています'; end if;

  if not exists (
    select 1 from team_members tm
    where tm.user_id = v_uid and tm.team_id in (v_m.host_team_id, v_m.guest_team_id)
  ) and not exists (
    select 1 from scrim_mixed_room_members rm
    where rm.user_id = v_uid and rm.room_id in (v_m.host_room_id, v_m.guest_room_id)
  ) then
    raise exception 'この試合の参加メンバーのみ送信できます';
  end if;

  insert into scrim_match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, v_uid, p_type, trim(p_body));

  return json_build_object('ok', true);
end;
$$;

DROP POLICY IF EXISTS scrim_match_messages_select_members ON public.scrim_match_messages;
CREATE POLICY scrim_match_messages_select_members ON public.scrim_match_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM scrim_matches m
      JOIN team_members tm ON (tm.team_id = m.host_team_id OR tm.team_id = m.guest_team_id)
      WHERE m.id = scrim_match_messages.match_id AND tm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM scrim_matches m
      JOIN scrim_mixed_room_members rm ON (rm.room_id = m.host_room_id OR rm.room_id = m.guest_room_id)
      WHERE m.id = scrim_match_messages.match_id AND rm.user_id = auth.uid()
    )
  );
