-- ============================================================
-- 8s の複数ロビー同時参加 (2026-10-24)
--
-- 従来は「アクティブなロビーは1人1つまで」だったが、
-- 並行して複数の募集に入っておき、先に成立した方で遊ぶ
-- 使い方ができるように制限を緩和する。
--   - 参加: 複数ロビーOK。同一ロビーへの二重参加のみエラー
--     (UNIQUE (lobby_id, user_id) でDBレベルでも保証)
--   - 開催: 他ロビーに参加中でも開催できる。ホストとしての多重開催も
--     可能 (例: 21時の予約開催 + 今すぐ開催)。乱立防止に同時3件まで
--     (rpc_eights_notify_prefs.sql)
--   - 募集通知: 「アクティブロビーに居る人は参加できないので除外」
--     の前提が崩れたため除外を撤廃 (eights_private_lobbies.sql の
--     _eights_announce と eights_rematch.sql の reopen)。
--     直近10分の連投ガードは維持
-- ============================================================

-- ------------------------------------------------------------
-- 参加 RPC (旧定義はDB直適用のみでリポジトリ未収載だったため、
-- 以後はこのファイルを最新定義とする)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_eights_join_lobby(p_lobby_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lobby record;
  v_cnt int;
  v_peak int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_lobby FROM eights_lobbies WHERE id = p_lobby_id;
  IF v_lobby IS NULL OR v_lobby.status <> 'open' THEN RAISE EXCEPTION 'ロビーが見つからないか、既に開始済みです'; END IF;
  SELECT count(*) INTO v_cnt FROM eights_lobby_members WHERE lobby_id = p_lobby_id;
  IF v_cnt >= 8 THEN RAISE EXCEPTION 'ロビーは満員です（8人）'; END IF;
  IF EXISTS (SELECT 1 FROM eights_lobby_members WHERE lobby_id = p_lobby_id AND user_id = v_uid) THEN
    RAISE EXCEPTION '既にこのロビーに参加しています';
  END IF;
  IF v_lobby.rate_cap IS NOT NULL THEN
    SELECT peak_rating INTO v_peak FROM profiles WHERE id = v_uid;
    IF coalesce(v_peak, 0) > v_lobby.rate_cap THEN RAISE EXCEPTION 'ピークレートが制限を超えています'; END IF;
  END IF;
  INSERT INTO eights_lobby_members (lobby_id, user_id, weapon_role) VALUES (p_lobby_id, v_uid, 'FLEX');
  RETURN json_build_object('ok', true);
END;
$$;
