-- ============================================================
-- レート計算の改定 (2026-10-19適用済み)
--   1. K値: 32 → 48。さらに通算10試合未満のプレイヤーは K=64
--      (2ヶ月シーズンで上位ティアに現実的に届く速度にする)
--      ※ Kはプレイヤーごとに独立 (混在マッチでも各自のKで変動)
--   2. 敗北保護: レート(変動前)1800未満のプレイヤーは、その日 (JST)
--      最初の敗北によるレート減少が半分になる
--      (rating_history.reason='match_loss_protected' で記録)
--   3. 計算を _apply_match_rating() に共通化し、
--      rpc_approve_match_report / rpc_resolve_report_timeout から呼ぶ
-- rpc_missing_functions.sql 内の同名関数の定義は旧版 (K=32)。
-- ============================================================

CREATE OR REPLACE FUNCTION public._apply_match_rating(
  p_match_id uuid,
  p_winner_team_id uuid,
  p_loser_team_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_winner_avg numeric;
  v_loser_avg numeric;
  v_factor numeric; -- K × これ = 変動量 (勝者の増分と敗者の減少は同じ大きさ)
  r_member record;
  v_games integer;
  v_k integer;
  v_delta integer;
  v_protected boolean;
BEGIN
  SELECT avg(rating_before) INTO v_winner_avg FROM match_team_members WHERE match_team_id = p_winner_team_id;
  SELECT avg(rating_before) INTO v_loser_avg FROM match_team_members WHERE match_team_id = p_loser_team_id;
  -- v_factor = 1 - 勝者チームの期待勝率 = 敗者チームの期待勝率
  v_factor := 1.0 - 1.0 / (1.0 + power(10.0, (coalesce(v_loser_avg, 1500) - coalesce(v_winner_avg, 1500)) / 400.0));

  -- 勝者 (プレイヤーごとにK: 通算10試合未満は64、以降48)
  FOR r_member IN SELECT mtm.user_id, mtm.rating_before FROM match_team_members mtm WHERE mtm.match_team_id = p_winner_team_id LOOP
    SELECT coalesce(wins, 0) + coalesce(losses, 0) INTO v_games FROM profiles WHERE id = r_member.user_id;
    v_k := CASE WHEN coalesce(v_games, 0) < 10 THEN 64 ELSE 48 END;
    v_delta := greatest(1, round(v_k * v_factor));
    UPDATE profiles SET current_rating = coalesce(current_rating, 1500) + v_delta,
                        wins = coalesce(wins, 0) + 1,
                        win_streak = coalesce(win_streak, 0) + 1
    WHERE id = r_member.user_id;
    UPDATE match_team_members SET rating_after = coalesce(r_member.rating_before, 1500) + v_delta, rating_delta = v_delta
    WHERE match_team_id = p_winner_team_id AND user_id = r_member.user_id;
    INSERT INTO rating_history (user_id, match_id, rating_before, rating_after, rating_delta, reason)
    VALUES (r_member.user_id, p_match_id, r_member.rating_before, coalesce(r_member.rating_before, 1500) + v_delta, v_delta, 'match_win');
  END LOOP;

  -- 敗者 (1800未満は その日(JST)最初の敗北 が半減)
  FOR r_member IN SELECT mtm.user_id, mtm.rating_before FROM match_team_members mtm WHERE mtm.match_team_id = p_loser_team_id LOOP
    SELECT coalesce(wins, 0) + coalesce(losses, 0) INTO v_games FROM profiles WHERE id = r_member.user_id;
    v_k := CASE WHEN coalesce(v_games, 0) < 10 THEN 64 ELSE 48 END;
    v_delta := greatest(1, round(v_k * v_factor));

    v_protected := coalesce(r_member.rating_before, 1500) < 1800
      AND NOT EXISTS (
        SELECT 1 FROM rating_history rh
        WHERE rh.user_id = r_member.user_id
          AND rh.reason IN ('match_loss', 'match_loss_protected')
          AND (rh.created_at AT TIME ZONE 'Asia/Tokyo')::date = (now() AT TIME ZONE 'Asia/Tokyo')::date
      );
    IF v_protected THEN
      v_delta := greatest(1, round(v_delta / 2.0));
    END IF;

    UPDATE profiles SET current_rating = greatest(0, coalesce(current_rating, 1500) - v_delta),
                        losses = coalesce(losses, 0) + 1,
                        win_streak = 0
    WHERE id = r_member.user_id;
    UPDATE match_team_members SET rating_after = greatest(0, coalesce(r_member.rating_before, 1500) - v_delta), rating_delta = -v_delta
    WHERE match_team_id = p_loser_team_id AND user_id = r_member.user_id;
    INSERT INTO rating_history (user_id, match_id, rating_before, rating_after, rating_delta, reason)
    VALUES (r_member.user_id, p_match_id, r_member.rating_before, greatest(0, coalesce(r_member.rating_before, 1500) - v_delta), -v_delta,
            CASE WHEN v_protected THEN 'match_loss_protected' ELSE 'match_loss' END);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_approve_match_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_report record;
  v_my_match_team_id uuid;
  v_winner_team_id uuid;
  v_loser_team_id uuid;
  v_match_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_report from public.match_reports where id = p_report_id for update;
  if v_report is null then raise exception 'レポートが見つかりません'; end if;
  if v_report.status <> 'pending' then raise exception 'このレポートは既に処理済みです'; end if;
  v_match_id := v_report.match_id;
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = v_match_id and mtm.user_id = v_uid;
  if v_my_match_team_id is null then raise exception 'このマッチの参加者ではありません'; end if;
  if v_my_match_team_id = v_report.submitted_by_match_team_id then raise exception '自分のチームのレポートは承認できません'; end if;

  v_winner_team_id := v_report.winner_match_team_id;
  select id into v_loser_team_id from public.match_teams where match_id = v_match_id and id <> v_winner_team_id limit 1;

  update public.match_reports set status = 'approved', decided_at = now() where id = p_report_id;
  insert into public.match_report_votes (report_id, voter_user_id, voter_match_team_id, vote)
  values (p_report_id, v_uid, v_my_match_team_id, 'approve');
  update public.matches
  set status = 'completed', approval_status = 'approved',
      winner_match_team_id = v_winner_team_id, loser_match_team_id = v_loser_team_id, completed_at = now()
  where id = v_match_id;

  perform public._apply_match_rating(v_match_id, v_winner_team_id, v_loser_team_id);

  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (v_match_id, null, 'system', 'match report approved');
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_resolve_report_timeout(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_report record;
  v_winner_team_id uuid;
  v_loser_team_id uuid;
begin
  select * into v_report from public.match_reports
  where match_id = p_match_id and status = 'pending'
  order by submitted_at desc limit 1 for update;
  if v_report is null then return; end if;
  if v_report.deadline_at is null or now() < v_report.deadline_at then return; end if;

  v_winner_team_id := v_report.winner_match_team_id;
  select id into v_loser_team_id from public.match_teams where match_id = p_match_id and id <> v_winner_team_id limit 1;

  update public.match_reports set status = 'approved', decided_at = now() where id = v_report.id;
  update public.matches
  set status = 'completed', approval_status = 'approved',
      winner_match_team_id = v_winner_team_id, loser_match_team_id = v_loser_team_id, completed_at = now()
  where id = p_match_id;

  perform public._apply_match_rating(p_match_id, v_winner_team_id, v_loser_team_id);

  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', 'report auto-approved after timeout');
end;
$function$;
