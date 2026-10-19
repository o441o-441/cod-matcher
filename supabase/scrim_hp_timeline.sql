-- ============================================================
-- 交流戦 ハードポイント地点保持タイムライン (LK動画解析)
--
-- 試合の録画 (LK動画) をブラウザでフレーム抽出し、Edge Function
-- `hp-video-parse` がHUD (スコア・試合時間・ヒル残時間) を読み取る。
-- クライアントで「どのチームが地点に乗れていたか」の推移と
-- ポイント(ヒル)ごとの保持秒数を導出してここに保存する。
--
--   scrim_game_hp_timeline — 1ゲーム (scrim_match_games) = 1行
--     samples   jsonb [{t, h, g, ck, hl}]  動画秒ごとのHUD読み取り値
--                 (h/g=ホスト/ゲストの累計スコア, ck=試合時間秒, hl=ヒル残秒)
--     rotations jsonb [{no, start_t, end_t, host_sec, guest_sec, dead_sec}]
--                 何ポイント目に何秒乗れたか (dead=どちらも乗れていない時間)
--
-- 既存のスコアボード機能 (scrim_match_games / scoreboard-parse) には
-- 一切手を入れない追加テーブル。ゲーム削除時はFKカスケードで消える。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scrim_game_hp_timeline (
  game_id uuid PRIMARY KEY REFERENCES public.scrim_match_games(id) ON DELETE CASCADE,
  sample_interval numeric NOT NULL DEFAULT 2.5,
  rotation_method text NOT NULL DEFAULT 'assumed' CHECK (rotation_method IN ('hill', 'clock', 'assumed')),
  samples jsonb NOT NULL DEFAULT '[]',
  rotations jsonb NOT NULL DEFAULT '[]',
  submitted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scrim_game_hp_timeline ENABLE ROW LEVEL SECURITY;

-- 試合結果と同様に閲覧は公開。書き込みはRPCのみ
DROP POLICY IF EXISTS scrim_game_hp_timeline_select_all ON public.scrim_game_hp_timeline;
CREATE POLICY scrim_game_hp_timeline_select_all ON public.scrim_game_hp_timeline FOR SELECT USING (true);

-- ------------------------------------------------------------
-- 保存RPC (試合参加メンバーのみ。同じゲームは上書き)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_submit_hp_timeline(
  p_game_id uuid,
  p_sample_interval numeric,
  p_rotation_method text,
  p_samples jsonb,
  p_rotations jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_rotation_method NOT IN ('hill', 'clock', 'assumed') THEN RAISE EXCEPTION '解析方式が不正です'; END IF;
  IF jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) > 1200 THEN
    RAISE EXCEPTION 'サンプルデータが不正です';
  END IF;
  IF jsonb_typeof(p_rotations) <> 'array' OR jsonb_array_length(p_rotations) > 80 THEN
    RAISE EXCEPTION 'ポイントデータが不正です';
  END IF;
  IF p_sample_interval IS NULL OR p_sample_interval <= 0 OR p_sample_interval > 60 THEN
    RAISE EXCEPTION 'サンプル間隔が不正です';
  END IF;

  SELECT m.* INTO v_m
  FROM scrim_match_games g JOIN scrim_matches m ON m.id = g.match_id
  WHERE g.id = p_game_id;
  IF v_m IS NULL THEN RAISE EXCEPTION 'ゲームが見つかりません'; END IF;
  SELECT g.mode INTO v_mode FROM scrim_match_games g WHERE g.id = p_game_id;
  IF v_mode <> 'hp' THEN RAISE EXCEPTION 'ハードポイントのゲームのみ保存できます'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ保存できます';
  END IF;

  INSERT INTO scrim_game_hp_timeline (game_id, sample_interval, rotation_method, samples, rotations, submitted_by)
  VALUES (p_game_id, p_sample_interval, p_rotation_method, p_samples, p_rotations, v_uid)
  ON CONFLICT (game_id) DO UPDATE SET
    sample_interval = EXCLUDED.sample_interval,
    rotation_method = EXCLUDED.rotation_method,
    samples = EXCLUDED.samples,
    rotations = EXCLUDED.rotations,
    submitted_by = EXCLUDED.submitted_by,
    created_at = now();

  RETURN json_build_object('ok', true, 'game_id', p_game_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_scrim_submit_hp_timeline TO authenticated;

-- ------------------------------------------------------------
-- 削除RPC (ゲーム本体は残し、タイムラインだけ取り消す)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_delete_hp_timeline(p_game_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;

  SELECT m.* INTO v_m
  FROM scrim_match_games g JOIN scrim_matches m ON m.id = g.match_id
  WHERE g.id = p_game_id;
  IF v_m IS NULL THEN RAISE EXCEPTION 'ゲームが見つかりません'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = v_uid AND tm.team_id IN (v_m.host_team_id, v_m.guest_team_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM scrim_mixed_room_members rm
    WHERE rm.user_id = v_uid AND rm.room_id IN (v_m.host_room_id, v_m.guest_room_id)
  ) THEN
    RAISE EXCEPTION 'この試合の参加メンバーのみ取り消しできます';
  END IF;

  DELETE FROM scrim_game_hp_timeline WHERE game_id = p_game_id;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_scrim_delete_hp_timeline TO authenticated;
