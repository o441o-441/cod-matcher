-- ============================================================
-- Discordの「参加する」ボタン対応
--
-- 8s開催告知にボタンを付けるため、告知送信を Webhook から
-- Bot送信 (Edge Function discord-8s-announce) に切替可能にする。
-- ボタン押下は Edge Function discord-interactions が受け、
-- 下の rpc_discord_eights_join で参加処理を行う。
--
-- 切替スイッチ: app_settings に以下が揃うと Bot送信になる
--   discord_announce_url — https://<project>.supabase.co/functions/v1/discord-8s-announce
--   edge_internal_secret — Edge Function と共有する認証シークレット
-- 未設定の間は従来の Webhook 送信のまま (フォールバック)。
-- ============================================================

ALTER TABLE public.eights_lobbies ADD COLUMN IF NOT EXISTS discord_message_id text;

-- ------------------------------------------------------------
-- Discord ID からの8sロビー参加 (service_role 専用)
-- 既存の rpc_eights_join_lobby を本人として実行し、検証ロジックを完全再利用する
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_discord_eights_join(p_discord_id text, p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := coalesce((current_setting('request.jwt.claims', true))::jsonb->>'role', '');
  v_user uuid;
  v_count int;
BEGIN
  -- Edge Function (service key) からのみ呼び出し可。一般ユーザーが他人として参加するのを防ぐ
  IF v_role <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_discord_id !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'code', 'bad_request'); END IF;

  SELECT user_id INTO v_user
  FROM auth.identities
  WHERE provider = 'discord' AND provider_id = p_discord_id
  LIMIT 1;
  IF v_user IS NULL THEN RETURN json_build_object('ok', false, 'code', 'not_registered'); END IF;

  -- 本人として既存RPCを実行 (トランザクション内のみ有効なクレーム差し替え)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM rpc_eights_join_lobby(p_lobby_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'code', 'join_error', 'message', SQLERRM);
  END;

  SELECT count(*) INTO v_count FROM eights_lobby_members WHERE lobby_id = p_lobby_id;
  RETURN json_build_object('ok', true, 'member_count', v_count);
END;
$$;

-- ------------------------------------------------------------
-- Discord ID からの参加キャンセル (service_role 専用)
-- ホストが抜けた場合は残メンバーへホストを引き継ぐ (eights_rematch.sql 参照)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_discord_eights_leave(p_discord_id text, p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := coalesce((current_setting('request.jwt.claims', true))::jsonb->>'role', '');
  v_user uuid;
  v_lobby record;
  v_count int;
  v_closed boolean;
BEGIN
  IF v_role <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_discord_id !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'code', 'bad_request'); END IF;

  SELECT user_id INTO v_user
  FROM auth.identities
  WHERE provider = 'discord' AND provider_id = p_discord_id
  LIMIT 1;
  IF v_user IS NULL THEN RETURN json_build_object('ok', false, 'code', 'not_registered'); END IF;

  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL OR v_lobby.status NOT IN ('open', 'drafting') THEN
    RETURN json_build_object('ok', false, 'code', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM eights_lobby_members WHERE lobby_id = p_lobby_id AND user_id = v_user) THEN
    RETURN json_build_object('ok', false, 'code', 'not_member');
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM rpc_eights_leave_lobby(p_lobby_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'code', 'leave_error', 'message', SQLERRM);
  END;

  SELECT count(*) INTO v_count FROM eights_lobby_members WHERE lobby_id = p_lobby_id;
  SELECT (status = 'closed') INTO v_closed FROM eights_lobbies WHERE id = p_lobby_id;
  RETURN json_build_object('ok', true, 'member_count', v_count, 'lobby_closed', coalesce(v_closed, false));
END;
$$;

-- ------------------------------------------------------------
-- Discord ID からの武器ロール設定 (service_role 専用)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_discord_eights_set_role(p_discord_id text, p_lobby_id uuid, p_role text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := coalesce((current_setting('request.jwt.claims', true))::jsonb->>'role', '');
  v_user uuid;
  v_lobby record;
BEGIN
  IF v_role <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_discord_id !~ '^\d+$' OR p_role NOT IN ('AR', 'SMG', 'FLEX') THEN
    RETURN json_build_object('ok', false, 'code', 'bad_request');
  END IF;

  SELECT user_id INTO v_user
  FROM auth.identities
  WHERE provider = 'discord' AND provider_id = p_discord_id
  LIMIT 1;
  IF v_user IS NULL THEN RETURN json_build_object('ok', false, 'code', 'not_registered'); END IF;

  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL OR v_lobby.status NOT IN ('open', 'drafting') THEN
    RETURN json_build_object('ok', false, 'code', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM eights_lobby_members WHERE lobby_id = p_lobby_id AND user_id = v_user) THEN
    RETURN json_build_object('ok', false, 'code', 'not_member');
  END IF;

  UPDATE eights_lobby_members SET weapon_role = p_role WHERE lobby_id = p_lobby_id AND user_id = v_user;
  RETURN json_build_object('ok', true, 'role', p_role);
END;
$$;

-- ------------------------------------------------------------
-- チーム編成の確定をDiscordへ送信 (ホストのみ)
-- 振り分け完了後に「この編成で行こう！」をメンバー全員へ告知する
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_announce_teams(p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lobby record;
  v_assigned int;
  v_alpha jsonb; v_bravo jsonb;
  v_alpha_avg int; v_bravo_avg int;
  v_member_ids uuid[];
  v_mention_ids text[];
  v_url text; v_secret text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL THEN RAISE EXCEPTION 'ロビーが見つかりません'; END IF;
  IF v_lobby.host_user_id <> v_uid AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN
    RAISE EXCEPTION 'ホストのみ実行できます';
  END IF;
  IF v_lobby.status <> 'drafting' THEN RAISE EXCEPTION 'チーム振り分けを実行してから送信してください'; END IF;

  SELECT count(*) INTO v_assigned FROM eights_lobby_members
  WHERE lobby_id = p_lobby_id AND team_side IN ('alpha', 'bravo');
  IF v_assigned < 8 THEN RAISE EXCEPTION '8人全員の振り分けが完了していません'; END IF;

  SELECT jsonb_agg(jsonb_build_object('name', coalesce(pr.display_name, '不明'), 'role', m.weapon_role) ORDER BY pr.display_name),
         round(avg(pr.peak_rating))::int
  INTO v_alpha, v_alpha_avg
  FROM eights_lobby_members m JOIN profiles pr ON pr.id = m.user_id
  WHERE m.lobby_id = p_lobby_id AND m.team_side = 'alpha';

  SELECT jsonb_agg(jsonb_build_object('name', coalesce(pr.display_name, '不明'), 'role', m.weapon_role) ORDER BY pr.display_name),
         round(avg(pr.peak_rating))::int
  INTO v_bravo, v_bravo_avg
  FROM eights_lobby_members m JOIN profiles pr ON pr.id = m.user_id
  WHERE m.lobby_id = p_lobby_id AND m.team_side = 'bravo';

  SELECT array_agg(user_id) INTO v_member_ids FROM eights_lobby_members WHERE lobby_id = p_lobby_id;

  -- サイト内通知 (8人全員)
  BEGIN
    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT u, 'eights_teams',
           '✅ 8s「' || v_lobby.title || '」のチーム編成が確定しました！VCで集合を確認して試合を開始してください',
           '/custom/eights/' || p_lobby_id, false
    FROM unnest(v_member_ids) AS u;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Discord (Bot送信が設定済みの場合のみ。非公開ロビーは公開チャンネルへ出さない)
  BEGIN
    SELECT value INTO v_url FROM app_settings WHERE key = 'discord_announce_url';
    SELECT value INTO v_secret FROM app_settings WHERE key = 'edge_internal_secret';
    IF v_url IS NOT NULL AND v_secret IS NOT NULL AND NOT v_lobby.is_private THEN
      SELECT array_agg(i.provider_id) INTO v_mention_ids
      FROM auth.identities i
      WHERE i.provider = 'discord' AND i.user_id = ANY(v_member_ids) AND i.provider_id ~ '^\d+$';

      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
        body := jsonb_build_object(
          'kind', 'teams',
          'lobby_id', p_lobby_id,
          'title', v_lobby.title,
          'alpha', coalesce(v_alpha, '[]'::jsonb),
          'bravo', coalesce(v_bravo, '[]'::jsonb),
          'alpha_avg', v_alpha_avg,
          'bravo_avg', v_bravo_avg,
          'mention_ids', coalesce(to_jsonb(v_mention_ids), '[]'::jsonb)
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN json_build_object('ok', true);
END;
$$;
