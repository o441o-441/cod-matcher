-- ============================================================
-- 大会シード実行 v2: 個人エントリーの自動編成に武器ロールを考慮
--
-- 従来: 個人エントリーの編成はレートのみ (スネークドラフト)。
--       エントリー時に申告させた武器種 (AR/SMG/FLEX) は未使用だった。
-- 変更: 初期配置 (rating=スネーク / random=ラウンドロビン) を出発点に、
--       チーム間のランダム2人スワップを600回試行し、スコアが改善する
--       場合のみ採用する山登り法で編成を最適化する。
--       (8s の rpc_eights_auto_assign 'considered' と同じ思想の多チーム版)
--
--   スコア = レート項 + ロール項
--     レート項: チーム平均レートの最大-最小 (seeding_method='rating' のみ)
--     ロール項: 各チームの |AR-2|*50 + |SMG-2|*50 (FLEXは中立)
--   random 編成でもロール項のみで最適化する (レートはランダムのまま)。
--
-- チームエントリーのシード処理・ブロック振り分け・代表エントリーへの
-- シード付与は従来のまま変更なし。
-- ============================================================

-- ------------------------------------------------------------
-- 編成スコア (小さいほど良い)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_solo_formation_score(
  p_team integer[],      -- 各プレイヤーのチーム番号 (1..p_team_count)
  p_ratings integer[],
  p_roles text[],
  p_team_count integer,
  p_use_rating boolean
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sums numeric[];
  v_counts integer[];
  v_ar integer[];
  v_smg integer[];
  v_i integer;
  v_n integer;
  v_avg numeric;
  v_avg_max numeric;
  v_avg_min numeric;
  v_score numeric := 0;
BEGIN
  v_sums := array_fill(0::numeric, ARRAY[p_team_count]);
  v_counts := array_fill(0, ARRAY[p_team_count]);
  v_ar := array_fill(0, ARRAY[p_team_count]);
  v_smg := array_fill(0, ARRAY[p_team_count]);

  v_n := coalesce(array_length(p_team, 1), 0);
  FOR v_i IN 1..v_n LOOP
    v_sums[p_team[v_i]] := v_sums[p_team[v_i]] + coalesce(p_ratings[v_i], 1500);
    v_counts[p_team[v_i]] := v_counts[p_team[v_i]] + 1;
    IF p_roles[v_i] = 'AR' THEN v_ar[p_team[v_i]] := v_ar[p_team[v_i]] + 1;
    ELSIF p_roles[v_i] = 'SMG' THEN v_smg[p_team[v_i]] := v_smg[p_team[v_i]] + 1;
    END IF;
  END LOOP;

  IF p_use_rating THEN
    FOR v_i IN 1..p_team_count LOOP
      v_avg := v_sums[v_i] / greatest(v_counts[v_i], 1);
      v_avg_max := greatest(coalesce(v_avg_max, v_avg), v_avg);
      v_avg_min := least(coalesce(v_avg_min, v_avg), v_avg);
    END LOOP;
    v_score := v_score + (v_avg_max - v_avg_min);
  END IF;

  FOR v_i IN 1..p_team_count LOOP
    v_score := v_score + (abs(v_ar[v_i] - 2) + abs(v_smg[v_i] - 2)) * 50;
  END LOOP;

  RETURN v_score;
END;
$$;

-- ------------------------------------------------------------
-- シード実行本体
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
    END IF;

    IF v_block_count >= 2 THEN
      IF v_tournament.seeding_method = 'random' THEN
        SELECT array_agg(id ORDER BY seed_number) INTO v_entries FROM tournament_entries WHERE tournament_id = p_tournament_id;
        v_entry_count := coalesce(array_length(v_entries, 1), 0);
        FOR v_i IN 1..v_entry_count LOOP
          v_group_index := ((v_i - 1) % v_block_count);
          v_group_label := chr(65 + v_group_index);
          UPDATE tournament_entries SET assigned_group = v_group_label WHERE id = v_entries[v_i];
        END LOOP;
      ELSIF v_tournament.seeding_method = 'rating' THEN
        SELECT array_agg(id ORDER BY seed_number) INTO v_entries FROM tournament_entries WHERE tournament_id = p_tournament_id;
        v_entry_count := coalesce(array_length(v_entries, 1), 0);
        v_group_index := 0; v_snake_dir := 1;
        FOR v_i IN 1..v_entry_count LOOP
          v_group_label := chr(65 + v_group_index);
          UPDATE tournament_entries SET assigned_group = v_group_label WHERE id = v_entries[v_i];
          IF v_snake_dir = 1 AND v_group_index = v_block_count - 1 THEN v_snake_dir := -1;
          ELSIF v_snake_dir = -1 AND v_group_index = 0 THEN v_snake_dir := 1;
          ELSE v_group_index := v_group_index + v_snake_dir; END IF;
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

    IF v_tournament.seeding_method = 'random' THEN
      v_snake_pos := 0;
      FOR v_entry IN SELECT * FROM tournament_entries WHERE tournament_id = p_tournament_id AND status = 'registered' ORDER BY random() LOOP
        v_team_index := (v_snake_pos % v_team_count) + 1;
        UPDATE tournament_entries
        SET assigned_team_index = v_team_index, assigned_team_name = 'Team ' || v_team_index::text, seed_number = v_snake_pos + 1
        WHERE id = v_entry.id;
        v_snake_pos := v_snake_pos + 1;
      END LOOP;
    ELSIF v_tournament.seeding_method = 'rating' THEN
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
    END IF;

    -- ================================================================
    -- 武器ロール (+レート) を考慮したスワップ最適化
    -- 初期配置を出発点に、異なるチームの2人のスワップを600回試行し、
    -- スコアが改善する場合のみ採用 (チーム人数は常に4で不変)。
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
