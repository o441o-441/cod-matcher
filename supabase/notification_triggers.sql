-- ============================================================
-- フレンド申請 / パーティ招待の通知トリガー
-- ============================================================

-- 1) フレンド申請を受けた時の通知
--    friendships テーブルに INSERT されたとき、受信者に通知
CREATE OR REPLACE FUNCTION public.trg_notify_friend_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_sender_name text;
begin
  -- status = 'pending' の新規行のみ対象
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  select display_name into v_sender_name
  from public.profiles
  where id = NEW.user_id_1;

  insert into public.notifications (user_id, type, body, link, is_read)
  values (
    NEW.user_id_2,
    'friend_request',
    coalesce(v_sender_name, '不明なユーザー') || ' からフレンド申請が届きました',
    '/friends',
    false
  );

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_notify_friend_request ON public.friendships;
CREATE TRIGGER trg_notify_friend_request
  AFTER INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_friend_request();


-- 2) フレンド申請が承認された時の通知
--    friendships テーブルの status が 'accepted' に変わったとき、申請者に通知
CREATE OR REPLACE FUNCTION public.trg_notify_friend_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_accepter_name text;
begin
  -- pending → accepted の変更のみ対象
  if OLD.status <> 'pending' or NEW.status <> 'accepted' then
    return NEW;
  end if;

  select display_name into v_accepter_name
  from public.profiles
  where id = NEW.user_id_2;

  insert into public.notifications (user_id, type, body, link, is_read)
  values (
    NEW.user_id_1,
    'friend_accepted',
    coalesce(v_accepter_name, '不明なユーザー') || ' がフレンド申請を承認しました',
    '/friends',
    false
  );

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_notify_friend_accepted ON public.friendships;
CREATE TRIGGER trg_notify_friend_accepted
  AFTER UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_friend_accepted();


-- 3) パーティ招待を受けた時の通知
--    party_invites テーブルに INSERT されたとき、招待先に通知
CREATE OR REPLACE FUNCTION public.trg_notify_party_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_inviter_name text;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  select display_name into v_inviter_name
  from public.profiles
  where id = NEW.inviter_user_id;

  insert into public.notifications (user_id, type, body, link, is_read)
  values (
    NEW.invitee_user_id,
    'party_invite',
    coalesce(v_inviter_name, '不明なユーザー') || ' からパーティ招待が届きました',
    '/match',
    false
  );

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_notify_party_invite ON public.party_invites;
CREATE TRIGGER trg_notify_party_invite
  AFTER INSERT ON public.party_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_party_invite();
