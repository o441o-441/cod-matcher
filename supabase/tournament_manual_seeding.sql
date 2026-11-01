-- ============================================================
-- 大会: 手動シード対応 + エントリー締切のサーバー側強制 (2026-11-01)
--
-- (1) エントリー締切の強制 (trg_tournament_entry_deadline)
--     entry_deadline 超過後の INSERT をトリガーで拒否。
--     従来はクライアント側のみの判定で、API直叩きなら通ってしまった。
--     主催者/管理者/内部処理 (auth.uid() なし) はバイパス (代行エントリー用)。
--
-- (2) 手動シード (seeding_method='manual') の実装
--     - rpc_tournament_execute_seeding に manual 分岐を追加
--       (チーム戦: エントリー順を初期シードに。ソロ/ブロック割当は
--        random と同じ扱いにフォールバック)
--     - 新RPC rpc_tournament_set_seeds: 主催者が status='seeding' 中に
--       シード順 (= 組み合わせ) を並べ替えて保存できる
--     - フロー変更 (フロント): トーナメント形式は
--       「締切→シード実行」→ 組み合わせ確認/編集画面 → 「大会開始」
--       の2段階に分離 (リーグは従来どおり1段階)
--
-- 旧定義: rpc_tournament_execute_seeding は rpc_tournament_seeding_v2.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1) エントリー締切の強制
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_tournament_entry_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t record;
BEGIN
  SELECT entry_deadline, host_user_id INTO v_t FROM tournaments WHERE id = NEW.tournament_id;
  IF v_t IS NULL OR v_t.entry_deadline IS NULL OR now() <= v_t.entry_deadline THEN
    RETURN NEW;
  END IF;
  -- 内部処理/主催者/管理者はバイパス (代行エントリー・テスト投入用)
  IF v_uid IS NULL OR v_uid = v_t.host_user_id
     OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'エントリー締切 (%) を過ぎています',
    to_char(v_t.entry_deadline AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI');
END;
$$;

DROP TRIGGER IF EXISTS tournament_entry_deadline ON public.tournament_entries;
CREATE TRIGGER tournament_entry_deadline
  BEFORE INSERT ON public.tournament_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_tournament_entry_deadline();

-- ------------------------------------------------------------
-- 2) シード順の手動更新 (status='seeding' 中のみ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_tournament_set_seeds(p_tournament_id uuid, p_entry_ids uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tournament record;
  v_count int;
  v_i int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
  IF v_tournament IS NULL THEN RAISE EXCEPTION '大会が見つかりません'; END IF;
  IF v_tournament.host_user_id <> v_uid
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION '主催者のみ実行可能です';
  END IF;
  IF v_tournament.status <> 'seeding' THEN
    RAISE EXCEPTION 'シード調整中の大会のみ変更できます (大会開始後は変更不可)';
  END IF;

  -- 全エントリーを過不足なく含むか検証
  SELECT count(*) INTO v_count FROM tournament_entries
  WHERE tournament_id = p_tournament_id AND coalesce(status, '') <> 'excluded';
  IF v_count <> coalesce(array_length(p_entry_ids, 1), 0) THEN
    RAISE EXCEPTION 'エントリー数が一致しません (ページを再読み込みしてください)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_entry_ids) AS eid
    WHERE NOT EXISTS (
      SELECT 1 FROM tournament_entries e
      WHERE e.id = eid AND e.tournament_id = p_tournament_id AND coalesce(e.status, '') <> 'excluded'
    )
  ) THEN
    RAISE EXCEPTION '不正なエントリーが含まれています';
  END IF;

  FOR v_i IN 1..array_length(p_entry_ids, 1) LOOP
    UPDATE tournament_entries SET seed_number = v_i WHERE id = p_entry_ids[v_i];
  END LOOP;

  RETURN json_build_object('ok', true, 'count', array_length(p_entry_ids, 1));
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_tournament_set_seeds(uuid, uuid[]) TO authenticated;

-- ------------------------------------------------------------
-- 3) rpc_tournament_execute_seeding (manual 対応)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_tournament_execute_seeding(p_tournament_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tournament record;
  v_entry record;
  v_seed int := 1;
  v_team_index int;
  v_team_count int;
  v_players_per_team int := 4;
  v_total_players int;
  v_excluded_count int := 0;
  v_snake_pos int;
  v_snake_dir int;
  v_block_count int;
  v_entries uuid[];
  v_entry_count int;
  v_group_index int;
  v_group_label text;
  v_i int;
  -- スワップ最適化用
  v_opt_ids uuid[];
  v_opt_ratings int[];
  v_opt_roles text[];
  v_opt_team int[];
  v_player_count int;
  v_use_rating boolean;
  v_best numeric;
  v_trial numeric;
  v_a int;
  v_b int;
  v_tmp int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
  IF v_tournament IS NULL THEN RAISE EXCEPTION '大会が見つかりません'; END IF;
  IF v_tournament.host_user_id <> v_uid AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION '主催者のみ実行可能です';
  END IF;
  IF v_tournament.status <> 'recruit' THEN RAISE EXCEPTION '募集中の大会のみシード可能です'; END IF;

  v_block_count := coalesce(v_tournament.block_count, 1);

  IF v_tournament.entry_mode = 'team' THEN
    IF v_tournament.seeding_method = 'random' THEN
      FOR v_entry IN SELECT * FROM tournament_entries WHERE tournament_id = p_tournament_id ORDER BY random() LOOP
        UPDATE tournament_entries SET seed_number = v_seed WHERE id = v_entry.id;
        v_seed := v_seed + 1;
      END LOOP;
    ELSIF v_tournament.seeding_method = 'rating' THEN
      FOR v_entry IN SELECT * FROM tournament_entries WHERE tournament_id = p_tournament_id ORDER BY rating_at_entry DESC LOOP
        UPDATE tournament_entries SET seed_number = v_seed WHERE id = v_entry.id;
        v_seed := v_seed + 1;
      END LOOP;
    ELSE
      -- manual: エントリー順を初期シードに (この後 rpc_tournament_set_seeds で並べ替え)
      FOR v_entry IN SELECT * FROM tournament_entries WHERE tournament_id = p_tournament_id ORDER BY created_at LOOP
        UPDATE tournament_entries SET seed_number = v_seed WHERE id = v_entry.id;
        v_seed := v_seed + 1;
      END LOOP;
    END IF;

    IF v_block_count >= 2 THEN
      SELECT array_agg(id ORDER BY seed_number) INTO v_entries FROM tournament_entries WHERE tournament_id = p_tournament_id;
      v_entry_count := coalesce(array_length(v_entries, 1), 0);
      IF v_tournament.seeding_method = 'rating' THEN
        v_group_index := 0; v_snake_dir := 1;
        FOR v_i IN 1..v_entry_count LOOP
          v_group_label := chr(65 + v_group_index);
          UPDATE tournament_entries SET assigned_group = v_group_label WHERE id = v_entries[v_i];
          IF v_snake_dir = 1 AND v_group_index = v_block_count - 1 THEN v_snake_dir := -1;
          ELSIF v_snake_dir = -1 AND v_group_index = 0 THEN v_snake_dir := 1;
          ELSE v_group_index := v_group_index + v_snake_dir; END IF;
        END LOOP;
      ELSE
        -- random / manual: 単純な振り分け
        FOR v_i IN 1..v_entry_count LOOP
          v_group_index := ((v_i - 1) % v_block_count);
          v_group_label := chr(65 + v_group_index);
          UPDATE tournament_entries SET assigned_group = v_group_label WHERE id = v_entries[v_i];
        END LOOP;
      END IF;
    END IF;

  ELSIF v_tournament.entry_mode = 'solo' THEN
    SELECT count(*) INTO v_total_players FROM tournament_entries WHERE tournament_id = p_tournament_id;
    v_team_count := v_total_players / v_players_per_team;
    IF v_team_count < 2 THEN RAISE EXCEPTION '最低8人のエントリーが必要です'; END IF;

    -- Exclude late entries that don't fit (remainder of total / 4)
    v_excluded_count := v_total_players - (v_team_count * v_players_per_team);
    IF v_excluded_count > 0 THEN
      UPDATE tournament_entries SET status = 'excluded'
      WHERE id IN (
        SELECT id FROM tournament_entries
        WHERE tournament_id = p_tournament_id AND status = 'registered'
        ORDER BY created_at DESC
        LIMIT v_excluded_count
      );
    END IF;

    IF v_tournament.seeding_method = 'rating' THEN
      v_snake_pos := 0; v_snake_dir := 1; v_team_index := 1; v_seed := 1;
      FOR v_entry IN SELECT * FROM tournament_entries WHERE tournament_id = p_tournament_id AND status = 'registered' ORDER BY rating_at_entry DESC LOOP
        UPDATE tournament_entries
        SET assigned_team_index = v_team_index, assigned_team_name = 'Team ' || v_team_index::text, seed_number = v_seed
        WHERE id = v_entry.id;
        IF v_snake_dir = 1 AND v_team_index = v_team_count THEN v_snake_dir := -1;
        ELSIF v_snake_dir = -1 AND v_team_index = 1 THEN v_snake_dir := 1;
        ELSE v_team_index := v_team_index + v_snake_dir; END IF;
        v_seed := v_seed + 1;
      END LOOP;
    ELSE
      -- random / manual (ソロは手動シード非対応のため random と同じ扱い)
      v_snake_pos := 0;
      FOR v_entry IN SELECT * FROM tournament_entries WHERE tournament_id = p_tournament_id AND status = 'registered' ORDER BY random() LOOP
        v_team_index := (v_snake_pos % v_team_count) + 1;
        UPDATE tournament_entries
        SET assigned_team_index = v_team_index, assigned_team_name = 'Team ' || v_team_index::text, seed_number = v_snake_pos + 1
        WHERE id = v_entry.id;
        v_snake_pos := v_snake_pos + 1;
      END LOOP;
    END IF;

    -- ================================================================
    -- 武器ロール (+レート) を考慮したスワップ最適化
    -- ================================================================
    SELECT array_agg(id ORDER BY id),
           array_agg(coalesce(rating_at_entry, 1500) ORDER BY id),
           array_agg(coalesce(weapon_class, 'FLEX') ORDER BY id),
           array_agg(assigned_team_index ORDER BY id)
    INTO v_opt_ids, v_opt_ratings, v_opt_roles, v_opt_team
    FROM tournament_entries
    WHERE tournament_id = p_tournament_id AND status = 'registered';

    v_player_count := coalesce(array_length(v_opt_ids, 1), 0);
    IF v_player_count = v_team_count * v_players_per_team THEN
      v_use_rating := (v_tournament.seeding_method = 'rating');
      v_best := _tournament_solo_formation_score(v_opt_team, v_opt_ratings, v_opt_roles, v_team_count, v_use_rating);

      FOR v_i IN 1..600 LOOP
        v_a := 1 + floor(random() * v_player_count)::int;
        v_b := 1 + floor(random() * v_player_count)::int;
        CONTINUE WHEN v_a = v_b OR v_opt_team[v_a] = v_opt_team[v_b];
        v_tmp := v_opt_team[v_a]; v_opt_team[v_a] := v_opt_team[v_b]; v_opt_team[v_b] := v_tmp;
        v_trial := _tournament_solo_formation_score(v_opt_team, v_opt_ratings, v_opt_roles, v_team_count, v_use_rating);
        IF v_trial < v_best THEN
          v_best := v_trial;
        ELSE
          v_tmp := v_opt_team[v_a]; v_opt_team[v_a] := v_opt_team[v_b]; v_opt_team[v_b] := v_tmp;
        END IF;
      END LOOP;

      FOR v_i IN 1..v_player_count LOOP
        UPDATE tournament_entries
        SET assigned_team_index = v_opt_team[v_i], assigned_team_name = 'Team ' || v_opt_team[v_i]::text
        WHERE id = v_opt_ids[v_i] AND assigned_team_index <> v_opt_team[v_i];
      END LOOP;
    END IF;

    v_seed := 1;
    FOR v_team_index IN 1..v_team_count LOOP
      UPDATE tournament_entries SET seed_number = v_seed
      WHERE tournament_id = p_tournament_id AND assigned_team_index = v_team_index
        AND id = (SELECT (min(id::text))::uuid FROM tournament_entries WHERE tournament_id = p_tournament_id AND assigned_team_index = v_team_index);
      v_seed := v_seed + 1;
    END LOOP;

    IF v_block_count >= 2 THEN
      SELECT array_agg(sub.entry_id ORDER BY sub.sn) INTO v_entries
      FROM (
        SELECT (min(id::text))::uuid as entry_id, assigned_team_index, min(seed_number) as sn
        FROM tournament_entries WHERE tournament_id = p_tournament_id AND assigned_team_index IS NOT NULL
        GROUP BY assigned_team_index
      ) sub;
      v_entry_count := coalesce(array_length(v_entries, 1), 0);
      v_group_index := 0; v_snake_dir := 1;
      FOR v_i IN 1..v_entry_count LOOP
        v_group_label := chr(65 + v_group_index);
        UPDATE tournament_entries SET assigned_group = v_group_label
        WHERE tournament_id = p_tournament_id AND assigned_team_index = (
          SELECT assigned_team_index FROM tournament_entries WHERE id = v_entries[v_i]
        );
        IF v_tournament.seeding_method = 'rating' THEN
          IF v_snake_dir = 1 AND v_group_index = v_block_count - 1 THEN v_snake_dir := -1;
          ELSIF v_snake_dir = -1 AND v_group_index = 0 THEN v_snake_dir := 1;
          ELSE v_group_index := v_group_index + v_snake_dir; END IF;
        ELSE
          v_group_index := (v_group_index + 1) % v_block_count;
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE tournaments SET status = 'seeding', updated_at = now() WHERE id = p_tournament_id;
  RETURN json_build_object('ok', true, 'method', v_tournament.seeding_method, 'excluded', v_excluded_count);
END;
$$;
