-- =============================================================
-- チーム管理RPC: 脱退 / メンバー追放 / オーナー譲渡 / 解散
-- 既存の create_team_atomic / join_team_atomic と同じ規約:
--   SECURITY DEFINER + auth.uid() 検証 + json_build_object('ok', true)
-- =============================================================

-- ---------------------------------------------------------------
-- チーム脱退 (オーナー以外)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_team_atomic(
  p_team_id uuid,
  p_actor_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team record;
  v_member record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_uid <> p_actor_user_id THEN RAISE EXCEPTION '自分自身のみ脱退できます'; END IF;

  SELECT * INTO v_team FROM teams WHERE id = p_team_id FOR UPDATE;
  IF v_team IS NULL OR v_team.is_disbanded THEN RAISE EXCEPTION 'チームが見つかりません'; END IF;

  SELECT * INTO v_member FROM team_members WHERE team_id = p_team_id AND user_id = v_uid;
  IF v_member IS NULL THEN RAISE EXCEPTION 'このチームに所属していません'; END IF;

  IF v_team.owner_user_id = v_uid THEN
    RAISE EXCEPTION 'オーナーは脱退できません。オーナーを譲渡するか、チームを解散してください';
  END IF;

  DELETE FROM team_members WHERE id = v_member.id;
  DELETE FROM member_availability WHERE team_id = p_team_id AND user_id = v_uid;

  RETURN json_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------
-- メンバー追放 (オーナーのみ)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_team_member_atomic(
  p_team_member_id uuid,
  p_actor_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member record;
  v_team record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_uid <> p_actor_user_id THEN RAISE EXCEPTION '本人のみ操作できます'; END IF;

  SELECT * INTO v_member FROM team_members WHERE id = p_team_member_id;
  IF v_member IS NULL THEN RAISE EXCEPTION 'メンバーが見つかりません'; END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_member.team_id FOR UPDATE;
  IF v_team IS NULL OR v_team.is_disbanded THEN RAISE EXCEPTION 'チームが見つかりません'; END IF;
  IF v_team.owner_user_id <> v_uid THEN RAISE EXCEPTION 'メンバーの削除はチームオーナーのみ可能です'; END IF;
  IF v_member.user_id = v_uid THEN RAISE EXCEPTION '自分自身は削除できません。脱退または解散を使用してください'; END IF;

  DELETE FROM team_members WHERE id = p_team_member_id;
  DELETE FROM member_availability WHERE team_id = v_member.team_id AND user_id = v_member.user_id;

  RETURN json_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------
-- オーナー譲渡 (オーナーのみ / 譲渡先は同チームメンバー)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_team_owner_atomic(
  p_team_id uuid,
  p_new_owner_user_id uuid,
  p_actor_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_uid <> p_actor_user_id THEN RAISE EXCEPTION '本人のみ操作できます'; END IF;

  SELECT * INTO v_team FROM teams WHERE id = p_team_id FOR UPDATE;
  IF v_team IS NULL OR v_team.is_disbanded THEN RAISE EXCEPTION 'チームが見つかりません'; END IF;
  IF v_team.owner_user_id <> v_uid THEN RAISE EXCEPTION 'オーナー譲渡はチームオーナーのみ可能です'; END IF;
  IF p_new_owner_user_id = v_uid THEN RAISE EXCEPTION '自分自身には譲渡できません'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members WHERE team_id = p_team_id AND user_id = p_new_owner_user_id
  ) THEN
    RAISE EXCEPTION '譲渡先はチームメンバーである必要があります';
  END IF;

  UPDATE teams SET owner_user_id = p_new_owner_user_id, updated_at = now() WHERE id = p_team_id;
  UPDATE team_members SET role = 'owner' WHERE team_id = p_team_id AND user_id = p_new_owner_user_id;
  UPDATE team_members SET role = 'member' WHERE team_id = p_team_id AND user_id = v_uid;

  RETURN json_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------
-- チーム解散 (オーナーのみ / ソフトデリート)
--   - teams.is_disbanded = true (戦績・過去マッチ参照は保持)
--   - メンバー全削除、保留中の招待をキャンセル
--   - 確定済み交流戦をキャンセル (scrim_slot_counts はviewなので自動反映)
--   - 交流戦の空き時間・設定を削除
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disband_team_atomic(
  p_team_id uuid,
  p_actor_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_team record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_uid <> p_actor_user_id THEN RAISE EXCEPTION '本人のみ操作できます'; END IF;

  SELECT * INTO v_team FROM teams WHERE id = p_team_id FOR UPDATE;
  IF v_team IS NULL OR v_team.is_disbanded THEN RAISE EXCEPTION 'チームが見つかりません'; END IF;
  IF v_team.owner_user_id <> v_uid THEN RAISE EXCEPTION 'チーム解散はチームオーナーのみ可能です'; END IF;

  UPDATE teams SET is_disbanded = true, updated_at = now() WHERE id = p_team_id;

  DELETE FROM team_members WHERE team_id = p_team_id;

  UPDATE team_invites
  SET status = 'cancelled', responded_at = now()
  WHERE team_id = p_team_id AND status = 'pending';

  UPDATE scrim_matches
  SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now()
  WHERE (host_team_id = p_team_id OR guest_team_id = p_team_id)
    AND status = 'confirmed';

  DELETE FROM member_availability WHERE team_id = p_team_id;
  DELETE FROM scrim_team_prefs WHERE team_id = p_team_id;
  DELETE FROM team_settings WHERE team_id = p_team_id;

  RETURN json_build_object('ok', true);
END;
$$;

-- PostgRESTスキーマキャッシュ更新
NOTIFY pgrst, 'reload schema';
