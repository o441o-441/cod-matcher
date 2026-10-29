-- ============================================================
-- 運営用: ランクマッチ監視 + 無効試合化 (2026-10-29、本番適用済み)
--   - rpc_admin_ranked_overview: 待機状況 / 進行中 / 直近完了10件をJSONで返す
--   - rpc_admin_void_match: 不具合試合を無効化。適用済みレートの逆適用・
--     履歴削除・連勝再計算・バンピック/報告のクローズ・パーティ解放まで行う
-- 利用側: /admin/ranked ページ
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_ranked_overview()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception '管理者のみ実行可能です';
  end if;
  return json_build_object(
    'queue', coalesce((
      select json_agg(q.* order by q.wait_sec desc) from (
        select qe.id, qe.party_size, qe.avg_rating, qe.party_size_bonus,
          extract(epoch from (now() - qe.created_at))::int as wait_sec,
          extract(epoch from (now() - qe.last_heartbeat))::int as heartbeat_age_sec,
          (select string_agg(p.display_name, '・' order by p.display_name)
             from queue_entry_members qem join profiles p on p.id = qem.user_id
            where qem.queue_entry_id = qe.id) as members
        from queue_entries qe
        where qe.status = 'waiting' and qe.queue_type = 'ranked'
      ) q
    ), '[]'::json),
    'active', coalesce((
      select json_agg(a.* order by a.matched_at desc) from (
        select m.id, m.status, m.matched_at,
          extract(epoch from (now() - m.matched_at))::int as elapsed_sec,
          (select bs.deadline_at from banpick_sessions bs where bs.match_id = m.id and bs.status = 'in_progress') as banpick_deadline,
          (select mr.deadline_at from match_reports mr where mr.match_id = m.id and mr.status = 'pending' order by mr.submitted_at desc limit 1) as report_deadline,
          (select json_agg(json_build_object(
              'side', mt.side,
              'effective', mt.effective_avg_rating,
              'members', (select string_agg(p.display_name, '・' order by p.display_name)
                            from match_team_members mtm join profiles p on p.id = mtm.user_id
                           where mtm.match_team_id = mt.id)
            ) order by mt.side)
           from match_teams mt where mt.match_id = m.id) as teams
        from matches m
        where m.status not in ('completed', 'cancelled')
      ) a
    ), '[]'::json),
    'recent', coalesce((
      select json_agg(r.* order by r.completed_at desc) from (
        select m.id, m.approval_status, m.completed_at,
          (select string_agg(p.display_name, '・' order by p.display_name)
             from match_team_members mtm join profiles p on p.id = mtm.user_id
            where mtm.match_team_id = m.winner_match_team_id) as winners,
          (select json_agg(json_build_object(
              'side', mt.side,
              'members', (select string_agg(p.display_name, '・' order by p.display_name)
                            from match_team_members mtm join profiles p on p.id = mtm.user_id
                           where mtm.match_team_id = mt.id)
            ) order by mt.side)
           from match_teams mt where mt.match_id = m.id) as teams
        from matches m
        where m.status = 'completed'
        order by m.completed_at desc nulls last
        limit 10
      ) r
    ), '[]'::json)
  );
end;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_admin_ranked_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_admin_void_match(p_match_id uuid, p_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_match record;
  r_hist record;
  r_user record;
  v_reverted int := 0;
  v_streak int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception '管理者のみ実行可能です';
  end if;
  select * into v_match from matches where id = p_match_id for update;
  if v_match is null then raise exception 'マッチが見つかりません'; end if;
  if v_match.approval_status = 'voided' then raise exception 'このマッチは既に無効試合です'; end if;

  -- 1) 適用済みのレート変動を逆適用して履歴を削除
  for r_hist in select * from rating_history where match_id = p_match_id loop
    update profiles set
      current_rating = greatest(0, coalesce(current_rating, 1500) - r_hist.rating_delta),
      wins = greatest(0, coalesce(wins, 0) - (case when r_hist.reason = 'match_win' then 1 else 0 end)),
      losses = greatest(0, coalesce(losses, 0) - (case when r_hist.reason in ('match_loss', 'match_loss_protected', 'banpick_timeout_loss', 'ready_timeout_loss') then 1 else 0 end))
    where id = r_hist.user_id;
    v_reverted := v_reverted + 1;
  end loop;
  delete from rating_history where match_id = p_match_id;

  -- 2) 参加者の連勝数を残り履歴から再計算 (直近から連続するmatch_winの数)
  for r_user in
    select distinct mtm.user_id from match_team_members mtm
    join match_teams mt on mt.id = mtm.match_team_id where mt.match_id = p_match_id
  loop
    v_streak := 0;
    for r_hist in select reason from rating_history where user_id = r_user.user_id order by created_at desc loop
      if r_hist.reason = 'match_win' then v_streak := v_streak + 1; else exit; end if;
    end loop;
    update profiles set win_streak = v_streak where id = r_user.user_id;
  end loop;

  -- 3) マッチを無効として確定し、進行中のバンピック/報告を閉じる
  update matches set status = 'completed', approval_status = 'voided',
    winner_match_team_id = null, loser_match_team_id = null,
    completed_at = coalesce(completed_at, now()), disputed = false
  where id = p_match_id;
  update banpick_sessions set status = 'completed', phase = 'completed',
    current_turn_match_team_id = null, current_action_type = null,
    deadline_at = null, last_action_at = now()
  where match_id = p_match_id and status = 'in_progress';
  update match_reports set status = 'rejected', decided_at = now()
  where match_id = p_match_id and status = 'pending';

  -- 4) 参加者のパーティを解放 (再キュー可能に)
  update parties set status = 'open', updated_at = now()
  where status = 'matched' and id in (
    select distinct mtm.source_party_id from match_team_members mtm
    join match_teams mt on mt.id = mtm.match_team_id
    where mt.match_id = p_match_id and mtm.source_party_id is not null
  );

  insert into match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', '管理者により無効試合になりました' || coalesce('（' || p_reason || '）', ''));

  return json_build_object('ok', true, 'reverted_rating_rows', v_reverted);
end;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_admin_void_match(uuid, text) TO authenticated;
