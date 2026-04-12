CREATE OR REPLACE FUNCTION public.rpc_create_match_from_queue(
  p_anchor_queue_entry_id uuid,
  p_queue_type text DEFAULT 'ranked'::text
)
RETURNS TABLE(match_id uuid, alpha_match_team_id uuid, bravo_match_team_id uuid, alpha_member_count integer, bravo_member_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_match_id uuid;
  v_alpha_match_team_id uuid;
  v_bravo_match_team_id uuid;
  v_anchor_avg numeric(10,2);
  v_anchor_status text;
  v_anchor_created_at timestamptz;
  v_anchor_level integer;
  v_max_diff numeric;
  v_min_party_size integer;
  v_wait_seconds integer;
  v_locked_count integer;
  v_updated_count integer;
  v_alpha_base_avg numeric(10,2);
  v_bravo_base_avg numeric(10,2);
  v_alpha_bonus integer := 0;
  v_bravo_bonus integer := 0;
  v_alpha_effective numeric(10,2);
  v_bravo_effective numeric(10,2);
  v_alpha_players integer := 0;
  v_bravo_players integer := 0;
  r_member record;
begin
  if p_anchor_queue_entry_id is null then
    raise exception 'anchor queue entry id is required';
  end if;
  if p_queue_type not in ('ranked','casual','fullparty_only','mixed') then
    raise exception 'invalid queue_type';
  end if;

  create temporary table tmp_candidate_entries (
    queue_entry_id uuid primary key, party_id uuid not null,
    party_size integer not null, avg_rating numeric(10,2) not null,
    party_size_bonus integer not null, created_at timestamptz not null
  ) on commit drop;

  create temporary table tmp_selected_entries (
    queue_entry_id uuid primary key, party_id uuid not null,
    party_size integer not null, avg_rating numeric(10,2) not null,
    party_size_bonus integer not null, created_at timestamptz not null
  ) on commit drop;

  create temporary table tmp_best_side (
    queue_entry_id uuid primary key, side text not null check (side in ('alpha','bravo'))
  ) on commit drop;

  create temporary table tmp_selected_users (
    queue_entry_id uuid not null, user_id uuid not null
  ) on commit drop;

  create temporary table tmp_recent_opponents (
    user_id uuid not null, recent_opponent_user_id uuid not null
  ) on commit drop;

  -- 1) anchor lock
  select qe.avg_rating, qe.status, qe.created_at
  into v_anchor_avg, v_anchor_status, v_anchor_created_at
  from public.queue_entries qe
  where qe.id = p_anchor_queue_entry_id
    and qe.queue_type = p_queue_type
  for update skip locked;

  if v_anchor_avg is null then
    raise exception 'anchor waiting queue entry not found';
  end if;
  if v_anchor_status <> 'waiting' then
    raise exception 'anchor waiting queue entry not found';
  end if;

  -- compute 12-level wait tier (30s intervals)
  -- levels 0-3: rating +-100, levels 4-7: +-200, levels 8-11: +-300
  -- within each rating band: 0=full only, 1=trio+, 2=duo+, 3=any
  v_wait_seconds := extract(epoch from (now() - v_anchor_created_at))::integer;
  v_anchor_level := least(v_wait_seconds / 30, 11);

  v_max_diff := case
    when v_anchor_level <= 3 then 100
    when v_anchor_level <= 7 then 200
    else 300
  end;

  -- min party size allowed in candidates: 4=full only, 3=trio+, 2=duo+, 1=any
  v_min_party_size := case (v_anchor_level % 4)
    when 0 then 4
    when 1 then 3
    when 2 then 2
    else 1
  end;

  -- 2) gather candidates
  insert into tmp_candidate_entries (queue_entry_id, party_id, party_size, avg_rating, party_size_bonus, created_at)
  select qe.id, qe.party_id, qe.party_size, qe.avg_rating, qe.party_size_bonus, qe.created_at
  from public.queue_entries qe
  where qe.id = p_anchor_queue_entry_id;

  insert into tmp_candidate_entries (queue_entry_id, party_id, party_size, avg_rating, party_size_bonus, created_at)
  select t.queue_entry_id, t.party_id, t.party_size, t.avg_rating, t.party_size_bonus, t.created_at
  from (
    select qe.id as queue_entry_id, qe.party_id, qe.party_size, qe.avg_rating, qe.party_size_bonus, qe.created_at
    from public.queue_entries qe
    where qe.status = 'waiting' and qe.queue_type = p_queue_type and qe.id <> p_anchor_queue_entry_id
      and abs(qe.avg_rating - v_anchor_avg) <= v_max_diff
      and qe.party_size >= v_min_party_size
    order by abs(qe.avg_rating - v_anchor_avg) asc, qe.created_at asc
    limit 7
    for update skip locked
  ) t
  on conflict (queue_entry_id) do nothing;

  -- 3) find best 8-player combo
  create temporary table tmp_best_selection (queue_entry_id uuid primary key) on commit drop;

  with candidates as (
    select row_number() over (order by created_at asc, queue_entry_id) as rn, * from tmp_candidate_entries
  ),
  combos as (
    select array[c1.queue_entry_id]::uuid[] as ids, c1.party_size as total_players from candidates c1
    union all
    select array[c1.queue_entry_id, c2.queue_entry_id], c1.party_size + c2.party_size
    from candidates c1 join candidates c2 on c2.rn > c1.rn
    union all
    select array[c1.queue_entry_id, c2.queue_entry_id, c3.queue_entry_id], c1.party_size + c2.party_size + c3.party_size
    from candidates c1 join candidates c2 on c2.rn > c1.rn join candidates c3 on c3.rn > c2.rn
    union all
    select array[c1.queue_entry_id, c2.queue_entry_id, c3.queue_entry_id, c4.queue_entry_id], c1.party_size + c2.party_size + c3.party_size + c4.party_size
    from candidates c1 join candidates c2 on c2.rn > c1.rn join candidates c3 on c3.rn > c2.rn join candidates c4 on c4.rn > c3.rn
  ),
  valid_combos as (
    select ids from combos
    where total_players = 8 and p_anchor_queue_entry_id = any(ids)
  ),
  scored as (
    select vc.ids,
      (select coalesce(sum(case when ce.party_size = 4 then 10 when ce.party_size = 3 then 6 when ce.party_size = 2 then 3 else 0 end), 0) from tmp_candidate_entries ce where ce.queue_entry_id = any(vc.ids)) as composition_weight,
      (select round(avg(abs(ce.avg_rating - v_anchor_avg))::numeric, 2) from tmp_candidate_entries ce where ce.queue_entry_id = any(vc.ids)) as anchor_distance
    from valid_combos vc
  )
  insert into tmp_best_selection(queue_entry_id)
  select unnest(s.ids) from (select ids from scored order by composition_weight desc, anchor_distance asc limit 1) s;

  if not exists (select 1 from tmp_best_selection) then
    raise exception 'not enough compatible waiting players to create a match';
  end if;

  insert into tmp_selected_entries (queue_entry_id, party_id, party_size, avg_rating, party_size_bonus, created_at)
  select ce.queue_entry_id, ce.party_id, ce.party_size, ce.avg_rating, ce.party_size_bonus, ce.created_at
  from tmp_candidate_entries ce join tmp_best_selection bs on bs.queue_entry_id = ce.queue_entry_id;

  select count(*) into v_locked_count from tmp_selected_entries;
  if v_locked_count <= 0 then raise exception 'no selected entries'; end if;
  if (select coalesce(sum(party_size), 0) from tmp_selected_entries) <> 8 then
    raise exception 'selected entries do not sum to 8';
  end if;

  insert into tmp_selected_users(queue_entry_id, user_id)
  select qem.queue_entry_id, qem.user_id
  from public.queue_entry_members qem join tmp_selected_entries se on se.queue_entry_id = qem.queue_entry_id;

  -- 4) recent opponents
  with my_recent_match as (
    select distinct on (mtm.user_id) mtm.user_id, mt.match_id, mtm.match_team_id
    from public.match_team_members mtm
    join public.match_teams mt on mt.id = mtm.match_team_id
    join public.matches m on m.id = mt.match_id
    where mtm.user_id in (select user_id from tmp_selected_users) and m.status = 'completed'
    order by mtm.user_id, m.completed_at desc nulls last, m.matched_at desc nulls last
  )
  insert into tmp_recent_opponents(user_id, recent_opponent_user_id)
  select mrm.user_id, opp_mtm.user_id
  from my_recent_match mrm
  join public.match_teams my_mt on my_mt.id = mrm.match_team_id
  join public.match_teams opp_mt on opp_mt.match_id = my_mt.match_id and opp_mt.id <> my_mt.id
  join public.match_team_members opp_mtm on opp_mtm.match_team_id = opp_mt.id;

  -- 5) split into alpha/bravo
  create temporary table tmp_side_candidates (
    queue_entry_id uuid not null, side text not null check (side in ('alpha','bravo'))
  ) on commit drop;

  with selected as (
    select row_number() over (order by created_at asc, queue_entry_id) as rn, * from tmp_selected_entries
  ),
  alpha_sets as (
    select array[s1.queue_entry_id]::uuid[] as alpha_ids, s1.party_size as alpha_players from selected s1
    union all
    select array[s1.queue_entry_id, s2.queue_entry_id], s1.party_size + s2.party_size
    from selected s1 join selected s2 on s2.rn > s1.rn
    union all
    select array[s1.queue_entry_id, s2.queue_entry_id, s3.queue_entry_id], s1.party_size + s2.party_size + s3.party_size
    from selected s1 join selected s2 on s2.rn > s1.rn join selected s3 on s3.rn > s2.rn
    union all
    select array[s1.queue_entry_id, s2.queue_entry_id, s3.queue_entry_id, s4.queue_entry_id], s1.party_size + s2.party_size + s3.party_size + s4.party_size
    from selected s1 join selected s2 on s2.rn > s1.rn join selected s3 on s3.rn > s2.rn join selected s4 on s4.rn > s3.rn
  ),
  valid_alpha as (
    select alpha_ids from alpha_sets where alpha_players = 4
  ),
  split_scored as (
    select va.alpha_ids,
      (select round(avg(qem.rating_at_entry)::numeric, 2) from tmp_selected_entries se join public.queue_entry_members qem on qem.queue_entry_id = se.queue_entry_id where se.queue_entry_id = any(va.alpha_ids)) as alpha_avg,
      (select round(avg(qem.rating_at_entry)::numeric, 2) from tmp_selected_entries se join public.queue_entry_members qem on qem.queue_entry_id = se.queue_entry_id where not (se.queue_entry_id = any(va.alpha_ids))) as bravo_avg,
      (select coalesce(sum(se.party_size_bonus), 0) from tmp_selected_entries se where se.queue_entry_id = any(va.alpha_ids)) as alpha_bonus,
      (select coalesce(sum(se.party_size_bonus), 0) from tmp_selected_entries se where not (se.queue_entry_id = any(va.alpha_ids))) as bravo_bonus,
      (select bool_or(se.party_size = 4) from tmp_selected_entries se where se.queue_entry_id = any(va.alpha_ids)) as alpha_has_full,
      (select bool_or(se.party_size = 4) from tmp_selected_entries se where not (se.queue_entry_id = any(va.alpha_ids))) as bravo_has_full,
      (select bool_and(se.party_size = 1) from tmp_selected_entries se where se.queue_entry_id = any(va.alpha_ids)) as alpha_all_solo,
      (select bool_and(se.party_size = 1) from tmp_selected_entries se where not (se.queue_entry_id = any(va.alpha_ids))) as bravo_all_solo,
      (select string_agg(se.party_size::text, '+' order by se.party_size desc, se.created_at asc) from tmp_selected_entries se where se.queue_entry_id = any(va.alpha_ids)) as alpha_comp,
      (select string_agg(se.party_size::text, '+' order by se.party_size desc, se.created_at asc) from tmp_selected_entries se where not (se.queue_entry_id = any(va.alpha_ids))) as bravo_comp,
      (select count(*) from (select su.user_id from tmp_selected_users su where su.queue_entry_id = any(va.alpha_ids)) alpha_users join (select su.user_id from tmp_selected_users su where not (su.queue_entry_id = any(va.alpha_ids))) bravo_users on true join tmp_recent_opponents ro on ro.user_id = alpha_users.user_id and ro.recent_opponent_user_id = bravo_users.user_id) as recent_rematch_count
    from valid_alpha va
  ),
  final_scored as (
    select *,
      abs(alpha_avg - bravo_avg) as avg_diff,
      abs(alpha_bonus - bravo_bonus) as bonus_diff,
      case when (alpha_has_full and bravo_all_solo) or (bravo_has_full and alpha_all_solo) then 1000 else 0 end as full_vs_allsolo_penalty,
      case when alpha_comp = bravo_comp then 0 else 50 end as composition_mismatch_penalty,
      (recent_rematch_count * 200) as recent_rematch_penalty
    from split_scored
  )
  insert into tmp_side_candidates(queue_entry_id, side)
  select se.queue_entry_id, case when se.queue_entry_id = any(best.alpha_ids) then 'alpha' else 'bravo' end
  from tmp_selected_entries se
  cross join (
    select alpha_ids from final_scored
    where (v_anchor_level >= 11 or full_vs_allsolo_penalty = 0)
    order by full_vs_allsolo_penalty asc, recent_rematch_penalty asc, composition_mismatch_penalty asc, avg_diff asc, bonus_diff asc
    limit 1
  ) best;

  insert into tmp_best_side(queue_entry_id, side) select queue_entry_id, side from tmp_side_candidates;

  select coalesce(sum(se.party_size), 0) into v_alpha_players
  from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id where bs.side = 'alpha';

  select coalesce(sum(se.party_size), 0) into v_bravo_players
  from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id where bs.side = 'bravo';

  if v_alpha_players <> 4 or v_bravo_players <> 4 then
    raise exception 'failed to split teams into 4v4';
  end if;

  if exists (select 1 from public.queue_entries qe join tmp_selected_entries se on se.queue_entry_id = qe.id where qe.status <> 'waiting') then
    raise exception 'some selected queue entries are no longer waiting';
  end if;

  -- 6) create match
  insert into public.matches (queue_type, status, created_from_queue, matched_at, approval_status, metadata)
  values (p_queue_type, 'banpick', true, now(), 'none', '{}'::jsonb)
  returning id into v_match_id;

  select round(avg(qem.rating_at_entry)::numeric, 2), coalesce(sum(se.party_size_bonus), 0)
  into v_alpha_base_avg, v_alpha_bonus
  from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id
  join public.queue_entry_members qem on qem.queue_entry_id = se.queue_entry_id where bs.side = 'alpha';

  select round(avg(qem.rating_at_entry)::numeric, 2), coalesce(sum(se.party_size_bonus), 0)
  into v_bravo_base_avg, v_bravo_bonus
  from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id
  join public.queue_entry_members qem on qem.queue_entry_id = se.queue_entry_id where bs.side = 'bravo';

  v_alpha_effective := v_alpha_base_avg + v_alpha_bonus;
  v_bravo_effective := v_bravo_base_avg + v_bravo_bonus;

  insert into public.match_teams (match_id, side, display_name, source_team_id, captain_user_id, party_composition, base_avg_rating, synergy_bonus, effective_avg_rating, is_full_party)
  select v_match_id, 'alpha', 'Alpha', null, null,
    string_agg(se.party_size::text, '+' order by se.party_size desc, se.created_at asc),
    v_alpha_base_avg, v_alpha_bonus, v_alpha_effective, bool_or(se.party_size = 4)
  from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id where bs.side = 'alpha'
  returning id into v_alpha_match_team_id;

  insert into public.match_teams (match_id, side, display_name, source_team_id, captain_user_id, party_composition, base_avg_rating, synergy_bonus, effective_avg_rating, is_full_party)
  select v_match_id, 'bravo', 'Bravo', null, null,
    string_agg(se.party_size::text, '+' order by se.party_size desc, se.created_at asc),
    v_bravo_base_avg, v_bravo_bonus, v_bravo_effective, bool_or(se.party_size = 4)
  from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id where bs.side = 'bravo'
  returning id into v_bravo_match_team_id;

  for r_member in
    select qem.user_id, qem.rating_at_entry, qem.is_party_leader, se.party_id as source_party_id, se.queue_entry_id as source_queue_entry_id, se.party_size
    from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id
    join public.queue_entry_members qem on qem.queue_entry_id = se.queue_entry_id where bs.side = 'alpha'
  loop
    insert into public.match_team_members (match_team_id, user_id, source_party_id, source_queue_entry_id, rating_before, joined_as_party_size, is_party_leader)
    values (v_alpha_match_team_id, r_member.user_id, r_member.source_party_id, r_member.source_queue_entry_id, r_member.rating_at_entry, r_member.party_size, r_member.is_party_leader);
  end loop;

  for r_member in
    select qem.user_id, qem.rating_at_entry, qem.is_party_leader, se.party_id as source_party_id, se.queue_entry_id as source_queue_entry_id, se.party_size
    from tmp_best_side bs join tmp_selected_entries se on se.queue_entry_id = bs.queue_entry_id
    join public.queue_entry_members qem on qem.queue_entry_id = se.queue_entry_id where bs.side = 'bravo'
  loop
    insert into public.match_team_members (match_team_id, user_id, source_party_id, source_queue_entry_id, rating_before, joined_as_party_size, is_party_leader)
    values (v_bravo_match_team_id, r_member.user_id, r_member.source_party_id, r_member.source_queue_entry_id, r_member.rating_at_entry, r_member.party_size, r_member.is_party_leader);
  end loop;

  update public.match_teams mt set captain_user_id = sub.user_id
  from (select mtm.user_id from public.match_team_members mtm where mtm.match_team_id = v_alpha_match_team_id order by mtm.is_party_leader desc, mtm.created_at asc limit 1) sub
  where mt.id = v_alpha_match_team_id;

  update public.match_teams mt set captain_user_id = sub.user_id
  from (select mtm.user_id from public.match_team_members mtm where mtm.match_team_id = v_bravo_match_team_id order by mtm.is_party_leader desc, mtm.created_at asc limit 1) sub
  where mt.id = v_bravo_match_team_id;

  update public.queue_entries qe set status = 'matched', matched_at = now()
  where qe.id in (select queue_entry_id from tmp_selected_entries) and qe.status = 'waiting';

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_locked_count then
    raise exception 'queue entry update conflict detected';
  end if;

  update public.parties p set status = 'matched', updated_at = now()
  where p.id in (select party_id from tmp_selected_entries) and p.status in ('open','queued');

  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (v_match_id, null, 'system', 'match created');

  match_id := v_match_id;
  alpha_match_team_id := v_alpha_match_team_id;
  bravo_match_team_id := v_bravo_match_team_id;
  alpha_member_count := v_alpha_players;
  bravo_member_count := v_bravo_players;
  return next;
end;
$function$;
