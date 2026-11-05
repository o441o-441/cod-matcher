-- ============================================================
-- 交流戦ボード: 24時間スロット化 (2026-11-03)
--
-- 旧: 1日10スロット (slot 0 = 20:00 〜 slot 9 = 24:30)
-- 新: 1日48スロット (slot 0 = 05:00 〜 slot 47 = 翌04:30)
--   - 「日付 = その晩」の考え方は維持 (1日は 5:00〜翌4:59)。
--     深夜帯 (24:00〜28:30 表記) も同じ日付に属するため、
--     夜の対戦が日付をまたいでも1レコードで表現できる
--   - スロット→時刻: 5:00 + slot*30分。24時以降は 24:30/25:00…28:30 表記
--   - 既存データは一律 +30 シフトで移行 (旧 slot 0 = 20:00 → 新 slot 30)
--
-- 変更対象:
--   - CHECK制約: member_availability / scrim_matches / scrim_mixed_rooms
--   - データ移行: 上記3テーブル + scrim_templates.day_slots/slots
--   - 関数: _scrimboard_slot_label / rpc_scrimboard_set_availability(_for) /
--     rpc_scrimboard_save_template_days / rpc_scrimboard_room_create /
--     rpc_scrimboard_confirm / fn_scrim_match_reminder
-- フロント: app/custom/board/page.tsx (SLOT_COUNT=48, 21時周辺に自動スクロール)
-- ============================================================

-- ------------------------------------------------------------
-- 1) 制約の拡張
-- ------------------------------------------------------------
ALTER TABLE public.member_availability DROP CONSTRAINT IF EXISTS member_availability_slot_index_check;
ALTER TABLE public.member_availability ADD CONSTRAINT member_availability_slot_index_check CHECK (slot_index >= 0 AND slot_index <= 47);

ALTER TABLE public.scrim_matches DROP CONSTRAINT IF EXISTS scrim_matches_slot_start_check;
ALTER TABLE public.scrim_matches DROP CONSTRAINT IF EXISTS scrim_matches_slot_end_check;
ALTER TABLE public.scrim_matches ADD CONSTRAINT scrim_matches_slot_start_check CHECK (slot_start >= 0 AND slot_start <= 47);
ALTER TABLE public.scrim_matches ADD CONSTRAINT scrim_matches_slot_end_check CHECK (slot_end >= 1 AND slot_end <= 48);

ALTER TABLE public.scrim_mixed_rooms DROP CONSTRAINT IF EXISTS scrim_mixed_rooms_slot_start_check;
ALTER TABLE public.scrim_mixed_rooms DROP CONSTRAINT IF EXISTS scrim_mixed_rooms_slot_end_check;
ALTER TABLE public.scrim_mixed_rooms ADD CONSTRAINT scrim_mixed_rooms_slot_start_check CHECK (slot_start >= 0 AND slot_start <= 47);
ALTER TABLE public.scrim_mixed_rooms ADD CONSTRAINT scrim_mixed_rooms_slot_end_check CHECK (slot_end >= 1 AND slot_end <= 48);

-- ------------------------------------------------------------
-- 2) 既存データの移行 (一律 +30 = 20:00 基準 → 05:00 基準)
-- ------------------------------------------------------------
UPDATE public.member_availability SET slot_index = slot_index + 30 WHERE slot_index <= 9;
UPDATE public.scrim_matches SET slot_start = slot_start + 30, slot_end = slot_end + 30 WHERE slot_start <= 9;
UPDATE public.scrim_mixed_rooms SET slot_start = slot_start + 30, slot_end = slot_end + 30 WHERE slot_start <= 9;
UPDATE public.scrim_templates SET
  day_slots = (
    SELECT coalesce(jsonb_object_agg(key, new_arr), '{}'::jsonb)
    FROM (
      SELECT key, (SELECT jsonb_agg((e.x)::int + 30) FROM jsonb_array_elements_text(value) AS e(x)) AS new_arr
      FROM jsonb_each(day_slots)
    ) s
  ),
  slots = (SELECT coalesce(array_agg((x + 30)::smallint), '{}') FROM unnest(slots) AS x)
WHERE NOT EXISTS (SELECT 1 FROM unnest(slots) AS x WHERE x > 9); -- 二重移行防止

-- ------------------------------------------------------------
-- 3) スロット→時刻ラベル (05:00 基準。24時以降は 25:00 等の表記)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._scrimboard_slot_label(p_slot integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  select (5 + p_slot / 2)::text || ':' || case when p_slot % 2 = 0 then '00' else '30' end
$$;

-- ------------------------------------------------------------
-- 4) 空き時間の登録 (スロット上限 0..47)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_set_availability(p_date date, p_slots smallint[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_team_id uuid;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_slot smallint;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;

  select team_id into v_team_id from team_members where user_id = v_uid limit 1;
  if v_team_id is null then raise exception 'チームに所属していないため空き時間を登録できません'; end if;

  if p_date < v_today or p_date > v_today + 13 then
    raise exception '登録できるのは今日から2週間以内の日付です';
  end if;

  delete from member_availability
  where user_id = v_uid and team_id = v_team_id and date = p_date;

  foreach v_slot in array coalesce(p_slots, '{}')
  loop
    if v_slot < 0 or v_slot > 47 then raise exception '不正なスロットです'; end if;
    insert into member_availability (user_id, team_id, date, slot_index)
    values (v_uid, v_team_id, p_date, v_slot)
    on conflict do nothing;
  end loop;

  return json_build_object('ok', true);
end;
$$;

CREATE OR REPLACE FUNCTION public.rpc_scrimboard_set_availability_for(p_target_user_id uuid, p_date date, p_slots smallint[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_team_id uuid;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_slot smallint;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;

  select t.id into v_team_id
  from teams t
  join team_members tm on tm.team_id = t.id and tm.user_id = v_uid
  where t.owner_user_id = v_uid
  limit 1;
  if v_team_id is null then raise exception '代理入力はチームオーナーのみ可能です'; end if;

  if not exists (select 1 from team_members where team_id = v_team_id and user_id = p_target_user_id) then
    raise exception '対象ユーザーは同じチームのメンバーではありません';
  end if;

  if p_date < v_today or p_date > v_today + 13 then
    raise exception '登録できるのは今日から2週間以内の日付です';
  end if;

  delete from member_availability
  where user_id = p_target_user_id and team_id = v_team_id and date = p_date;

  foreach v_slot in array coalesce(p_slots, '{}')
  loop
    if v_slot < 0 or v_slot > 47 then raise exception '不正なスロットです'; end if;
    insert into member_availability (user_id, team_id, date, slot_index)
    values (p_target_user_id, v_team_id, p_date, v_slot)
    on conflict do nothing;
  end loop;

  return json_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------
-- 5) 曜日テンプレ保存 (スロット上限 0..47)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_save_template_days(p_day_slots jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_key text;
  v_val jsonb;
  v_el jsonb;
  v_slot int;
  v_clean jsonb := '{}'::jsonb;
  v_days boolean[] := array_fill(false, array[7]);
  v_all_slots smallint[] := '{}';
  v_applied int;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;
  if not exists (select 1 from team_members where user_id = v_uid) then
    raise exception 'チームに所属していないためテンプレを使えません';
  end if;
  if p_day_slots is null or jsonb_typeof(p_day_slots) <> 'object' then
    raise exception 'テンプレの形式が不正です';
  end if;

  for v_key, v_val in select * from jsonb_each(p_day_slots) loop
    if v_key not in ('0','1','2','3','4','5','6') then raise exception '曜日指定が不正です'; end if;
    if jsonb_typeof(v_val) <> 'array' then raise exception 'スロット指定が不正です'; end if;
    if jsonb_array_length(v_val) > 0 then
      for v_el in select jsonb_array_elements(v_val) loop
        v_slot := (v_el)::text::int;
        if v_slot < 0 or v_slot > 47 then raise exception '不正なスロットです'; end if;
        if not (v_slot::smallint = any(v_all_slots)) then v_all_slots := v_all_slots || v_slot::smallint; end if;
      end loop;
      v_clean := v_clean || jsonb_build_object(v_key, v_val);
      v_days[v_key::int + 1] := true;
    end if;
  end loop;

  if v_clean = '{}'::jsonb then
    delete from scrim_templates where user_id = v_uid;
    delete from scrim_template_applied where user_id = v_uid and date >= v_today;
    return json_build_object('ok', true, 'deleted', true);
  end if;

  insert into scrim_templates (user_id, days, slots, day_slots, updated_at)
  values (v_uid, v_days, v_all_slots, v_clean, now())
  on conflict (user_id) do update set days = excluded.days, slots = excluded.slots, day_slots = excluded.day_slots, updated_at = now();

  delete from scrim_template_applied where user_id = v_uid and date >= v_today;
  v_applied := _scrimboard_apply_template_for(v_uid, v_today, v_today + 13);

  return json_build_object('ok', true, 'applied_days', v_applied);
end;
$$;

-- ------------------------------------------------------------
-- 6) 混成ルーム作成 (スロット上限 0..47 / 48)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrimboard_room_create(p_name text, p_date date, p_slot_start integer, p_slot_end integer, p_note text DEFAULT NULL::text)
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
  IF p_slot_start < 0 OR p_slot_start > 47 OR p_slot_end < 1 OR p_slot_end > 48 OR p_slot_end <= p_slot_start THEN
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

-- ------------------------------------------------------------
-- 7) 成立RPC (スロット上限 48・「過ぎた枠」判定を 05:00 基準に)
--    旧定義: team_roster_modes.sql / mode_rename_hijack 適用分
-- ------------------------------------------------------------
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
  v_req int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF (p_target_team_id IS NULL) = (p_target_room_id IS NULL) THEN
    RAISE EXCEPTION '対戦相手の指定が不正です';
  END IF;

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

  -- ハーポ回し (HP6マップ) は特例で60分 (回し運用のため1マップあたりが短い)
  v_len := ((CASE WHEN p_hp_maps = 6 THEN 60 ELSE v_hp_min * p_hp_maps END) + 29) / 30
    + (v_snd_min * p_snd_maps + 29) / 30 + (v_ovl_min * p_ovl_maps + 29) / 30;
  IF v_len <= 0 THEN RAISE EXCEPTION 'モードが選択されていません'; END IF;

  v_end := p_slot_start + v_len;
  IF p_slot_start < 0 OR p_slot_start > 47 OR v_end > 48 THEN
    RAISE EXCEPTION 'この開始時刻には収まりません';
  END IF;
  IF p_date < v_today OR p_date > v_today + 13 THEN
    RAISE EXCEPTION '対象の日付が範囲外です';
  END IF;
  -- 当日は、開始時刻を30分以上過ぎた枠 (終了済みの枠) では成立不可
  -- (スロットは 05:00 基準。24時以降の枠は当日中は常に未来扱い)
  IF p_date = v_today
     AND (extract(hour FROM now() AT TIME ZONE 'Asia/Tokyo')::int * 60 + extract(minute FROM now() AT TIME ZONE 'Asia/Tokyo')::int)
         >= (5 * 60 + (p_slot_start + 1) * 30) THEN
    RAISE EXCEPTION 'この枠の開始時刻は過ぎています。現在時刻以降の枠を選んでください';
  END IF;

  IF p_target_team_id IS NOT NULL THEN
    SELECT * INTO v_prefs FROM scrim_team_prefs WHERE team_id = p_target_team_id;
    IF v_prefs IS NOT NULL THEN
      IF p_hp_maps > 0 AND NOT v_prefs.accept_hp THEN RAISE EXCEPTION '相手チームはハーポを受け付けていません'; END IF;
      IF p_snd_maps > 0 AND NOT v_prefs.accept_snd THEN RAISE EXCEPTION '相手チームはサーチを受け付けていません'; END IF;
      IF p_ovl_maps > 0 AND NOT v_prefs.accept_ovl THEN RAISE EXCEPTION '相手チームはハイジャックを受け付けていません'; END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(coalesce(p_target_team_id, p_target_room_id)::text));
  PERFORM pg_advisory_xact_lock(hashtext(coalesce(v_my_team_id, p_as_room_id)::text));

  -- 相手側の検証 (代表者のみ型チームは代表1人の予定で成立)
  IF p_target_team_id IS NOT NULL THEN
    SELECT CASE WHEN roster_mode = 'solo' THEN 1 ELSE 4 END INTO v_req
    FROM teams WHERE id = p_target_team_id;
    v_req := coalesce(v_req, 4);
    SELECT count(*) INTO v_ok_slots FROM (
      SELECT slot_index FROM member_availability
      WHERE team_id = p_target_team_id AND date = p_date
        AND slot_index >= p_slot_start AND slot_index < v_end
      GROUP BY slot_index HAVING count(*) >= v_req
    ) s;
    IF v_ok_slots < v_len THEN RAISE EXCEPTION '相手チームの空きが不足している枠があります。ボードを更新してください'; END IF;
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

  -- 自分側の検証 (代表者のみ型チームは代表1人の予定で成立)
  IF v_my_team_id IS NOT NULL THEN
    SELECT CASE WHEN roster_mode = 'solo' THEN 1 ELSE 4 END INTO v_req
    FROM teams WHERE id = v_my_team_id;
    v_req := coalesce(v_req, 4);
    SELECT count(*) INTO v_ok_slots FROM (
      SELECT slot_index FROM member_availability
      WHERE team_id = v_my_team_id AND date = p_date
        AND slot_index >= p_slot_start AND slot_index < v_end
      GROUP BY slot_index HAVING count(*) >= v_req
    ) s;
    IF v_ok_slots < v_len THEN RAISE EXCEPTION '自チームの空きが不足している枠があります。STEP1で空き時間を確認してください'; END IF;
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

  IF EXISTS (
    SELECT u FROM unnest(_scrimboard_side_users(p_target_team_id, p_target_room_id)) AS u
    INTERSECT
    SELECT u2 FROM unnest(_scrimboard_side_users(v_my_team_id, p_as_room_id)) AS u2
  ) THEN
    RAISE EXCEPTION '両サイドに同じプレイヤーが含まれています';
  END IF;

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
-- 8) 5分前リマインド (開始時刻の計算を 05:00 基準に。
--    24時以降のスロットは自動的に翌日の時刻になる)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_scrim_match_reminder()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_m record;
BEGIN
  FOR v_m IN
    SELECT id FROM scrim_matches
    WHERE status = 'confirmed'
      AND reminded_at IS NULL
      AND ((date::text || ' 05:00')::timestamp + (slot_start * interval '30 minutes')) AT TIME ZONE 'Asia/Tokyo'
          BETWEEN now() AND now() + interval '5 minutes'
  LOOP
    UPDATE scrim_matches SET reminded_at = now() WHERE id = v_m.id AND reminded_at IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    BEGIN
      PERFORM _scrimboard_notify(v_m.id, 'reminder');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
$$;
