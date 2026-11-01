-- ============================================================
-- チーム運用モード: メンバー登録型 / 代表者のみ型 (2026-11-01)
--
-- チームの運用方法を2種類にする:
--   'members' (既存) : メンバー4人をASCENTに登録し、各自が予定入力
--   'solo'   (新規) : 代表1人だけ登録。残りメンバーはゲームIDの
--                     テキスト登録のみ (ASCENT登録不要)。
--                     代表1人の予定入力が4人分として扱われる。
-- どちらのモードでも交流戦ボードと大会参加が可能。
--
-- 仕組み:
--   - teams.roster_mode ('members' | 'solo') と teams.guest_game_ids (text[])
--   - 枠数集計は scrim_slot_counts ビューで solo チームを常に 4 として返す
--     → ボードUI・X投稿bot は無変更で両対応になる
--   - member_availability を直接数える rpc_scrimboard_confirm のみ
--     必要人数を roster_mode で切替 (solo=1 / members=4)
--   - solo チームへの参加/招待は禁止 (人数の二重カウント防止)
--   - 大会エントリーは solo チームなら「代表+ゲストID3人以上」でOK
--     (member_snapshot にゲストIDも記録。user_id は null なので
--      _tournament_entry_user_ids の通知ファンアウトは代表のみに届く)
--
-- 本ファイルは以下を上書きする (旧定義は supabase/scrim_mixed_rooms.sql):
--   - rpc_scrimboard_confirm
-- ============================================================

-- ------------------------------------------------------------
-- 1) スキーマ
-- ------------------------------------------------------------
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS roster_mode text NOT NULL DEFAULT 'members'
    CHECK (roster_mode IN ('members', 'solo')),
  ADD COLUMN IF NOT EXISTS guest_game_ids text[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- 2) ゲストID検証ヘルパー (トリム・空除去・件数/長さチェック)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._team_clean_guest_ids(p_guest_ids text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text[];
BEGIN
  -- トリム・空除去・重複除去 (入力順を保持)
  SELECT coalesce(array_agg(g ORDER BY ord), '{}') INTO v_clean
  FROM (
    SELECT min(ord) AS ord, g
    FROM (
      SELECT row_number() OVER () AS ord, trim(x) AS g
      FROM unnest(coalesce(p_guest_ids, '{}')) AS x
    ) raw
    WHERE g <> ''
    GROUP BY g
  ) t;
  IF array_length(v_clean, 1) IS NULL OR array_length(v_clean, 1) < 3 THEN
    RAISE EXCEPTION 'メンバーのゲームIDを3人分以上登録してください';
  END IF;
  IF array_length(v_clean, 1) > 6 THEN
    RAISE EXCEPTION 'ゲームIDの登録は最大6人分までです';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_clean) AS g WHERE length(g) > 40) THEN
    RAISE EXCEPTION 'ゲームIDは40文字以内で入力してください';
  END IF;
  RETURN v_clean;
END;
$$;

-- ------------------------------------------------------------
-- 3) 代表者のみ型チームの作成
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_solo_team(p_team_name text, p_guest_ids text[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := trim(coalesce(p_team_name, ''));
  v_clean text[];
  v_team_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 30 THEN
    RAISE EXCEPTION 'チーム名は2〜30文字で入力してください';
  END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE user_id = v_uid) THEN
    RAISE EXCEPTION '既にチームに所属しています';
  END IF;
  IF EXISTS (SELECT 1 FROM teams WHERE name = v_name AND is_disbanded = false) THEN
    RAISE EXCEPTION '同名のチームが既に存在します';
  END IF;

  v_clean := _team_clean_guest_ids(p_guest_ids);

  INSERT INTO teams (name, owner_user_id, roster_mode, guest_game_ids)
  VALUES (v_name, v_uid, 'solo', v_clean)
  RETURNING id INTO v_team_id;

  INSERT INTO team_members (team_id, user_id, role)
  VALUES (v_team_id, v_uid, 'owner');

  RETURN json_build_object('ok', true, 'team_id', v_team_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_create_solo_team(text, text[]) TO authenticated;

-- ------------------------------------------------------------
-- 4) ゲストIDの更新 (オーナーのみ・soloチームのみ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_update_guest_ids(p_team_id uuid, p_guest_ids text[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team record;
  v_clean text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT * INTO v_team FROM teams WHERE id = p_team_id;
  IF v_team IS NULL OR v_team.is_disbanded THEN RAISE EXCEPTION 'チームが見つかりません'; END IF;
  IF v_team.owner_user_id <> v_uid THEN RAISE EXCEPTION 'チームオーナーのみ変更できます'; END IF;
  IF v_team.roster_mode <> 'solo' THEN RAISE EXCEPTION '代表者のみ型チームのみゲームIDを登録できます'; END IF;

  v_clean := _team_clean_guest_ids(p_guest_ids);

  UPDATE teams SET guest_game_ids = v_clean, updated_at = now() WHERE id = p_team_id;
  RETURN json_build_object('ok', true, 'guest_game_ids', v_clean);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_update_guest_ids(uuid, text[]) TO authenticated;

-- ------------------------------------------------------------
-- 5) soloチームへの参加・招待を禁止
--    (旧定義はDBのみ。メンバー上限チェック等は従来どおり)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_team_atomic(p_team_id uuid, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team record;
  v_existing uuid;
  v_member_count int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_uid <> p_user_id THEN RAISE EXCEPTION '自分自身のみ参加できます'; END IF;

  SELECT * INTO v_team FROM teams WHERE id = p_team_id;
  IF v_team IS NULL OR v_team.is_disbanded THEN RAISE EXCEPTION 'チームが見つかりません'; END IF;
  IF v_team.roster_mode = 'solo' THEN
    RAISE EXCEPTION 'このチームは代表者のみ型のため参加できません';
  END IF;

  -- Check user not already in a team
  SELECT team_id INTO v_existing FROM team_members WHERE user_id = v_uid LIMIT 1;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION '既にチームに所属しています'; END IF;

  -- Check member cap (max 5)
  SELECT count(*) INTO v_member_count FROM team_members WHERE team_id = p_team_id;
  IF v_member_count >= 5 THEN RAISE EXCEPTION 'チームは最大5人までです'; END IF;

  INSERT INTO team_members (team_id, user_id, role)
  VALUES (p_team_id, v_uid, 'member');

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_team_invite(p_target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_team record;
  v_member_count int;
  v_target_name text;
  v_invite_id uuid;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;

  select t.* into v_team from teams t where t.owner_user_id = v_uid and t.is_disbanded = false limit 1;
  if v_team is null then raise exception '招待の送信はチームオーナーのみ可能です'; end if;
  if v_team.roster_mode = 'solo' then
    raise exception '代表者のみ型チームにはメンバーを招待できません (ゲームIDで登録してください)';
  end if;
  if p_target_user_id = v_uid then raise exception '自分自身は招待できません'; end if;

  if exists (select 1 from team_members where user_id = p_target_user_id) then
    raise exception '対象ユーザーは既にチームに所属しています';
  end if;

  select count(*) into v_member_count from team_members where team_id = v_team.id;
  if v_member_count >= 5 then raise exception 'チームは最大5人までです'; end if;

  if exists (select 1 from team_invites where team_id = v_team.id and invitee_user_id = p_target_user_id and status = 'pending') then
    raise exception 'このユーザーには招待を送信済みです (承認待ち)';
  end if;

  insert into team_invites (team_id, inviter_user_id, invitee_user_id)
  values (v_team.id, v_uid, p_target_user_id)
  returning id into v_invite_id;

  select display_name into v_target_name from profiles where id = p_target_user_id;

  insert into notifications (user_id, type, body, link, is_read)
  values (
    p_target_user_id,
    'team_invite',
    'チーム「' || v_team.name || '」から招待が届きました。参加ページで承認できます',
    '/team/join',
    false
  );

  return json_build_object('ok', true, 'invite_id', v_invite_id);
end;
$$;

CREATE OR REPLACE FUNCTION public.rpc_team_invite_respond(p_invite_id uuid, p_accept boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_inv record;
  v_team record;
  v_member_count int;
  v_my_name text;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;

  select * into v_inv from team_invites where id = p_invite_id;
  if v_inv is null then raise exception '招待が見つかりません'; end if;
  if v_inv.invitee_user_id <> v_uid then raise exception 'この招待の宛先ではありません'; end if;
  if v_inv.status <> 'pending' then raise exception 'この招待はすでに処理済みです'; end if;

  if not p_accept then
    update team_invites set status = 'rejected', responded_at = now() where id = p_invite_id;
    return json_build_object('ok', true, 'accepted', false);
  end if;

  select * into v_team from teams where id = v_inv.team_id;
  if v_team is null or v_team.is_disbanded then raise exception 'チームが見つかりません (解散済みの可能性があります)'; end if;
  if v_team.roster_mode = 'solo' then
    raise exception 'このチームは代表者のみ型に変更されたため参加できません';
  end if;

  if exists (select 1 from team_members where user_id = v_uid) then
    raise exception '既にチームに所属しています。先に脱退してください';
  end if;

  select count(*) into v_member_count from team_members where team_id = v_inv.team_id;
  if v_member_count >= 5 then raise exception 'チームが満員です (最大5人)'; end if;

  insert into team_members (team_id, user_id, role) values (v_inv.team_id, v_uid, 'member');
  update team_invites set status = 'accepted', responded_at = now() where id = p_invite_id;

  select display_name into v_my_name from profiles where id = v_uid;
  insert into notifications (user_id, type, body, link, is_read)
  values (
    v_inv.inviter_user_id,
    'team_invite_accepted',
    coalesce(v_my_name, 'メンバー') || ' さんがチーム招待を承認しました',
    '/team/' || v_inv.team_id,
    false
  );

  return json_build_object('ok', true, 'accepted', true, 'team_id', v_inv.team_id);
end;
$$;

-- ------------------------------------------------------------
-- 6) 枠数集計ビュー: soloチームは予定が入っていれば常に4人扱い
--    (ボードUI / X投稿bot はこのビュー経由なので自動で両対応)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.scrim_slot_counts AS
SELECT ma.team_id, ma.date, ma.slot_index,
  (CASE WHEN t.roster_mode = 'solo' THEN 4 ELSE count(*) END)::integer AS available,
  round(avg(p.current_rating))::integer AS avg_rating,
  min(p.current_rating) AS min_rating,
  max(p.current_rating) AS max_rating
FROM member_availability ma
LEFT JOIN profiles p ON p.id = ma.user_id
JOIN teams t ON t.id = ma.team_id
GROUP BY ma.team_id, ma.date, ma.slot_index, t.roster_mode;

-- ------------------------------------------------------------
-- 7) 成立RPC: 必要人数を roster_mode で切替 (solo=1 / members=4)
--    旧定義: supabase/scrim_mixed_rooms.sql (このファイルが正)
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
