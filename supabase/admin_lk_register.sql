-- ============================================================
-- 管理者用: LK動画解析のデータ登録 (2026-11-04)
--
-- ボード外の対戦 (外部チームとの対戦など) をLK解析でデータ化する
-- 管理者専用機能。UI: /admin/lk
--
-- (1) rpc_admin_lk_register_match
--     自チーム + 相手チーム名 (存在しなければ非表示のプレースホルダー
--     チームを自動作成: is_disbanded=true なので一覧/ランキングには
--     出ない) で scrim_matches を直接登録し、既存のLK解析フロー
--     (/custom/board/[matchId]) にそのまま乗せる。通知は飛ばない。
--
-- (2) スタッツ保存系RPCに管理者バイパスを追加
--     rpc_scrim_submit_game / rpc_scrim_delete_game /
--     rpc_scrim_submit_hp_timeline / rpc_scrim_delete_hp_timeline
--     (旧定義: scrim_scoreboards.sql / scrim_hp_timeline.sql)
-- ============================================================

-- ------------------------------------------------------------
-- 1) 対戦の登録 (管理者のみ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_lk_register_match(
  p_host_team_id uuid,
  p_opponent_name text,
  p_date date,
  p_slot_start int DEFAULT 32,   -- 21:00
  p_hp_maps int DEFAULT 6,
  p_snd_maps int DEFAULT 0,
  p_ovl_maps int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_opp_name text := trim(coalesce(p_opponent_name, ''));
  v_opp_id uuid;
  v_hp_min int; v_snd_min int; v_ovl_min int;
  v_len int;
  v_end int;
  v_match_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION '管理者のみ実行できます';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_host_team_id) THEN
    RAISE EXCEPTION '自チームが見つかりません';
  END IF;
  IF length(v_opp_name) < 1 OR length(v_opp_name) > 30 THEN
    RAISE EXCEPTION '相手チーム名は1〜30文字で入力してください';
  END IF;
  IF p_hp_maps < 0 OR p_hp_maps > 6 OR p_snd_maps < 0 OR p_snd_maps > 6 OR p_ovl_maps < 0 OR p_ovl_maps > 4
     OR (p_hp_maps + p_snd_maps + p_ovl_maps) = 0 THEN
    RAISE EXCEPTION 'モード構成が不正です';
  END IF;

  -- 相手チーム: 既存名があればそれを使用 (未解散優先)、無ければ
  -- 非表示のプレースホルダーチームを作成
  SELECT id INTO v_opp_id FROM teams WHERE name = v_opp_name ORDER BY is_disbanded, created_at LIMIT 1;
  IF v_opp_id IS NULL THEN
    INSERT INTO teams (name, owner_user_id, is_disbanded)
    VALUES (v_opp_name, v_uid, true)
    RETURNING id INTO v_opp_id;
  END IF;
  IF v_opp_id = p_host_team_id THEN RAISE EXCEPTION '自チームと相手チームが同じです'; END IF;

  SELECT minutes_per_map INTO v_hp_min FROM scrim_formats WHERE format = 'hp';
  SELECT minutes_per_map INTO v_snd_min FROM scrim_formats WHERE format = 'snd';
  SELECT minutes_per_map INTO v_ovl_min FROM scrim_formats WHERE format = 'ovl';
  v_hp_min := coalesce(v_hp_min, 15); v_snd_min := coalesce(v_snd_min, 20); v_ovl_min := coalesce(v_ovl_min, 15);
  v_len := (v_hp_min * p_hp_maps + 29) / 30 + (v_snd_min * p_snd_maps + 29) / 30 + (v_ovl_min * p_ovl_maps + 29) / 30;
  v_end := least(48, p_slot_start + greatest(1, v_len));
  IF p_slot_start < 0 OR p_slot_start > 47 THEN RAISE EXCEPTION '開始時刻が不正です'; END IF;

  BEGIN
    INSERT INTO scrim_matches (date, slot_start, slot_end, host_team_id, guest_team_id, hp_maps, snd_maps, ovl_maps, created_by)
    VALUES (p_date, p_slot_start, v_end, p_host_team_id, v_opp_id, p_hp_maps, p_snd_maps, p_ovl_maps, v_uid)
    RETURNING id INTO v_match_id;
  EXCEPTION WHEN unique_violation OR exclusion_violation THEN
    RAISE EXCEPTION 'この日付・時間帯には同じチームの対戦が既に登録されています。開始時刻を変えてください';
  END;

  RETURN json_build_object('ok', true, 'match_id', v_match_id, 'opponent_team_id', v_opp_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_admin_lk_register_match(uuid, text, date, int, int, int, int) TO authenticated;

-- ------------------------------------------------------------
-- 2) スタッツ保存系RPCに管理者バイパスを追加
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_submit_game(
  p_match_id uuid,
  p_game_no integer,
  p_mode text,
  p_map text,
  p_host_score integer,
  p_guest_score integer,
  p_duration_seconds integer,
  p_image_path text,
  p_players jsonb,
  p_host_slot text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
  v_gid uuid;
  v_p jsonb;
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_mode NOT IN ('hp', 'snd', 'ovl') THEN RAISE EXCEPTION 'モードが不正です'; END IF;
  IF p_game_no NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'ゲーム番号が不正です'; END IF;
  IF p_host_slot IS NOT NULL AND p_host_slot NOT IN ('team1', 'team2') THEN
    RAISE EXCEPTION '陣営が不正です';
  END IF;
  IF jsonb_typeof(p_players) <> 'array' OR jsonb_array_length(p_players) > 12 THEN
    RAISE EXCEPTION 'プレイヤーデータが不正です';
  END IF;

  SELECT * INTO v_m FROM scrim_matches WHERE id = p_match_id;
  IF v_m IS NULL THEN RAISE EXCEPTION '試合が見つかりません'; END IF;

  -- 参加メンバー or 管理者のみ提出可
  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ提出できます';
  END IF;

  DELETE FROM scrim_match_games WHERE match_id = p_match_id AND game_no = p_game_no;

  INSERT INTO scrim_match_games (match_id, game_no, mode, map, host_score, guest_score, duration_seconds, image_path, submitted_by, host_slot)
  VALUES (p_match_id, p_game_no, p_mode, nullif(trim(coalesce(p_map, '')), ''), p_host_score, p_guest_score, p_duration_seconds, p_image_path, v_uid, p_host_slot)
  RETURNING id INTO v_gid;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    IF coalesce(v_p->>'side', '') NOT IN ('host', 'guest') THEN CONTINUE; END IF;
    IF trim(coalesce(v_p->>'raw_name', '')) = '' THEN CONTINUE; END IF;
    INSERT INTO scrim_game_player_stats (game_id, side, raw_name, user_id, kills, deaths, assists, damage, stats)
    VALUES (
      v_gid,
      v_p->>'side',
      left(trim(v_p->>'raw_name'), 60),
      nullif(v_p->>'user_id', '')::uuid,
      nullif(v_p->>'kills', '')::int,
      nullif(v_p->>'deaths', '')::int,
      nullif(v_p->>'assists', '')::int,
      nullif(v_p->>'damage', '')::int,
      coalesce(v_p->'stats', '{}'::jsonb)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'game_id', v_gid, 'players', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_scrim_delete_game(p_game_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT m.* INTO v_m
  FROM scrim_match_games g JOIN scrim_matches m ON m.id = g.match_id
  WHERE g.id = p_game_id;
  IF v_m IS NULL THEN RAISE EXCEPTION 'ゲームが見つかりません'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ取り消しできます';
  END IF;

  DELETE FROM scrim_match_games WHERE id = p_game_id;
  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_scrim_submit_hp_timeline(
  p_game_id uuid,
  p_sample_interval numeric,
  p_rotation_method text,
  p_samples jsonb,
  p_rotations jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_rotation_method NOT IN ('hill', 'clock', 'assumed') THEN RAISE EXCEPTION '解析方式が不正です'; END IF;
  IF jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) > 1200 THEN
    RAISE EXCEPTION 'サンプルデータが不正です';
  END IF;
  IF jsonb_typeof(p_rotations) <> 'array' OR jsonb_array_length(p_rotations) > 80 THEN
    RAISE EXCEPTION 'ポイントデータが不正です';
  END IF;
  IF p_sample_interval IS NULL OR p_sample_interval <= 0 OR p_sample_interval > 60 THEN
    RAISE EXCEPTION 'サンプル間隔が不正です';
  END IF;

  SELECT m.* INTO v_m
  FROM scrim_match_games g JOIN scrim_matches m ON m.id = g.match_id
  WHERE g.id = p_game_id;
  IF v_m IS NULL THEN RAISE EXCEPTION 'ゲームが見つかりません'; END IF;
  SELECT g.mode INTO v_mode FROM scrim_match_games g WHERE g.id = p_game_id;
  IF v_mode <> 'hp' THEN RAISE EXCEPTION 'ハードポイントのゲームのみ保存できます'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ保存できます';
  END IF;

  INSERT INTO scrim_game_hp_timeline (game_id, sample_interval, rotation_method, samples, rotations, submitted_by)
  VALUES (p_game_id, p_sample_interval, p_rotation_method, p_samples, p_rotations, v_uid)
  ON CONFLICT (game_id) DO UPDATE SET
    sample_interval = EXCLUDED.sample_interval,
    rotation_method = EXCLUDED.rotation_method,
    samples = EXCLUDED.samples,
    rotations = EXCLUDED.rotations,
    submitted_by = EXCLUDED.submitted_by,
    created_at = now();

  RETURN json_build_object('ok', true, 'game_id', p_game_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_scrim_delete_hp_timeline(p_game_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT m.* INTO v_m
  FROM scrim_match_games g JOIN scrim_matches m ON m.id = g.match_id
  WHERE g.id = p_game_id;
  IF v_m IS NULL THEN RAISE EXCEPTION 'ゲームが見つかりません'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ取り消しできます';
  END IF;

  DELETE FROM scrim_game_hp_timeline WHERE game_id = p_game_id;
  RETURN json_build_object('ok', true);
END;
$$;
