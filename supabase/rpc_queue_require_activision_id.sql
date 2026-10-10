-- ============================================================
-- キュー参加時の Activision ID 必須化
--
-- ランクマッチの成立後はゲーム内のロビー招待に Activision ID が
-- 必要なため、パーティ全員が users.activision_id を設定していないと
-- キューに入れないようにする (未設定メンバー名をエラーで提示)。
-- 他の変更なし (rpc_queue_existing_party の全文 + 1チェック追加)。
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_queue_existing_party(p_party_id uuid, p_queue_type text DEFAULT 'ranked'::text)
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
  v_missing_ids text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  if p_queue_type not in ('ranked', 'casual', 'fullparty_only', 'mixed', 'scrim') then
    raise exception 'invalid queue_type';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party is null then raise exception 'パーティが見つかりません'; end if;
  if v_party.leader_user_id <> v_uid then raise exception 'パーティリーダーのみキューに入れます'; end if;
  if v_party.status not in ('open', 'cancelled') then raise exception 'このパーティはキューに入れません'; end if;

  -- For scrim, use peak_rating instead of current_rating
  if p_queue_type = 'scrim' then
    select count(*), avg(p.peak_rating), min(p.peak_rating), max(p.peak_rating)
    into v_member_count, v_avg_rating, v_min_rating, v_max_rating
    from public.party_members pm
    join public.profiles p on p.id = pm.user_id
    where pm.party_id = p_party_id;
  else
    select count(*), avg(p.current_rating), min(p.current_rating), max(p.current_rating)
    into v_member_count, v_avg_rating, v_min_rating, v_max_rating
    from public.party_members pm
    join public.profiles p on p.id = pm.user_id
    where pm.party_id = p_party_id;
  end if;

  if v_member_count < 1 or v_member_count > 4 then raise exception 'パーティ人数が不正です'; end if;

  if exists (select 1 from public.party_members pm join public.profiles p on p.id = pm.user_id where pm.party_id = p_party_id and p.is_banned = true) then
    raise exception 'BANされたメンバーがいるためキューに入れません';
  end if;

  -- Activision ID 未設定のメンバーがいるとキュー不可 (ゲーム内のロビー招待に必須)
  select string_agg(coalesce(pr.display_name, '(名前未設定)'), '・') into v_missing_ids
  from public.party_members pm
  join public.profiles pr on pr.id = pm.user_id
  left join public.users u on u.auth_user_id = pm.user_id
  where pm.party_id = p_party_id
    and (u.activision_id is null or btrim(u.activision_id) = '');
  if v_missing_ids is not null then
    raise exception 'Activision ID未設定のメンバーがいます（%）。マイページのプロフィール編集から設定してください', v_missing_ids;
  end if;

  -- No synergy bonus for scrim
  if p_queue_type = 'scrim' then
    v_bonus := 0;
  else
    v_bonus := case
      when v_member_count = 1 then 0
      when v_member_count = 2 then 30
      when v_member_count = 3 then 60
      when v_member_count = 4 then 100
      else 0
    end;
  end if;

  update public.parties set status = 'queued', updated_at = now() where id = p_party_id;

  insert into public.queue_entries (party_id, queue_type, status, party_size, avg_rating, min_rating, max_rating, party_size_bonus, wait_expand_level)
  values (p_party_id, p_queue_type, 'waiting', v_member_count, v_avg_rating, v_min_rating, v_max_rating, v_bonus, 0)
  returning id into v_queue_entry_id;

  insert into public.queue_entry_members (queue_entry_id, user_id, rating_at_entry, is_party_leader)
  select v_queue_entry_id, pm.user_id, case when p_queue_type = 'scrim' then p.peak_rating else p.current_rating end, (pm.user_id = v_party.leader_user_id)
  from public.party_members pm
  join public.profiles p on p.id = pm.user_id
  where pm.party_id = p_party_id;
end;
$$;
