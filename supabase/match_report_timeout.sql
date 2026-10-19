-- ============================================================
-- 試合結果報告の承認フロー改善 (2026-10-19適用済み)
--   1. 自動確定の期限: 1時間 → 20分
--      (相手チーム全員が離席していても20分で次のプレイに進める)
--   2. 期限短縮: 「全員が報告画面を開いたら5分」→
--      「承認側 (報告していないチーム) の誰かが開いたら5分」
--   3. 報告時に相手チームへ通知 (サイト内 notifications +
--      Discord個人メンション。ranked_match_notify.sql と同じ経路)
-- rpc_missing_functions.sql 内の同名関数の定義は旧版。
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_submit_match_report(
  p_match_id uuid,
  p_winner_match_team_id uuid,
  p_score_summary text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_games_json jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_my_match_team_id uuid;
  v_match record;
  v_report_id uuid;
  v_game record;
  v_existing_pending uuid;
  v_opp_user_ids uuid[];
  v_mention_ids text[];
  v_link text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = v_uid;
  if v_my_match_team_id is null then raise exception 'このマッチの参加者ではありません'; end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match is null then raise exception 'マッチが見つかりません'; end if;
  if v_match.status = 'completed' then raise exception 'このマッチは既に完了しています'; end if;

  select id into v_existing_pending from public.match_reports where match_id = p_match_id and status = 'pending';
  if v_existing_pending is not null then raise exception '既に承認待ちのレポートがあります'; end if;

  if not exists (select 1 from public.match_teams where id = p_winner_match_team_id and match_id = p_match_id) then
    raise exception '無効な勝者チームです';
  end if;

  -- Reset report_visited_at so the shortening logic works correctly
  UPDATE public.match_team_members mtm
  SET report_visited_at = NULL
  FROM public.match_teams mt
  WHERE mt.id = mtm.match_team_id AND mt.match_id = p_match_id;

  insert into public.match_reports (match_id, submitted_by_user_id, submitted_by_match_team_id, status, winner_match_team_id, score_summary, notes, submitted_at, deadline_at)
  values (p_match_id, v_uid, v_my_match_team_id, 'pending', p_winner_match_team_id, p_score_summary, p_notes, now(), now() + interval '20 minutes')
  returning id into v_report_id;

  if jsonb_array_length(p_games_json) > 0 then
    for v_game in select * from jsonb_to_recordset(p_games_json) as x(game_number int, mode text, map_name text, winner_match_team_id uuid, was_played boolean) loop
      insert into public.match_report_games (report_id, game_number, mode, map_name, winner_match_team_id, was_played)
      values (v_report_id, v_game.game_number, v_game.mode, v_game.map_name, v_game.winner_match_team_id, coalesce(v_game.was_played, true));
    end loop;
  end if;

  update public.matches set status = 'report_pending' where id = p_match_id and status <> 'completed';
  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', 'match report submitted');

  -- ---- 相手チームへ通知 (失敗しても報告自体は成立させる) ----
  select array_agg(mtm.user_id) into v_opp_user_ids
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.match_team_id <> v_my_match_team_id;

  v_link := '/match/' || p_match_id || '/report';

  if v_opp_user_ids is not null then
    -- サイト内通知
    begin
      insert into notifications (user_id, type, body, link, is_read)
      select u, 'report_submitted',
             '📋 試合結果が報告されました。内容を確認してください (20分で自動確定)',
             v_link, false
      from unnest(v_opp_user_ids) as u;
    exception when others then null;
    end;

    -- Discord 個人メンション (#ランクマ通知、30分後に自動削除 — discord_notify_cleanup.sql)
    begin
      select array_agg(provider_id) into v_mention_ids
      from auth.identities
      where provider = 'discord' and user_id = any(v_opp_user_ids) and provider_id ~ '^\d+$';

      perform _discord_post_tracked('discord_ranked_webhook', jsonb_build_object(
        'content',
          coalesce((select string_agg('<@' || x || '>', ' ') from unnest(v_mention_ids) as x), '')
          || E'\n📋 **試合結果が報告されました。内容を確認してください (20分経過で自動確定)**',
        'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_mention_ids), '[]'::jsonb)),
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '📋 結果報告の確認',
          'url', 'https://ascent-esports.com' || v_link,
          'color', 16758528,
          'footer', jsonb_build_object('text', 'ASCENT · Ranked'),
          'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ))
      ), 30);
    exception when others then null;
    end;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_mark_report_visited(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_total integer;
  v_visited integer;
  v_opp_visited boolean := false;
  v_pending_report record;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  update public.match_team_members mtm
  set report_visited_at = coalesce(mtm.report_visited_at, now())
  from public.match_teams mt
  where mt.id = mtm.match_team_id and mt.match_id = p_match_id and mtm.user_id = v_uid;

  select count(*), count(mtm.report_visited_at) into v_total, v_visited
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id;

  select * into v_pending_report
  from public.match_reports
  where match_id = p_match_id and status = 'pending'
  order by submitted_at desc limit 1;

  if v_pending_report is not null then
    -- 承認するのは報告していない側のチーム。その誰かが報告画面を開いたら
    -- 期限を5分に短縮する (全員在席を待たない)
    select exists (
      select 1 from public.match_team_members mtm
      join public.match_teams mt on mt.id = mtm.match_team_id
      where mt.match_id = p_match_id
        and mtm.match_team_id <> v_pending_report.submitted_by_match_team_id
        and mtm.report_visited_at is not null
    ) into v_opp_visited;

    if v_opp_visited and v_pending_report.deadline_at > now() + interval '5 minutes' then
      update public.match_reports set deadline_at = now() + interval '5 minutes' where id = v_pending_report.id;
      insert into public.match_messages (match_id, sender_user_id, message_type, body)
      values (p_match_id, null, 'system', 'opponent on report page, deadline shortened to 5 min');
    end if;
  end if;

  return json_build_object('all_visited', (v_total > 0 and v_total = v_visited), 'total', v_total, 'visited', v_visited, 'opp_visited', v_opp_visited);
end;
$function$;
