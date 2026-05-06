-- ============================================================
-- Missing RPC Functions for cod-matcher
-- ============================================================

-- ============================================================
-- 1. FRIENDS RPCs
-- ============================================================

-- rpc_list_my_friends
CREATE OR REPLACE FUNCTION public.rpc_list_my_friends()
RETURNS TABLE(
  friendship_id uuid,
  friend_user_id uuid,
  friend_display_name text,
  accepted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
    select
      f.id as friendship_id,
      case when f.user_id_a = v_uid then f.user_id_b else f.user_id_a end as friend_user_id,
      p.display_name as friend_display_name,
      f.accepted_at
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_id_a = v_uid then f.user_id_b else f.user_id_a end
    where f.status = 'accepted'
      and (f.user_id_a = v_uid or f.user_id_b = v_uid)
    order by f.accepted_at desc;
end;
$$;

-- rpc_list_my_pending_friend_requests (incoming)
CREATE OR REPLACE FUNCTION public.rpc_list_my_pending_friend_requests()
RETURNS TABLE(
  friendship_id uuid,
  requester_user_id uuid,
  requester_display_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
    select
      f.id as friendship_id,
      f.requested_by as requester_user_id,
      p.display_name as requester_display_name,
      f.created_at
    from public.friendships f
    join public.profiles p on p.id = f.requested_by
    where f.status = 'pending'
      and (f.user_id_a = v_uid or f.user_id_b = v_uid)
      and f.requested_by <> v_uid
    order by f.created_at desc;
end;
$$;

-- rpc_list_my_sent_friend_requests
CREATE OR REPLACE FUNCTION public.rpc_list_my_sent_friend_requests()
RETURNS TABLE(
  friendship_id uuid,
  target_user_id uuid,
  target_display_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
    select
      f.id as friendship_id,
      case when f.user_id_a = v_uid then f.user_id_b else f.user_id_a end as target_user_id,
      p.display_name as target_display_name,
      f.created_at
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_id_a = v_uid then f.user_id_b else f.user_id_a end
    where f.status = 'pending'
      and f.requested_by = v_uid
    order by f.created_at desc;
end;
$$;

-- rpc_send_friend_request
CREATE OR REPLACE FUNCTION public.rpc_send_friend_request(
  p_target_display_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
  v_existing_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Find target by exact display_name match
  select id into v_target_id
  from public.profiles
  where display_name = p_target_display_name
  limit 1;

  if v_target_id is null then
    raise exception 'ユーザーが見つかりません: %', p_target_display_name;
  end if;

  if v_target_id = v_uid then
    raise exception '自分自身にフレンド申請はできません';
  end if;

  -- Check for existing friendship (any status)
  select id into v_existing_id
  from public.friendships
  where (user_id_a = least(v_uid, v_target_id) and user_id_b = greatest(v_uid, v_target_id));

  if v_existing_id is not null then
    raise exception '既にフレンド関係またはフレンド申請が存在します';
  end if;

  -- Create friendship record
  insert into public.friendships (user_id_a, user_id_b, status, requested_by)
  values (least(v_uid, v_target_id), greatest(v_uid, v_target_id), 'pending', v_uid);
end;
$$;

-- rpc_accept_friend_request
CREATE OR REPLACE FUNCTION public.rpc_accept_friend_request(
  p_friendship_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_friendship record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_friendship
  from public.friendships
  where id = p_friendship_id;

  if v_friendship is null then
    raise exception 'フレンド申請が見つかりません';
  end if;

  if v_friendship.status <> 'pending' then
    raise exception 'この申請は既に処理済みです';
  end if;

  -- Only the non-requester can accept
  if v_friendship.requested_by = v_uid then
    raise exception '自分の申請は承認できません';
  end if;

  if v_friendship.user_id_a <> v_uid and v_friendship.user_id_b <> v_uid then
    raise exception '権限がありません';
  end if;

  update public.friendships
  set status = 'accepted', accepted_at = now()
  where id = p_friendship_id;
end;
$$;

-- rpc_reject_friend_request
CREATE OR REPLACE FUNCTION public.rpc_reject_friend_request(
  p_friendship_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_friendship record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_friendship
  from public.friendships
  where id = p_friendship_id;

  if v_friendship is null then
    raise exception 'フレンド申請が見つかりません';
  end if;

  if v_friendship.status <> 'pending' then
    raise exception 'この申請は既に処理済みです';
  end if;

  if v_friendship.user_id_a <> v_uid and v_friendship.user_id_b <> v_uid then
    raise exception '権限がありません';
  end if;

  delete from public.friendships where id = p_friendship_id;
end;
$$;

-- rpc_remove_friend
CREATE OR REPLACE FUNCTION public.rpc_remove_friend(
  p_friend_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.friendships
  where status = 'accepted'
    and (
      (user_id_a = least(v_uid, p_friend_user_id) and user_id_b = greatest(v_uid, p_friend_user_id))
    );

  if not found then
    raise exception 'フレンド関係が見つかりません';
  end if;
end;
$$;


-- ============================================================
-- 2. PARTY RPCs
-- ============================================================

-- rpc_create_party
CREATE OR REPLACE FUNCTION public.rpc_create_party(
  p_source_team_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_party_id uuid;
  v_existing_party_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Check if user is banned
  if exists (select 1 from public.profiles where id = v_uid and is_banned = true) then
    raise exception 'BANされているためパーティを作成できません';
  end if;

  -- Check if user already has an active party
  select pm.party_id into v_existing_party_id
  from public.party_members pm
  join public.parties p on p.id = pm.party_id
  where pm.user_id = v_uid
    and p.status in ('open', 'queued')
  limit 1;

  if v_existing_party_id is not null then
    raise exception '既にアクティブなパーティに参加しています';
  end if;

  -- Create the party
  insert into public.parties (leader_user_id, source_team_id, party_type, status)
  values (v_uid, p_source_team_id, 'solo', 'open')
  returning id into v_party_id;

  -- Add leader as member
  insert into public.party_members (party_id, user_id)
  values (v_party_id, v_uid);
end;
$$;

-- rpc_invite_to_party
CREATE OR REPLACE FUNCTION public.rpc_invite_to_party(
  p_party_id uuid,
  p_invitee_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_party record;
  v_member_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_party
  from public.parties
  where id = p_party_id;

  if v_party is null then
    raise exception 'パーティが見つかりません';
  end if;

  if v_party.leader_user_id <> v_uid then
    raise exception 'パーティリーダーのみ招待できます';
  end if;

  if v_party.status not in ('open') then
    raise exception 'このパーティには招待できません（ステータス: ' || v_party.status || '）';
  end if;

  -- Check party is not full
  select count(*) into v_member_count
  from public.party_members
  where party_id = p_party_id;

  if v_member_count >= 4 then
    raise exception 'パーティは満員です（4人）';
  end if;

  -- Check invitee is not already in this party
  if exists (select 1 from public.party_members where party_id = p_party_id and user_id = p_invitee_user_id) then
    raise exception '既にパーティに参加しています';
  end if;

  -- Check for existing pending invite
  if exists (
    select 1 from public.party_invites
    where party_id = p_party_id and invitee_user_id = p_invitee_user_id and status = 'pending'
  ) then
    raise exception '既に招待済みです';
  end if;

  -- Create invite
  insert into public.party_invites (party_id, inviter_user_id, invitee_user_id, status)
  values (p_party_id, v_uid, p_invitee_user_id, 'pending');
end;
$$;

-- rpc_accept_party_invite
CREATE OR REPLACE FUNCTION public.rpc_accept_party_invite(
  p_invite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_party record;
  v_member_count integer;
  v_new_type text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
  from public.party_invites
  where id = p_invite_id;

  if v_invite is null then
    raise exception '招待が見つかりません';
  end if;

  if v_invite.invitee_user_id <> v_uid then
    raise exception 'この招待はあなた宛ではありません';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'この招待は既に処理済みです';
  end if;

  select * into v_party
  from public.parties
  where id = v_invite.party_id;

  if v_party is null or v_party.status not in ('open') then
    raise exception 'パーティが利用できません';
  end if;

  -- Check party is not full
  select count(*) into v_member_count
  from public.party_members
  where party_id = v_invite.party_id;

  if v_member_count >= 4 then
    raise exception 'パーティは満員です';
  end if;

  -- Leave any existing active party first
  perform public._leave_active_party(v_uid);

  -- Accept the invite
  update public.party_invites
  set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  -- Add to party members
  insert into public.party_members (party_id, user_id)
  values (v_invite.party_id, v_uid);

  -- Update party type based on new member count
  select count(*) into v_member_count
  from public.party_members
  where party_id = v_invite.party_id;

  v_new_type := case
    when v_member_count = 1 then 'solo'
    when v_member_count = 2 then 'duo'
    when v_member_count = 3 then 'trio'
    when v_member_count = 4 then 'full'
    else 'solo'
  end;

  update public.parties
  set party_type = v_new_type, updated_at = now()
  where id = v_invite.party_id;
end;
$$;

-- Helper: leave active party (used internally)
CREATE OR REPLACE FUNCTION public._leave_active_party(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_active_party_id uuid;
begin
  select pm.party_id into v_active_party_id
  from public.party_members pm
  join public.parties p on p.id = pm.party_id
  where pm.user_id = p_user_id
    and p.status in ('open', 'cancelled')
  limit 1;

  if v_active_party_id is not null then
    delete from public.party_members where party_id = v_active_party_id and user_id = p_user_id;
    -- If no members left, close the party
    if not exists (select 1 from public.party_members where party_id = v_active_party_id) then
      update public.parties set status = 'closed', updated_at = now() where id = v_active_party_id;
    end if;
  end if;
end;
$$;

-- rpc_reject_party_invite
CREATE OR REPLACE FUNCTION public.rpc_reject_party_invite(
  p_invite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
  from public.party_invites
  where id = p_invite_id;

  if v_invite is null then
    raise exception '招待が見つかりません';
  end if;

  if v_invite.invitee_user_id <> v_uid then
    raise exception 'この招待はあなた宛ではありません';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'この招待は既に処理済みです';
  end if;

  update public.party_invites
  set status = 'rejected', responded_at = now()
  where id = p_invite_id;
end;
$$;

-- rpc_queue_existing_party
CREATE OR REPLACE FUNCTION public.rpc_queue_existing_party(
  p_party_id uuid,
  p_queue_type text DEFAULT 'ranked'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_party record;
  v_member_count integer;
  v_avg_rating numeric(10,2);
  v_min_rating numeric(10,2);
  v_max_rating numeric(10,2);
  v_bonus integer;
  v_queue_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_queue_type not in ('ranked', 'casual', 'fullparty_only', 'mixed') then
    raise exception 'invalid queue_type';
  end if;

  select * into v_party
  from public.parties
  where id = p_party_id;

  if v_party is null then
    raise exception 'パーティが見つかりません';
  end if;

  if v_party.leader_user_id <> v_uid then
    raise exception 'パーティリーダーのみキューに入れます';
  end if;

  if v_party.status not in ('open', 'cancelled') then
    raise exception 'このパーティはキューに入れません（ステータス: ' || v_party.status || '）';
  end if;

  -- Count members and compute ratings
  select count(*), avg(p.current_rating), min(p.current_rating), max(p.current_rating)
  into v_member_count, v_avg_rating, v_min_rating, v_max_rating
  from public.party_members pm
  join public.profiles p on p.id = pm.user_id
  where pm.party_id = p_party_id;

  if v_member_count < 1 or v_member_count > 4 then
    raise exception 'パーティ人数が不正です: %', v_member_count;
  end if;

  -- Check no member is banned
  if exists (
    select 1 from public.party_members pm
    join public.profiles p on p.id = pm.user_id
    where pm.party_id = p_party_id and p.is_banned = true
  ) then
    raise exception 'BANされたメンバーがいるためキューに入れません';
  end if;

  -- Compute party size bonus (synergy penalty for larger parties)
  v_bonus := case
    when v_member_count = 1 then 0
    when v_member_count = 2 then 30
    when v_member_count = 3 then 60
    when v_member_count = 4 then 100
    else 0
  end;

  -- Update party status
  update public.parties
  set status = 'queued', updated_at = now()
  where id = p_party_id;

  -- Create queue entry
  insert into public.queue_entries (
    party_id, queue_type, status, party_size,
    avg_rating, min_rating, max_rating, party_size_bonus,
    wait_expand_level
  )
  values (
    p_party_id, p_queue_type, 'waiting', v_member_count,
    v_avg_rating, v_min_rating, v_max_rating, v_bonus,
    0
  )
  returning id into v_queue_entry_id;

  -- Add queue entry members
  insert into public.queue_entry_members (queue_entry_id, user_id, rating_at_entry, is_party_leader)
  select v_queue_entry_id, pm.user_id, p.current_rating,
    (pm.user_id = v_party.leader_user_id)
  from public.party_members pm
  join public.profiles p on p.id = pm.user_id
  where pm.party_id = p_party_id;
end;
$$;

-- rpc_disband_party
CREATE OR REPLACE FUNCTION public.rpc_disband_party(
  p_party_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_party record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_party
  from public.parties
  where id = p_party_id;

  if v_party is null then
    raise exception 'パーティが見つかりません';
  end if;

  if v_party.leader_user_id <> v_uid then
    raise exception 'パーティリーダーのみ解散できます';
  end if;

  if v_party.status in ('queued', 'matched') then
    raise exception 'キュー中またはマッチ済みのパーティは解散できません';
  end if;

  -- Cancel pending invites
  update public.party_invites
  set status = 'cancelled', responded_at = now()
  where party_id = p_party_id and status = 'pending';

  -- Remove all members
  delete from public.party_members where party_id = p_party_id;

  -- Close party
  update public.parties
  set status = 'closed', updated_at = now()
  where id = p_party_id;
end;
$$;

-- rpc_leave_party
CREATE OR REPLACE FUNCTION public.rpc_leave_party(
  p_party_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_party record;
  v_remaining integer;
  v_new_type text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_party
  from public.parties
  where id = p_party_id;

  if v_party is null then
    raise exception 'パーティが見つかりません';
  end if;

  if v_party.leader_user_id = v_uid then
    raise exception 'リーダーはパーティ脱退できません。解散してください。';
  end if;

  if v_party.status in ('queued', 'matched') then
    raise exception 'キュー中またはマッチ済みのパーティからは脱退できません';
  end if;

  -- Check user is member
  if not exists (select 1 from public.party_members where party_id = p_party_id and user_id = v_uid) then
    raise exception 'このパーティのメンバーではありません';
  end if;

  -- Remove member
  delete from public.party_members where party_id = p_party_id and user_id = v_uid;

  -- Update party type
  select count(*) into v_remaining
  from public.party_members
  where party_id = p_party_id;

  v_new_type := case
    when v_remaining = 1 then 'solo'
    when v_remaining = 2 then 'duo'
    when v_remaining = 3 then 'trio'
    when v_remaining = 4 then 'full'
    else 'solo'
  end;

  update public.parties
  set party_type = v_new_type, updated_at = now()
  where id = p_party_id;
end;
$$;

-- rpc_list_my_pending_party_invites
CREATE OR REPLACE FUNCTION public.rpc_list_my_pending_party_invites()
RETURNS TABLE(
  invite_id uuid,
  party_id uuid,
  inviter_user_id uuid,
  inviter_display_name text,
  invitee_user_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
    select
      pi.id as invite_id,
      pi.party_id,
      pi.inviter_user_id,
      p.display_name as inviter_display_name,
      pi.invitee_user_id,
      pi.created_at
    from public.party_invites pi
    join public.profiles p on p.id = pi.inviter_user_id
    join public.parties pa on pa.id = pi.party_id
    where pi.invitee_user_id = v_uid
      and pi.status = 'pending'
      and pa.status in ('open', 'queued')
    order by pi.created_at desc;
end;
$$;


-- ============================================================
-- 3. BANPICK RPCs
-- ============================================================

-- rpc_create_banpick_session
CREATE OR REPLACE FUNCTION public.rpc_create_banpick_session(
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_alpha_team record;
  v_bravo_team record;
  v_existing_session_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id;

  if v_match is null then
    raise exception 'マッチが見つかりません';
  end if;

  if v_match.status <> 'banpick' then
    raise exception 'このマッチはバンピック状態ではありません';
  end if;

  -- Check user is in this match
  if not exists (
    select 1 from public.match_team_members mtm
    join public.match_teams mt on mt.id = mtm.match_team_id
    where mt.match_id = p_match_id and mtm.user_id = v_uid
  ) then
    raise exception 'このマッチの参加者ではありません';
  end if;

  -- Check no session exists yet
  select id into v_existing_session_id
  from public.banpick_sessions
  where match_id = p_match_id;

  if v_existing_session_id is not null then
    raise exception 'バンピックセッションは既に存在します';
  end if;

  select * into v_alpha_team from public.match_teams where match_id = p_match_id and side = 'alpha';
  select * into v_bravo_team from public.match_teams where match_id = p_match_id and side = 'bravo';

  -- Create session: team_a = alpha (first ban), team_b = bravo
  insert into public.banpick_sessions (
    match_id, status, phase,
    current_turn_match_team_id, current_action_type,
    turn_number,
    selected_maps,
    deadline_at, last_action_at
  )
  values (
    p_match_id, 'in_progress', 'hp',
    v_alpha_team.id, 'ban',
    1,
    jsonb_build_object(
      'hp', jsonb_build_object('bans', '[]'::jsonb, 'map', null, 'side', null),
      'snd', jsonb_build_object('bans', '[]'::jsonb, 'map', null, 'side', null),
      'ovl', jsonb_build_object('bans', '[]'::jsonb, 'map', null, 'side', null),
      'team_a', v_alpha_team.id,
      'team_b', v_bravo_team.id
    ),
    now() + interval '5 minutes',
    now()
  );
end;
$$;

-- rpc_submit_banpick_action
CREATE OR REPLACE FUNCTION public.rpc_submit_banpick_action(
  p_match_id uuid,
  p_action_type text,
  p_target text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_session record;
  v_my_match_team_id uuid;
  v_selected jsonb;
  v_phase text;
  v_phase_obj jsonb;
  v_bans jsonb;
  v_team_a uuid;
  v_team_b uuid;
  v_next_phase text;
  v_next_turn_team uuid;
  v_next_action text;
  v_next_turn integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Get user's match team
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = v_uid;

  if v_my_match_team_id is null then
    raise exception 'このマッチの参加者ではありません';
  end if;

  -- Get session
  select * into v_session
  from public.banpick_sessions
  where match_id = p_match_id
  for update;

  if v_session is null then
    raise exception 'バンピックセッションが見つかりません';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'バンピックは進行中ではありません';
  end if;

  if v_session.current_turn_match_team_id <> v_my_match_team_id then
    raise exception 'あなたのターンではありません';
  end if;

  if v_session.current_action_type <> p_action_type then
    raise exception 'アクションタイプが一致しません';
  end if;

  v_selected := v_session.selected_maps;
  v_phase := v_session.phase;
  v_team_a := (v_selected->>'team_a')::uuid;
  v_team_b := (v_selected->>'team_b')::uuid;

  -- Process the action
  if p_action_type = 'ban' then
    v_phase_obj := v_selected->v_phase;
    v_bans := v_phase_obj->'bans';
    v_bans := v_bans || to_jsonb(p_target);
    v_phase_obj := jsonb_set(v_phase_obj, '{bans}', v_bans);
    v_selected := jsonb_set(v_selected, array[v_phase], v_phase_obj);

  elsif p_action_type = 'pick_map' then
    v_phase_obj := v_selected->v_phase;
    v_phase_obj := jsonb_set(v_phase_obj, '{map}', to_jsonb(p_target));
    v_selected := jsonb_set(v_selected, array[v_phase], v_phase_obj);

  elsif p_action_type = 'pick_side' then
    v_phase_obj := v_selected->v_phase;
    v_phase_obj := jsonb_set(v_phase_obj, '{side}', to_jsonb(p_target));
    v_selected := jsonb_set(v_selected, array[v_phase], v_phase_obj);

  else
    raise exception 'invalid action_type: %', p_action_type;
  end if;

  -- Record the action
  insert into public.banpick_actions (
    banpick_session_id, match_id, actor_user_id, actor_match_team_id,
    turn_number, phase, action_type, target
  )
  values (
    v_session.id, p_match_id, v_uid, v_my_match_team_id,
    v_session.turn_number, v_phase, p_action_type, p_target
  );

  -- Determine next step
  -- Flow per phase: ban(team_a) -> ban(team_b) -> pick_map(team_b) -> pick_side(team_a)
  -- For hp: team_a bans, team_b bans, team_b picks, team_a picks side
  -- For snd: team_b bans, team_a bans, team_a picks, team_b picks side
  -- For ovl: team_a bans, team_b picks, team_a picks side (only 3 maps, 1 ban each is enough)
  -- Simplified flow: each phase has ban -> pick_map -> pick_side -> next phase

  -- Determine next state based on current phase and action
  if p_action_type = 'ban' then
    -- After first ban, the other team bans
    v_phase_obj := v_selected->v_phase;
    v_bans := v_phase_obj->'bans';
    if jsonb_array_length(v_bans) < 2 and v_phase <> 'ovl' then
      -- Need second ban (other team)
      v_next_turn_team := case when v_my_match_team_id = v_team_a then v_team_b else v_team_a end;
      v_next_action := 'ban';
      v_next_turn := v_session.turn_number + 1;
      v_next_phase := v_phase;
    else
      -- Bans done, move to pick_map (other team picks after ban)
      v_next_turn_team := case when v_my_match_team_id = v_team_a then v_team_b else v_team_a end;
      v_next_action := 'pick_map';
      v_next_turn := v_session.turn_number + 1;
      v_next_phase := v_phase;
    end if;

  elsif p_action_type = 'pick_map' then
    -- After pick_map, the other team picks side
    v_next_turn_team := case when v_my_match_team_id = v_team_a then v_team_b else v_team_a end;
    v_next_action := 'pick_side';
    v_next_turn := v_session.turn_number + 1;
    v_next_phase := v_phase;

  elsif p_action_type = 'pick_side' then
    -- Phase complete, move to next phase
    if v_phase = 'hp' then
      v_next_phase := 'snd';
      -- For snd: team_b starts the banning
      v_next_turn_team := v_team_b;
      v_next_action := 'ban';
      v_next_turn := 1;
    elsif v_phase = 'snd' then
      v_next_phase := 'ovl';
      -- For ovl: team_a starts the banning
      v_next_turn_team := v_team_a;
      v_next_action := 'ban';
      v_next_turn := 1;
    elsif v_phase = 'ovl' then
      -- All phases complete
      v_next_phase := 'completed';
      v_next_turn_team := null;
      v_next_action := null;
      v_next_turn := 0;
    end if;
  end if;

  -- Update session
  if v_next_phase = 'completed' then
    update public.banpick_sessions
    set status = 'completed',
        phase = 'completed',
        selected_maps = v_selected,
        current_turn_match_team_id = null,
        current_action_type = null,
        turn_number = 0,
        completed_at = now(),
        deadline_at = null,
        last_action_at = now(),
        updated_at = now()
    where id = v_session.id;

    -- Update match status
    update public.matches
    set status = 'ready', started_at = now()
    where id = p_match_id;

    -- System message
    insert into public.match_messages (match_id, sender_user_id, message_type, body)
    values (p_match_id, null, 'system', 'banpick completed');
  else
    update public.banpick_sessions
    set phase = v_next_phase,
        selected_maps = v_selected,
        current_turn_match_team_id = v_next_turn_team,
        current_action_type = v_next_action,
        turn_number = v_next_turn,
        deadline_at = now() + interval '5 minutes',
        last_action_at = now(),
        updated_at = now()
    where id = v_session.id;
  end if;
end;
$$;

-- rpc_resolve_banpick_timeout
CREATE OR REPLACE FUNCTION public.rpc_resolve_banpick_timeout(
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_session record;
  v_loser_team_id uuid;
  v_winner_team_id uuid;
  v_alpha_team record;
  v_bravo_team record;
begin
  select * into v_session
  from public.banpick_sessions
  where match_id = p_match_id
  for update;

  if v_session is null then
    return; -- no session
  end if;

  if v_session.status <> 'in_progress' then
    return; -- already resolved
  end if;

  if v_session.deadline_at is null or now() < v_session.deadline_at then
    return; -- not timed out yet
  end if;

  -- The team whose turn it is loses
  v_loser_team_id := v_session.current_turn_match_team_id;

  select * into v_alpha_team from public.match_teams where match_id = p_match_id and side = 'alpha';
  select * into v_bravo_team from public.match_teams where match_id = p_match_id and side = 'bravo';

  if v_loser_team_id = v_alpha_team.id then
    v_winner_team_id := v_bravo_team.id;
  else
    v_winner_team_id := v_alpha_team.id;
  end if;

  -- Mark session as timeout
  update public.banpick_sessions
  set status = 'timeout',
      deadline_at = null,
      updated_at = now()
  where id = v_session.id;

  -- Complete the match with the timeout result
  update public.matches
  set status = 'completed',
      approval_status = 'approved',
      winner_match_team_id = v_winner_team_id,
      loser_match_team_id = v_loser_team_id,
      completed_at = now()
  where id = p_match_id;

  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', 'banpick timeout: action side lost');
end;
$$;

-- rpc_toggle_trophy_user
CREATE OR REPLACE FUNCTION public.rpc_toggle_trophy_user(
  p_match_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_my_match_team_id uuid;
  v_target_match_team_id uuid;
  v_team record;
  v_current_list jsonb;
  v_member_count integer;
  v_max_trophy integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Get caller's match team
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = v_uid;

  if v_my_match_team_id is null then
    raise exception 'このマッチの参加者ではありません';
  end if;

  -- Get target user's match team
  select mtm.match_team_id into v_target_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = p_user_id;

  if v_target_match_team_id is null then
    raise exception '対象ユーザーがこのマッチに見つかりません';
  end if;

  -- Must be same team
  if v_my_match_team_id <> v_target_match_team_id then
    raise exception '同じチームのメンバーのみ選択できます';
  end if;

  select * into v_team
  from public.match_teams
  where id = v_my_match_team_id
  for update;

  v_current_list := coalesce(v_team.trophy_users, '[]'::jsonb);

  -- Count members to determine max trophy slots
  select count(*) into v_member_count
  from public.match_team_members
  where match_team_id = v_my_match_team_id;

  v_max_trophy := case when v_member_count <= 2 then v_member_count else 2 end;

  -- Toggle: remove if present, add if not
  if v_current_list ? p_user_id::text then
    -- Remove
    v_current_list := (
      select coalesce(jsonb_agg(elem), '[]'::jsonb)
      from jsonb_array_elements(v_current_list) as elem
      where elem #>> '{}' <> p_user_id::text
    );
  else
    -- Add (check limit)
    if jsonb_array_length(v_current_list) >= v_max_trophy then
      raise exception 'trophy users limit: max % per team', v_max_trophy;
    end if;
    v_current_list := v_current_list || to_jsonb(p_user_id::text);
  end if;

  update public.match_teams
  set trophy_users = v_current_list
  where id = v_my_match_team_id;
end;
$$;

-- rpc_toggle_sr_user
CREATE OR REPLACE FUNCTION public.rpc_toggle_sr_user(
  p_match_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_my_match_team_id uuid;
  v_target_match_team_id uuid;
  v_team record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Get caller's match team
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = v_uid;

  if v_my_match_team_id is null then
    raise exception 'このマッチの参加者ではありません';
  end if;

  -- Get target user's match team
  select mtm.match_team_id into v_target_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = p_user_id;

  if v_target_match_team_id is null then
    raise exception '対象ユーザーがこのマッチに見つかりません';
  end if;

  -- Must be same team
  if v_my_match_team_id <> v_target_match_team_id then
    raise exception '同じチームのメンバーのみ選択できます';
  end if;

  select * into v_team
  from public.match_teams
  where id = v_my_match_team_id
  for update;

  -- Toggle: clear if already set to this user, otherwise set
  if v_team.sr_user = p_user_id::text then
    update public.match_teams
    set sr_user = null
    where id = v_my_match_team_id;
  else
    update public.match_teams
    set sr_user = p_user_id::text
    where id = v_my_match_team_id;
  end if;
end;
$$;

-- rpc_select_match_host
CREATE OR REPLACE FUNCTION public.rpc_select_match_host(
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_match record;
  v_host_user_id uuid;
  v_host_match_team_id uuid;
begin
  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if v_match is null then
    raise exception 'マッチが見つかりません';
  end if;

  -- Already has a host
  if v_match.host_user_id is not null then
    return;
  end if;

  -- Pick a random party leader from the match
  select mtm.user_id, mtm.match_team_id
  into v_host_user_id, v_host_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id
    and mtm.is_party_leader = true
  order by random()
  limit 1;

  -- Fallback: pick any member
  if v_host_user_id is null then
    select mtm.user_id, mtm.match_team_id
    into v_host_user_id, v_host_match_team_id
    from public.match_team_members mtm
    join public.match_teams mt on mt.id = mtm.match_team_id
    where mt.match_id = p_match_id
    order by random()
    limit 1;
  end if;

  if v_host_user_id is null then
    raise exception 'ホスト候補が見つかりません';
  end if;

  update public.matches
  set host_user_id = v_host_user_id,
      host_match_team_id = v_host_match_team_id,
      host_selected_at = now()
  where id = p_match_id;
end;
$$;

-- rpc_send_lobby_code
CREATE OR REPLACE FUNCTION public.rpc_send_lobby_code(
  p_match_id uuid,
  p_lobby_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Verify user is in this match
  if not exists (
    select 1 from public.match_team_members mtm
    join public.match_teams mt on mt.id = mtm.match_team_id
    where mt.match_id = p_match_id and mtm.user_id = v_uid
  ) then
    raise exception 'このマッチの参加者ではありません';
  end if;

  update public.matches
  set lobby_code = p_lobby_code,
      lobby_code_set_by_user_id = v_uid,
      lobby_code_set_at = now()
  where id = p_match_id;

  -- Send system message
  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, v_uid, 'lobby_code', p_lobby_code);
end;
$$;

-- rpc_send_match_message
CREATE OR REPLACE FUNCTION public.rpc_send_match_message(
  p_match_id uuid,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Verify user is in this match
  if not exists (
    select 1 from public.match_team_members mtm
    join public.match_teams mt on mt.id = mtm.match_team_id
    where mt.match_id = p_match_id and mtm.user_id = v_uid
  ) then
    raise exception 'このマッチの参加者ではありません';
  end if;

  if length(trim(p_body)) = 0 then
    raise exception 'メッセージが空です';
  end if;

  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, v_uid, 'text', trim(left(p_body, 300)));
end;
$$;


-- ============================================================
-- 4. MATCH REPORT RPCs
-- ============================================================

-- rpc_submit_match_report
CREATE OR REPLACE FUNCTION public.rpc_submit_match_report(
  p_match_id uuid,
  p_winner_match_team_id uuid,
  p_score_summary text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_games_json jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_my_match_team_id uuid;
  v_match record;
  v_report_id uuid;
  v_game record;
  v_existing_pending uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Get user's match team
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id and mtm.user_id = v_uid;

  if v_my_match_team_id is null then
    raise exception 'このマッチの参加者ではありません';
  end if;

  select * into v_match from public.matches where id = p_match_id;

  if v_match is null then
    raise exception 'マッチが見つかりません';
  end if;

  if v_match.status = 'completed' then
    raise exception 'このマッチは既に完了しています';
  end if;

  -- Check for existing pending report
  select id into v_existing_pending
  from public.match_reports
  where match_id = p_match_id and status = 'pending';

  if v_existing_pending is not null then
    raise exception '既に承認待ちのレポートがあります';
  end if;

  -- Validate winner team belongs to this match
  if not exists (
    select 1 from public.match_teams where id = p_winner_match_team_id and match_id = p_match_id
  ) then
    raise exception '無効な勝者チームです';
  end if;

  -- Create report
  insert into public.match_reports (
    match_id, submitted_by_user_id, submitted_by_match_team_id,
    status, winner_match_team_id, score_summary, notes,
    submitted_at, deadline_at
  )
  values (
    p_match_id, v_uid, v_my_match_team_id,
    'pending', p_winner_match_team_id, p_score_summary, p_notes,
    now(), now() + interval '1 hour'
  )
  returning id into v_report_id;

  -- Insert games if provided
  if jsonb_array_length(p_games_json) > 0 then
    for v_game in select * from jsonb_to_recordset(p_games_json) as x(
      game_number int, mode text, map_name text, winner_match_team_id uuid, was_played boolean
    )
    loop
      insert into public.match_report_games (
        report_id, game_number, mode, map_name, winner_match_team_id, was_played
      )
      values (
        v_report_id, v_game.game_number, v_game.mode, v_game.map_name,
        v_game.winner_match_team_id, coalesce(v_game.was_played, true)
      );
    end loop;
  end if;

  -- Update match status
  update public.matches
  set status = 'report_pending'
  where id = p_match_id and status <> 'completed';

  -- System message
  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', 'match report submitted');
end;
$$;

-- rpc_approve_match_report
CREATE OR REPLACE FUNCTION public.rpc_approve_match_report(
  p_report_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_report record;
  v_my_match_team_id uuid;
  v_winner_team_id uuid;
  v_loser_team_id uuid;
  v_match_id uuid;
  r_member record;
  v_winner_avg numeric;
  v_loser_avg numeric;
  v_k integer := 32;
  v_expected numeric;
  v_delta integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_report
  from public.match_reports
  where id = p_report_id
  for update;

  if v_report is null then
    raise exception 'レポートが見つかりません';
  end if;

  if v_report.status <> 'pending' then
    raise exception 'このレポートは既に処理済みです';
  end if;

  v_match_id := v_report.match_id;

  -- Get approver's match team
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = v_match_id and mtm.user_id = v_uid;

  if v_my_match_team_id is null then
    raise exception 'このマッチの参加者ではありません';
  end if;

  -- Cannot approve own team's report
  if v_my_match_team_id = v_report.submitted_by_match_team_id then
    raise exception '自分のチームのレポートは承認できません';
  end if;

  v_winner_team_id := v_report.winner_match_team_id;

  -- Determine loser team
  select id into v_loser_team_id
  from public.match_teams
  where match_id = v_match_id and id <> v_winner_team_id
  limit 1;

  -- Approve the report
  update public.match_reports
  set status = 'approved', decided_at = now()
  where id = p_report_id;

  -- Record the vote
  insert into public.match_report_votes (report_id, voter_user_id, voter_match_team_id, vote)
  values (p_report_id, v_uid, v_my_match_team_id, 'approve');

  -- Complete the match
  update public.matches
  set status = 'completed',
      approval_status = 'approved',
      winner_match_team_id = v_winner_team_id,
      loser_match_team_id = v_loser_team_id,
      completed_at = now()
  where id = v_match_id;

  -- Calculate and apply rating changes (Elo-based)
  select avg(mtm.rating_before) into v_winner_avg
  from public.match_team_members mtm
  where mtm.match_team_id = v_winner_team_id;

  select avg(mtm.rating_before) into v_loser_avg
  from public.match_team_members mtm
  where mtm.match_team_id = v_loser_team_id;

  -- Apply rating to winners
  v_expected := 1.0 / (1.0 + power(10.0, (coalesce(v_loser_avg, 1500) - coalesce(v_winner_avg, 1500)) / 400.0));
  v_delta := greatest(1, round(v_k * (1.0 - v_expected)));

  for r_member in
    select mtm.user_id, mtm.rating_before
    from public.match_team_members mtm
    where mtm.match_team_id = v_winner_team_id
  loop
    update public.profiles
    set current_rating = coalesce(current_rating, 1500) + v_delta,
        wins = coalesce(wins, 0) + 1,
        win_streak = coalesce(win_streak, 0) + 1
    where id = r_member.user_id;

    update public.match_team_members
    set rating_after = coalesce(r_member.rating_before, 1500) + v_delta,
        rating_delta = v_delta
    where match_team_id = v_winner_team_id and user_id = r_member.user_id;

    insert into public.rating_history (user_id, match_id, rating_before, rating_after, rating_delta, reason)
    values (r_member.user_id, v_match_id, r_member.rating_before, coalesce(r_member.rating_before, 1500) + v_delta, v_delta, 'match_win');
  end loop;

  -- Apply rating to losers
  v_expected := 1.0 / (1.0 + power(10.0, (coalesce(v_winner_avg, 1500) - coalesce(v_loser_avg, 1500)) / 400.0));
  v_delta := greatest(1, round(v_k * v_expected));

  for r_member in
    select mtm.user_id, mtm.rating_before
    from public.match_team_members mtm
    where mtm.match_team_id = v_loser_team_id
  loop
    update public.profiles
    set current_rating = greatest(0, coalesce(current_rating, 1500) - v_delta),
        losses = coalesce(losses, 0) + 1,
        win_streak = 0
    where id = r_member.user_id;

    update public.match_team_members
    set rating_after = greatest(0, coalesce(r_member.rating_before, 1500) - v_delta),
        rating_delta = -v_delta
    where match_team_id = v_loser_team_id and user_id = r_member.user_id;

    insert into public.rating_history (user_id, match_id, rating_before, rating_after, rating_delta, reason)
    values (r_member.user_id, v_match_id, r_member.rating_before, greatest(0, coalesce(r_member.rating_before, 1500) - v_delta), -v_delta, 'match_loss');
  end loop;

  -- System message
  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (v_match_id, null, 'system', 'match report approved');
end;
$$;

-- rpc_reject_match_report
CREATE OR REPLACE FUNCTION public.rpc_reject_match_report(
  p_report_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_report record;
  v_my_match_team_id uuid;
  v_match_id uuid;
  v_prior_rejects integer;
  v_winner_team_id uuid;
  v_loser_team_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_report
  from public.match_reports
  where id = p_report_id
  for update;

  if v_report is null then
    raise exception 'レポートが見つかりません';
  end if;

  if v_report.status <> 'pending' then
    raise exception 'このレポートは既に処理済みです';
  end if;

  v_match_id := v_report.match_id;

  -- Get rejecter's match team
  select mtm.match_team_id into v_my_match_team_id
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = v_match_id and mtm.user_id = v_uid;

  if v_my_match_team_id is null then
    raise exception 'このマッチの参加者ではありません';
  end if;

  -- Cannot reject own team's report
  if v_my_match_team_id = v_report.submitted_by_match_team_id then
    raise exception '自分のチームのレポートは却下できません';
  end if;

  -- Record the vote
  insert into public.match_report_votes (report_id, voter_user_id, voter_match_team_id, vote, reason)
  values (p_report_id, v_uid, v_my_match_team_id, 'reject', p_reason);

  -- Count prior rejections for this match
  select count(*) into v_prior_rejects
  from public.match_reports
  where match_id = v_match_id and status = 'rejected';

  -- Reject the report
  update public.match_reports
  set status = 'rejected', decided_at = now()
  where id = p_report_id;

  if v_prior_rejects >= 1 then
    -- 2nd rejection: void the match
    update public.matches
    set status = 'completed',
        approval_status = 'voided',
        completed_at = now()
    where id = v_match_id;

    insert into public.match_messages (match_id, sender_user_id, message_type, body)
    values (v_match_id, null, 'system', 'match voided after 2 rejections');
  else
    -- First rejection: allow re-submit
    update public.matches
    set status = 'report_pending'
    where id = v_match_id;

    insert into public.match_messages (match_id, sender_user_id, message_type, body)
    values (v_match_id, null, 'system', 'match report rejected');
  end if;
end;
$$;

-- rpc_mark_report_visited
CREATE OR REPLACE FUNCTION public.rpc_mark_report_visited(
  p_match_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_total integer;
  v_visited integer;
  v_all_visited boolean;
  v_pending_report record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Mark this user as having visited the report page
  update public.match_team_members mtm
  set report_visited_at = coalesce(mtm.report_visited_at, now())
  from public.match_teams mt
  where mt.id = mtm.match_team_id
    and mt.match_id = p_match_id
    and mtm.user_id = v_uid;

  -- Count total and visited members
  select count(*), count(mtm.report_visited_at)
  into v_total, v_visited
  from public.match_team_members mtm
  join public.match_teams mt on mt.id = mtm.match_team_id
  where mt.match_id = p_match_id;

  v_all_visited := (v_total > 0 and v_total = v_visited);

  -- If all visited, shorten the deadline to 5 minutes from now
  if v_all_visited then
    select * into v_pending_report
    from public.match_reports
    where match_id = p_match_id and status = 'pending'
    order by submitted_at desc
    limit 1;

    if v_pending_report is not null and v_pending_report.deadline_at > now() + interval '5 minutes' then
      update public.match_reports
      set deadline_at = now() + interval '5 minutes'
      where id = v_pending_report.id;

      insert into public.match_messages (match_id, sender_user_id, message_type, body)
      values (p_match_id, null, 'system', 'all players on report page, deadline shortened to 5 min');
    end if;
  end if;

  return json_build_object(
    'all_visited', v_all_visited,
    'total', v_total,
    'visited', v_visited
  );
end;
$$;

-- rpc_resolve_report_timeout
CREATE OR REPLACE FUNCTION public.rpc_resolve_report_timeout(
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_report record;
  v_winner_team_id uuid;
  v_loser_team_id uuid;
  r_member record;
  v_winner_avg numeric;
  v_loser_avg numeric;
  v_k integer := 32;
  v_expected numeric;
  v_delta integer;
begin
  select * into v_report
  from public.match_reports
  where match_id = p_match_id and status = 'pending'
  order by submitted_at desc
  limit 1
  for update;

  if v_report is null then
    return;
  end if;

  if v_report.deadline_at is null or now() < v_report.deadline_at then
    return; -- not timed out yet
  end if;

  v_winner_team_id := v_report.winner_match_team_id;

  select id into v_loser_team_id
  from public.match_teams
  where match_id = p_match_id and id <> v_winner_team_id
  limit 1;

  -- Auto-approve the report
  update public.match_reports
  set status = 'approved', decided_at = now()
  where id = v_report.id;

  -- Complete the match
  update public.matches
  set status = 'completed',
      approval_status = 'approved',
      winner_match_team_id = v_winner_team_id,
      loser_match_team_id = v_loser_team_id,
      completed_at = now()
  where id = p_match_id;

  -- Calculate and apply rating changes (same Elo logic as approve)
  select avg(mtm.rating_before) into v_winner_avg
  from public.match_team_members mtm
  where mtm.match_team_id = v_winner_team_id;

  select avg(mtm.rating_before) into v_loser_avg
  from public.match_team_members mtm
  where mtm.match_team_id = v_loser_team_id;

  v_expected := 1.0 / (1.0 + power(10.0, (coalesce(v_loser_avg, 1500) - coalesce(v_winner_avg, 1500)) / 400.0));
  v_delta := greatest(1, round(v_k * (1.0 - v_expected)));

  for r_member in
    select mtm.user_id, mtm.rating_before
    from public.match_team_members mtm
    where mtm.match_team_id = v_winner_team_id
  loop
    update public.profiles
    set current_rating = coalesce(current_rating, 1500) + v_delta,
        wins = coalesce(wins, 0) + 1,
        win_streak = coalesce(win_streak, 0) + 1
    where id = r_member.user_id;

    update public.match_team_members
    set rating_after = coalesce(r_member.rating_before, 1500) + v_delta,
        rating_delta = v_delta
    where match_team_id = v_winner_team_id and user_id = r_member.user_id;

    insert into public.rating_history (user_id, match_id, rating_before, rating_after, rating_delta, reason)
    values (r_member.user_id, p_match_id, r_member.rating_before, coalesce(r_member.rating_before, 1500) + v_delta, v_delta, 'match_win');
  end loop;

  v_expected := 1.0 / (1.0 + power(10.0, (coalesce(v_winner_avg, 1500) - coalesce(v_loser_avg, 1500)) / 400.0));
  v_delta := greatest(1, round(v_k * v_expected));

  for r_member in
    select mtm.user_id, mtm.rating_before
    from public.match_team_members mtm
    where mtm.match_team_id = v_loser_team_id
  loop
    update public.profiles
    set current_rating = greatest(0, coalesce(current_rating, 1500) - v_delta),
        losses = coalesce(losses, 0) + 1,
        win_streak = 0
    where id = r_member.user_id;

    update public.match_team_members
    set rating_after = greatest(0, coalesce(r_member.rating_before, 1500) - v_delta),
        rating_delta = -v_delta
    where match_team_id = v_loser_team_id and user_id = r_member.user_id;

    insert into public.rating_history (user_id, match_id, rating_before, rating_after, rating_delta, reason)
    values (r_member.user_id, p_match_id, r_member.rating_before, greatest(0, coalesce(r_member.rating_before, 1500) - v_delta), -v_delta, 'match_loss');
  end loop;

  insert into public.match_messages (match_id, sender_user_id, message_type, body)
  values (p_match_id, null, 'system', 'report auto-approved after timeout');
end;
$$;


-- ============================================================
-- 5. OTHER RPCs
-- ============================================================

-- rpc_admin_ban_by_report (rewrite to match frontend call signature)
CREATE OR REPLACE FUNCTION public.rpc_admin_ban_by_report(
  p_user_id uuid,
  p_category text,
  p_report_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_prior_count integer;
  v_is_permanent boolean := false;
  v_ban_until timestamptz;
  v_ban_months integer;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'unauthorized: admin access required';
  end if;

  -- Cheat/converter = permanent ban
  if p_category in ('cheat', 'converter') then
    v_is_permanent := true;
  else
    -- Count prior bans for this user
    select count(*) into v_prior_count
    from public.ban_history
    where user_id = p_user_id;

    -- Graduated: 1st=1 month, 2nd=3 months, 3rd+=permanent
    if v_prior_count >= 2 then
      v_is_permanent := true;
    else
      v_ban_months := case when v_prior_count = 0 then 1 else 3 end;
      v_ban_until := now() + (v_ban_months || ' months')::interval;
    end if;
  end if;

  -- Record in ban_history
  insert into public.ban_history (user_id, category, ban_until, is_permanent, banned_by, report_id)
  values (p_user_id, p_category, v_ban_until, v_is_permanent, auth.uid(), p_report_id);

  -- Ban the user
  update public.profiles
  set is_banned = true
  where id = p_user_id;

  -- Update report status
  update public.reports
  set status = 'resolved', reviewed_at = now()
  where id = p_report_id;

  return json_build_object(
    'is_permanent', v_is_permanent,
    'ban_until', v_ban_until,
    'prior_count', coalesce(v_prior_count, 0)
  );
end;
$$;

-- rpc_get_season_ranking
CREATE OR REPLACE FUNCTION public.rpc_get_season_ranking(
  p_season_id uuid
)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  games_played bigint,
  wins bigint,
  losses bigint,
  rating_change numeric,
  end_rating integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_season record;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if v_season is null then
    return;
  end if;

  return query
    select
      mtm.user_id,
      p.display_name,
      count(*)::bigint as games_played,
      count(*) filter (where m.winner_match_team_id = mtm.match_team_id)::bigint as wins,
      count(*) filter (where m.loser_match_team_id = mtm.match_team_id)::bigint as losses,
      coalesce(sum(mtm.rating_delta), 0)::numeric as rating_change,
      p.current_rating as end_rating
    from public.match_team_members mtm
    join public.match_teams mt on mt.id = mtm.match_team_id
    join public.matches m on m.id = mt.match_id
    join public.profiles p on p.id = mtm.user_id
    where m.status = 'completed'
      and m.approval_status = 'approved'
      and m.completed_at >= v_season.start_date::timestamptz
      and m.completed_at < (v_season.end_date::date + 1)::timestamptz
      and p.is_banned = false
    group by mtm.user_id, p.display_name, p.current_rating
    order by p.current_rating desc nulls last, wins desc
    limit 200;
end;
$$;

-- rpc_get_controller_ranking
CREATE OR REPLACE FUNCTION public.rpc_get_controller_ranking(
  p_min_games integer DEFAULT 5
)
RETURNS TABLE(
  controller text,
  user_count bigint,
  avg_rating numeric,
  avg_wins numeric,
  avg_losses numeric,
  avg_win_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  return query
    select
      u.controller,
      count(distinct u.auth_user_id)::bigint as user_count,
      round(avg(p.current_rating)::numeric, 0) as avg_rating,
      round(avg(p.wins)::numeric, 1) as avg_wins,
      round(avg(p.losses)::numeric, 1) as avg_losses,
      round(
        case
          when avg(coalesce(p.wins, 0) + coalesce(p.losses, 0)) > 0
          then avg(p.wins) * 100.0 / avg(coalesce(p.wins, 0) + coalesce(p.losses, 0))
          else 0
        end::numeric, 1
      ) as avg_win_rate
    from public.users u
    join public.profiles p on p.id = u.auth_user_id
    where u.controller is not null
      and u.controller <> ''
      and p.is_banned = false
      and (coalesce(p.wins, 0) + coalesce(p.losses, 0)) >= p_min_games
    group by u.controller
    order by avg(p.current_rating) desc nulls last;
end;
$$;

-- rpc_list_my_reports
CREATE OR REPLACE FUNCTION public.rpc_list_my_reports()
RETURNS TABLE(
  id uuid,
  reported_user_id uuid,
  reported_display_name text,
  match_id uuid,
  category text,
  description text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
    select
      r.id,
      r.reported_user_id,
      p.display_name as reported_display_name,
      r.match_id,
      r.category,
      r.description,
      r.status,
      r.created_at
    from public.reports r
    left join public.profiles p on p.id = r.reported_user_id
    where r.reporter_user_id = v_uid
    order by r.created_at desc;
end;
$$;

-- rpc_monitor_report
-- Monitor users can file reports that trigger instant suspension
-- 2 monitor reports on the same user = 24h suspension
CREATE OR REPLACE FUNCTION public.rpc_monitor_report(
  p_reported_user_id uuid,
  p_category text,
  p_match_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_is_monitor boolean;
  v_active_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select is_monitor into v_is_monitor
  from public.profiles
  where id = v_uid;

  if not coalesce(v_is_monitor, false) then
    raise exception '監視ユーザー権限がありません';
  end if;

  if v_uid = p_reported_user_id then
    raise exception '自分自身を通報できません';
  end if;

  -- Insert monitor report
  insert into public.monitor_reports (reporter_user_id, reported_user_id, category, match_id, status)
  values (v_uid, p_reported_user_id, p_category, p_match_id, 'active');

  -- Also create a regular report for admin tracking
  insert into public.reports (reporter_user_id, reported_user_id, match_id, category, description, status)
  values (v_uid, p_reported_user_id, p_match_id, p_category, p_description, 'open');

  -- Count active monitor reports for this user
  select count(*) into v_active_count
  from public.monitor_reports
  where reported_user_id = p_reported_user_id
    and status = 'active';

  -- 2 or more active monitor reports -> 24h suspension
  if v_active_count >= 2 then
    update public.profiles
    set suspended_until = now() + interval '24 hours'
    where id = p_reported_user_id;

    insert into public.suspensions (user_id, reason, suspended_until, created_by)
    values (p_reported_user_id, '監視ユーザーによる通報（' || p_category || '）', now() + interval '24 hours', v_uid);
  end if;
end;
$$;

-- rpc_create_report (regular user report)
CREATE OR REPLACE FUNCTION public.rpc_create_report(
  p_reported_user_id uuid,
  p_category text,
  p_description text DEFAULT NULL,
  p_match_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_uid = p_reported_user_id then
    raise exception '自分自身を通報できません';
  end if;

  -- Check caller is not banned
  if exists (select 1 from public.profiles where id = v_uid and is_banned = true) then
    raise exception 'BANされているため通報できません';
  end if;

  insert into public.reports (reporter_user_id, reported_user_id, match_id, category, description, status)
  values (v_uid, p_reported_user_id, p_match_id, p_category, p_description, 'open');
end;
$$;

-- rpc_get_active_match_for_queue_entries (used on match page)
CREATE OR REPLACE FUNCTION public.rpc_get_active_match_for_queue_entries(
  p_queue_entry_ids uuid[]
)
RETURNS TABLE(
  match_id uuid,
  match_status text,
  matched_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  return query
    select distinct m.id as match_id, m.status as match_status, m.matched_at
    from public.matches m
    join public.match_teams mt on mt.match_id = m.id
    join public.match_team_members mtm on mtm.match_team_id = mt.id
    where mtm.source_queue_entry_id = any(p_queue_entry_ids)
      and m.status in ('banpick', 'ready', 'in_progress', 'report_pending')
    order by m.matched_at desc
    limit 1;
end;
$$;

-- rpc_cancel_queue (used on match page)
CREATE OR REPLACE FUNCTION public.rpc_cancel_queue(
  p_queue_entry_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_entry record;
  v_party record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_entry
  from public.queue_entries
  where id = p_queue_entry_id
  for update;

  if v_entry is null then
    raise exception 'キューエントリーが見つかりません';
  end if;

  if v_entry.status = 'matched' then
    raise exception 'already matched';
  end if;

  if v_entry.status <> 'waiting' then
    raise exception 'キューエントリーは待機状態ではありません';
  end if;

  -- Verify caller is the party leader
  select * into v_party
  from public.parties
  where id = v_entry.party_id;

  if v_party is null or v_party.leader_user_id <> v_uid then
    raise exception 'パーティリーダーのみキャンセルできます';
  end if;

  -- Cancel the queue entry
  update public.queue_entries
  set status = 'cancelled', cancelled_at = now()
  where id = p_queue_entry_id;

  -- Update party status back to open
  update public.parties
  set status = 'open', updated_at = now()
  where id = v_entry.party_id;
end;
$$;

-- rpc_admin_update_report (fix param name to match frontend: p_admin_notes)
CREATE OR REPLACE FUNCTION public.rpc_admin_update_report(
  p_report_id uuid,
  p_status text,
  p_admin_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'unauthorized: admin access required';
  end if;

  update public.reports
  set status = p_status,
      admin_notes = coalesce(p_admin_notes, admin_notes),
      reviewed_at = now()
  where id = p_report_id;
end;
$$;

-- rpc_admin_list_reports (fix to accept null for all statuses)
CREATE OR REPLACE FUNCTION public.rpc_admin_list_reports(
  p_status text DEFAULT NULL
)
RETURNS SETOF public.reports
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'unauthorized: admin access required';
  end if;

  return query
    select * from public.reports
    where (p_status is null or status = p_status)
    order by created_at desc
    limit 100;
end;
$$;

-- rpc_admin_ban_user (fix to accept p_ban boolean for toggling)
CREATE OR REPLACE FUNCTION public.rpc_admin_ban_user(
  p_user_id uuid,
  p_ban boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'unauthorized: admin access required';
  end if;

  update public.profiles
  set is_banned = p_ban
  where id = p_user_id;
end;
$$;
