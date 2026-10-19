-- ============================================================
-- ランクマッチのバンピック: 選出モードをハードポイント固定に
--
-- 旧仕様: セッション作成時に HP 6/9 / SND 2/9 / OVL 1/9 の
-- 重み付きランダムでモードを抽選していた。
-- rpc_missing_functions.sql 内の同名関数の定義は旧版なので、
-- このファイルが最新の正。
-- (大会のバンピックは rpc_tournament_start_banpick で別管理 — 変更なし)
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_create_banpick_session(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_alpha_team record;
  v_bravo_team record;
  v_existing_session_id uuid;
  v_selected_mode text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match is null then raise exception 'マッチが見つかりません'; end if;
  if v_match.status <> 'banpick' then raise exception 'このマッチはバンピック状態ではありません'; end if;

  if not exists (select 1 from public.match_team_members mtm join public.match_teams mt on mt.id = mtm.match_team_id where mt.match_id = p_match_id and mtm.user_id = v_uid) then
    raise exception 'このマッチの参加者ではありません';
  end if;

  select id into v_existing_session_id from public.banpick_sessions where match_id = p_match_id;
  if v_existing_session_id is not null then raise exception 'バンピックセッションは既に存在します'; end if;

  select * into v_alpha_team from public.match_teams where match_id = p_match_id and side = 'alpha';
  select * into v_bravo_team from public.match_teams where match_id = p_match_id and side = 'bravo';

  -- ランクマッチはハードポイント固定
  v_selected_mode := 'hp';

  insert into public.banpick_sessions (
    match_id, status, phase,
    current_turn_match_team_id, current_action_type,
    turn_number, selected_maps, deadline_at, last_action_at
  )
  values (
    p_match_id, 'in_progress', v_selected_mode,
    v_alpha_team.id, 'ban', 1,
    jsonb_build_object(
      v_selected_mode, jsonb_build_object('bans', '[]'::jsonb, 'map', null, 'side', null),
      'selected_mode', v_selected_mode,
      'team_a', v_alpha_team.id,
      'team_b', v_bravo_team.id
    ),
    now() + interval '5 minutes', now()
  );
end;
$function$;

-- ------------------------------------------------------------
-- 管理者のバンピックスキップもハードポイント固定にする
-- (旧: この関数内に独自の重み付き抽選 67/22/11 と古いマッププールが残っていた)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_skip_banpick(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_alpha_id uuid;
  v_bravo_id uuid;
  v_mode text := 'hp'; -- ランクマッチはハードポイント固定
  v_hp_maps text[] := ARRAY['酒','コロッサス','デン','スカー','グリッドロック','ハシエンダ'];
  v_map text;
  v_selected jsonb;
  v_existing_session_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION '管理者のみ実行可能です';
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match IS NULL THEN RAISE EXCEPTION 'マッチが見つかりません'; END IF;
  IF v_match.status <> 'banpick' THEN RAISE EXCEPTION 'バンピック中ではありません'; END IF;

  SELECT id INTO v_alpha_id FROM match_teams WHERE match_id = p_match_id AND side = 'alpha';
  SELECT id INTO v_bravo_id FROM match_teams WHERE match_id = p_match_id AND side = 'bravo';

  -- HPプールからランダムにマップを選ぶ
  v_map := v_hp_maps[1 + floor(random() * array_length(v_hp_maps, 1))::int];

  v_selected := jsonb_build_object(
    'team_a', v_alpha_id, 'team_b', v_bravo_id,
    'selected_mode', v_mode,
    v_mode, jsonb_build_object('bans', '[]'::jsonb, 'map', v_map, 'side', CASE WHEN random() < 0.5 THEN 'JSOC' ELSE 'ギルド' END)
  );

  SELECT id INTO v_existing_session_id FROM banpick_sessions WHERE match_id = p_match_id LIMIT 1;

  IF v_existing_session_id IS NOT NULL THEN
    UPDATE banpick_sessions
    SET status = 'completed', phase = 'completed', selected_maps = v_selected,
        completed_at = now(), deadline_at = NULL, last_action_at = now()
    WHERE id = v_existing_session_id;
  ELSE
    INSERT INTO banpick_sessions (match_id, status, phase, selected_maps, completed_at, last_action_at,
      current_turn_match_team_id, current_action_type, turn_number)
    VALUES (p_match_id, 'completed', 'completed', v_selected, now(), now(), NULL, NULL, 0);
  END IF;

  -- Auto-assign roles
  PERFORM _auto_assign_roles(p_match_id, v_mode);

  UPDATE matches SET status = 'ready', started_at = now() WHERE id = p_match_id;

  INSERT INTO match_messages (match_id, sender_user_id, message_type, body)
  VALUES (p_match_id, NULL, 'system', 'banpick skipped by admin (' || upper(v_mode) || ' / ' || v_map || ')');

  RETURN json_build_object('ok', true, 'mode', v_mode, 'map', v_map);
END;
$function$;
