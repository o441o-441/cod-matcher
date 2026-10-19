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
