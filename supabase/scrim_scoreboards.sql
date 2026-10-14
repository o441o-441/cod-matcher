-- ============================================================
-- 交流戦スコアボード提出 (フェーズ1)
--
-- 試合参加者が配信/録画のスコアボード画像を提出すると、
-- Edge Function `scoreboard-parse` がAIで構造化 (日英韓対応) し、
-- 確認画面を経てここに保存される。画像は証憑として常に併置。
--
--   scrim_match_games        — 1ゲーム (マップ) = 1行
--   scrim_game_player_stats  — プレイヤー8人分のスタッツ
--     user_id は名寄せ結果 (未登録/助っ人は null + raw_name のみ)
--     モード固有スタッツは stats jsonb (HP: 占拠時間系 など)
-- 画像: Storage バケット 'scoreboards' (公開読み取り・5MB制限)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scrim_match_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.scrim_matches(id) ON DELETE CASCADE,
  game_no integer NOT NULL CHECK (game_no BETWEEN 1 AND 12),
  mode text NOT NULL CHECK (mode IN ('hp', 'snd', 'ovl')),
  map text,
  host_score integer,
  guest_score integer,
  duration_seconds integer,
  host_slot text CHECK (host_slot IN ('team1', 'team2')), -- ホスト側のゲーム内陣営 (チーム1/チーム2)
  image_path text NOT NULL,
  submitted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, game_no)
);

CREATE TABLE IF NOT EXISTS public.scrim_game_player_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.scrim_match_games(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('host', 'guest')),
  raw_name text NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kills integer,
  deaths integer,
  assists integer,
  damage integer,
  stats jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_scrim_game_stats_user ON public.scrim_game_player_stats (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scrim_match_games_match ON public.scrim_match_games (match_id);

ALTER TABLE public.scrim_match_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrim_game_player_stats ENABLE ROW LEVEL SECURITY;

-- 結果は公開 (閲覧は誰でも)。書き込みはRPCのみ
DROP POLICY IF EXISTS scrim_match_games_select_all ON public.scrim_match_games;
CREATE POLICY scrim_match_games_select_all ON public.scrim_match_games FOR SELECT USING (true);
DROP POLICY IF EXISTS scrim_game_player_stats_select_all ON public.scrim_game_player_stats;
CREATE POLICY scrim_game_player_stats_select_all ON public.scrim_game_player_stats FOR SELECT USING (true);

-- ------------------------------------------------------------
-- 画像バケット (公開読み取り・ログインユーザーがアップロード可)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('scoreboards', 'scoreboards', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS scoreboards_upload ON storage.objects;
CREATE POLICY scoreboards_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'scoreboards');

-- ------------------------------------------------------------
-- 保存RPC (試合参加者のみ。同じゲーム番号は上書き)
-- p_players: [{side, raw_name, user_id?, kills, deaths, assists, damage, stats}]
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_submit_game(
  p_match_id uuid,
  p_game_no integer,
  p_mode text,
  p_map text,
  p_host_score integer,
  p_guest_score integer,
  p_duration_seconds integer,
  p_image_path text,
  p_players jsonb,
  p_host_slot text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
  v_gid uuid;
  v_p jsonb;
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_mode NOT IN ('hp', 'snd', 'ovl') THEN RAISE EXCEPTION 'モードが不正です'; END IF;
  IF p_game_no NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'ゲーム番号が不正です'; END IF;
  IF p_host_slot IS NOT NULL AND p_host_slot NOT IN ('team1', 'team2') THEN
    RAISE EXCEPTION '陣営が不正です';
  END IF;
  IF jsonb_typeof(p_players) <> 'array' OR jsonb_array_length(p_players) > 12 THEN
    RAISE EXCEPTION 'プレイヤーデータが不正です';
  END IF;

  SELECT * INTO v_m FROM scrim_matches WHERE id = p_match_id;
  IF v_m IS NULL THEN RAISE EXCEPTION '試合が見つかりません'; END IF;

  -- 参加メンバーのみ提出可 (チーム/混成ルーム両対応)
  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ提出できます';
  END IF;

  -- 同じゲーム番号は上書き (古いスタッツごと差し替え)
  DELETE FROM scrim_match_games WHERE match_id = p_match_id AND game_no = p_game_no;

  INSERT INTO scrim_match_games (match_id, game_no, mode, map, host_score, guest_score, duration_seconds, image_path, submitted_by, host_slot)
  VALUES (p_match_id, p_game_no, p_mode, nullif(trim(coalesce(p_map, '')), ''), p_host_score, p_guest_score, p_duration_seconds, p_image_path, v_uid, p_host_slot)
  RETURNING id INTO v_gid;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    IF coalesce(v_p->>'side', '') NOT IN ('host', 'guest') THEN CONTINUE; END IF;
    IF trim(coalesce(v_p->>'raw_name', '')) = '' THEN CONTINUE; END IF;
    INSERT INTO scrim_game_player_stats (game_id, side, raw_name, user_id, kills, deaths, assists, damage, stats)
    VALUES (
      v_gid,
      v_p->>'side',
      left(trim(v_p->>'raw_name'), 60),
      nullif(v_p->>'user_id', '')::uuid,
      nullif(v_p->>'kills', '')::int,
      nullif(v_p->>'deaths', '')::int,
      nullif(v_p->>'assists', '')::int,
      nullif(v_p->>'damage', '')::int,
      coalesce(v_p->'stats', '{}'::jsonb)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'game_id', v_gid, 'players', v_count);
END;
$$;
