CREATE OR REPLACE FUNCTION public.rpc_check_trophy_timeout(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_match record;
  v_alpha_team record;
  v_bravo_team record;
  v_alpha_done boolean;
  v_bravo_done boolean;
  v_alpha_count integer;
  v_bravo_count integer;
  v_alpha_trophy_count integer;
  v_bravo_trophy_count integer;
  v_winner_id uuid;
  v_loser_id uuid;
  v_deadline timestamptz;
begin
  select * into v_match from matches where id = p_match_id;
  if v_match is null then
    return json_build_object('status', 'not_found');
  end if;
  if v_match.status not in ('ready', 'banpick') then
    return json_build_object('status', 'not_applicable');
  end if;
  if v_match.host_selected_at is null then
    return json_build_object('status', 'no_host');
  end if;

  v_deadline := v_match.host_selected_at + interval '3 minutes';
  if now() < v_deadline then
    return json_build_object('status', 'waiting');
  end if;

  select * into v_alpha_team from match_teams where match_id = p_match_id and side = 'alpha';
  select * into v_bravo_team from match_teams where match_id = p_match_id and side = 'bravo';

  select count(*) into v_alpha_count from match_team_members where match_team_id = v_alpha_team.id;
  select count(*) into v_bravo_count from match_team_members where match_team_id = v_bravo_team.id;

  v_alpha_trophy_count := coalesce(jsonb_array_length(to_jsonb(v_alpha_team.trophy_users)), 0);
  v_bravo_trophy_count := coalesce(jsonb_array_length(to_jsonb(v_bravo_team.trophy_users)), 0);

  v_alpha_done := (v_alpha_count <= 2 and v_alpha_trophy_count = v_alpha_count) or v_alpha_trophy_count = 2;
  v_bravo_done := (v_bravo_count <= 2 and v_bravo_trophy_count = v_bravo_count) or v_bravo_trophy_count = 2;

  if v_alpha_done and v_bravo_done then
    return json_build_object('status', 'all_done');
  end if;

  -- Both failed: void match and penalize both
  if not v_alpha_done and not v_bravo_done then
    update matches
    set status = 'completed', approval_status = 'approved',
        completed_at = now()
    where id = p_match_id;

    -- Penalize all players -10 rating
    update profiles
    set current_rating = greatest(0, coalesce(current_rating, 1500) - 10)
    where id in (
      select mtm.user_id from match_team_members mtm
      join match_teams mt on mt.id = mtm.match_team_id
      where mt.match_id = p_match_id
    );

    insert into match_messages (match_id, sender_user_id, message_type, body)
    values (p_match_id, null, 'system', 'trophy timeout: both teams failed to select, match voided, -10 rating penalty');

    return json_build_object('status', 'voided');
  end if;

  -- One team failed: that team loses
  if not v_alpha_done then
    v_loser_id := v_alpha_team.id;
    v_winner_id := v_bravo_team.id;
  else
    v_loser_id := v_bravo_team.id;
    v_winner_id := v_alpha_team.id;
  end if;

  update matches
  set status = 'completed', approval_status = 'approved',
      winner_match_team_id = v_winner_id, loser_match_team_id = v_loser_id,
      completed_at = now()
  where id = p_match_id;

  insert into match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', 'trophy timeout: team forfeited for not selecting trophy users');

  return json_build_object('status', 'forfeited', 'loser_team_id', v_loser_id);
end;
$$;
