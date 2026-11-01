-- ============================================================
-- 大会: ラウンド別BO上書き + スケジュール管理 (2026-11-01)
--
-- 「基本BO3だが勝者側決勝・敗者側決勝・グランドファイナルだけBO5」の
-- ような終盤ラウンドのBO上書きに対応する。
--
-- 保存先: tournaments.metadata (jsonb, 既存・未使用だった列)
--   metadata.round_formats = { "wf": "bo5", "lf": "bo5", "gf": "bo5" }
--     wf = 勝者側決勝 (winners round = 最終round。単一エリミの決勝も同じ)
--     lf = 敗者側決勝 (losers round = (WB rounds - 1) * 2)
--     gf = グランドファイナル (grand_final round 1 と reset round 2 の両方)
--     キーなし/不正値 = tournaments.match_format (基本BO) を使用
--   metadata.schedule = [ { "start": ISO8601, "wb_until": n, "lb_until": n, "gf": bool } ... ]
--     → スケジュールはフロント表示専用 (lib/tournamentSchedule.ts で目安時間を計算)
--
-- 仕組み: tournament_matches.match_format (既存のper-match列) を
-- ブラケット生成時にラウンドに応じて埋める。バンピックの試合数判定
-- (rpc_tournament_banpick_action) は元々per-match列を見るので無変更。
--
-- 本ファイルは以下を上書きする:
--   - rpc_tournament_generate_bracket (旧: rpc_tournament_double_elim_v2.sql)
--   - rpc_tournament_start_playoff   (旧: 本番DBのみ)
--   - rpc_tournament_start_banpick   (旧: 本番DBのみ。tournaments.match_format で
--     per-match値を上書きしていたクロバーを除去し、試合側の値を使う)
-- ============================================================

-- ------------------------------------------------------------
-- 1) ラウンド別フォーマット解決ヘルパー
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_round_format(p_metadata jsonb, p_base text, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_metadata->'round_formats'->>p_key, '') IN ('bo1', 'bo3', 'bo5')
    THEN p_metadata->'round_formats'->>p_key
    ELSE p_base
  END;
$$;

-- ------------------------------------------------------------
-- 2) rpc_tournament_generate_bracket (ラウンド別BO対応)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_tournament_generate_bracket(p_tournament_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tournament record;
  v_entry_count int;
  v_bracket_size int;
  v_rounds int;
  v_losers_rounds int;
  v_w_r1_count int;
  v_entries uuid[];
  v_positions int[];
  v_new_positions int[];
  v_seeded uuid[];
  v_i int;
  v_j int;
  v_size int;
  v_winner_id uuid;
  v_match_count int;
  v_feeder_a_status text;
  v_feeder_b_status text;
  v_fmt text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
  IF v_tournament IS NULL THEN RAISE EXCEPTION '大会が見つかりません'; END IF;
  IF v_tournament.host_user_id <> v_uid
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION '主催者のみ実行可能です';
  END IF;
  IF v_tournament.status NOT IN ('seeding', 'recruit') THEN
    RAISE EXCEPTION 'シード完了後の大会のみブラケット生成可能です';
  END IF;

  -- Safety: don't overwrite played matches
  IF EXISTS (SELECT 1 FROM tournament_matches
             WHERE tournament_id = p_tournament_id AND status = 'completed') THEN
    RAISE EXCEPTION '完了済みの試合があるためブラケットを再生成できません';
  END IF;
  DELETE FROM tournament_matches WHERE tournament_id = p_tournament_id;

  -- ── Get seeded entries ──────────────────────────────────
  IF v_tournament.entry_mode = 'solo' THEN
    SELECT array_agg(sub.entry_id ORDER BY sub.seed_number)
    INTO v_entries
    FROM (
      SELECT (min(id::text))::uuid AS entry_id,
             assigned_team_index,
             min(seed_number) AS seed_number
      FROM tournament_entries
      WHERE tournament_id = p_tournament_id AND assigned_team_index IS NOT NULL
      GROUP BY assigned_team_index
    ) sub;
  ELSE
    SELECT array_agg(id ORDER BY seed_number)
    INTO v_entries
    FROM tournament_entries
    WHERE tournament_id = p_tournament_id;
  END IF;

  v_entry_count := coalesce(array_length(v_entries, 1), 0);
  IF v_entry_count < 2 THEN RAISE EXCEPTION 'エントリーが2チーム未満です'; END IF;

  -- ── Bracket size (next power of 2) ─────────────────────
  v_bracket_size := 1;
  WHILE v_bracket_size < v_entry_count LOOP
    v_bracket_size := v_bracket_size * 2;
  END LOOP;

  v_rounds := (log(2, v_bracket_size))::int;
  v_w_r1_count := v_bracket_size / 2;

  -- ── Standard bracket seeding order ─────────────────────
  v_positions := ARRAY[1];
  v_size := 1;
  WHILE v_size < v_bracket_size LOOP
    v_size := v_size * 2;
    v_new_positions := ARRAY[]::int[];
    FOR v_i IN 1..array_length(v_positions, 1) LOOP
      v_new_positions := array_append(v_new_positions, v_positions[v_i]);
      v_new_positions := array_append(v_new_positions, v_size + 1 - v_positions[v_i]);
    END LOOP;
    v_positions := v_new_positions;
  END LOOP;

  -- Map positions → entries (NULL = bye)
  v_seeded := array_fill(NULL::uuid, ARRAY[v_bracket_size]);
  FOR v_i IN 1..v_bracket_size LOOP
    IF v_positions[v_i] <= v_entry_count THEN
      v_seeded[v_i] := v_entries[v_positions[v_i]];
    END IF;
  END LOOP;

  -- ══════════════════ Winners Bracket ══════════════════

  -- W R1 matches (2チームなら R1 = 決勝なので wf 上書きを適用)
  v_fmt := CASE WHEN v_rounds = 1
                THEN _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'wf')
                ELSE v_tournament.match_format END;
  FOR v_i IN 1..v_w_r1_count LOOP
    INSERT INTO tournament_matches (
      tournament_id, round, match_number, entry_a_id, entry_b_id,
      status, bracket_side, match_format
    ) VALUES (
      p_tournament_id, 1, v_i,
      v_seeded[v_i * 2 - 1], v_seeded[v_i * 2],
      CASE WHEN v_seeded[v_i*2-1] IS NULL OR v_seeded[v_i*2] IS NULL
           THEN 'bye' ELSE 'pending' END,
      'winners', v_fmt
    );
  END LOOP;

  -- W R2..Rfinal empty matches (最終ラウンド = 勝者側決勝は wf 上書き)
  FOR v_j IN 2..v_rounds LOOP
    v_match_count := (v_bracket_size / power(2, v_j))::int;
    v_fmt := CASE WHEN v_j = v_rounds
                  THEN _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'wf')
                  ELSE v_tournament.match_format END;
    FOR v_i IN 1..v_match_count LOOP
      INSERT INTO tournament_matches (
        tournament_id, round, match_number, status, bracket_side, match_format
      ) VALUES (p_tournament_id, v_j, v_i, 'pending', 'winners', v_fmt);
    END LOOP;
  END LOOP;

  -- Auto-advance W R1 byes
  FOR v_i IN 1..v_w_r1_count LOOP
    IF v_seeded[v_i*2-1] IS NOT NULL AND v_seeded[v_i*2] IS NULL THEN
      v_winner_id := v_seeded[v_i*2-1];
    ELSIF v_seeded[v_i*2-1] IS NULL AND v_seeded[v_i*2] IS NOT NULL THEN
      v_winner_id := v_seeded[v_i*2];
    ELSE
      CONTINUE;
    END IF;

    UPDATE tournament_matches
    SET winner_entry_id = v_winner_id, completed_at = now()
    WHERE tournament_id = p_tournament_id AND round = 1
      AND match_number = v_i AND bracket_side = 'winners';

    IF v_rounds >= 2 THEN
      IF v_i % 2 = 1 THEN
        UPDATE tournament_matches SET entry_a_id = v_winner_id
        WHERE tournament_id = p_tournament_id AND round = 2
          AND match_number = ceil(v_i::numeric/2)::int AND bracket_side = 'winners';
      ELSE
        UPDATE tournament_matches SET entry_b_id = v_winner_id
        WHERE tournament_id = p_tournament_id AND round = 2
          AND match_number = ceil(v_i::numeric/2)::int AND bracket_side = 'winners';
      END IF;
    END IF;
  END LOOP;

  -- ══════════════════ Losers Bracket ══════════════════
  IF v_tournament.elimination_type = 'double' THEN
    v_losers_rounds := (v_rounds - 1) * 2;

    IF v_losers_rounds > 0 THEN
      -- Create L bracket match slots (最終ラウンド = 敗者側決勝は lf 上書き)
      FOR v_j IN 1..v_losers_rounds LOOP
        v_match_count := greatest(1,
          (v_bracket_size / power(2, ceil(v_j::numeric/2) + 1))::int);
        v_fmt := CASE WHEN v_j = v_losers_rounds
                      THEN _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'lf')
                      ELSE v_tournament.match_format END;
        FOR v_i IN 1..v_match_count LOOP
          INSERT INTO tournament_matches (
            tournament_id, round, match_number, status, bracket_side, match_format
          ) VALUES (p_tournament_id, v_j, v_i, 'pending', 'losers', v_fmt);
        END LOOP;
      END LOOP;

      -- Mark double-bye L R1 matches
      FOR v_j IN 1..(v_w_r1_count / 2) LOOP
        SELECT status INTO v_feeder_a_status FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'winners'
          AND round = 1 AND match_number = v_j;
        SELECT status INTO v_feeder_b_status FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'winners'
          AND round = 1 AND match_number = v_w_r1_count + 1 - v_j;

        IF v_feeder_a_status = 'bye' AND v_feeder_b_status = 'bye' THEN
          UPDATE tournament_matches
          SET status = 'bye', completed_at = now()
          WHERE tournament_id = p_tournament_id AND bracket_side = 'losers'
            AND round = 1 AND match_number = v_j;
        END IF;
      END LOOP;
    END IF;

    -- Grand Final (round 1) / Reset (round 2) は gf 上書き
    v_fmt := _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'gf');
    INSERT INTO tournament_matches (
      tournament_id, round, match_number, status, bracket_side, match_format
    ) VALUES (p_tournament_id, 1, 1, 'pending', 'grand_final', v_fmt);

    IF v_tournament.gf_reset THEN
      INSERT INTO tournament_matches (
        tournament_id, round, match_number, status, bracket_side, match_format
      ) VALUES (p_tournament_id, 2, 1, 'pending', 'grand_final', v_fmt);
    END IF;
  END IF;

  UPDATE tournaments SET status = 'live', updated_at = now() WHERE id = p_tournament_id;

  RETURN json_build_object(
    'ok', true, 'rounds', v_rounds, 'bracket_size', v_bracket_size,
    'entries', v_entry_count, 'elimination', v_tournament.elimination_type,
    'gf_reset', v_tournament.gf_reset
  );
END;
$$;

-- ------------------------------------------------------------
-- 3) rpc_tournament_start_playoff (リーグ→決勝トナメ。ラウンド別BO対応)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_tournament_start_playoff(p_tournament_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tournament record;
  v_advance_count int;
  v_groups text[];
  v_group_label text;
  v_group_size int;
  v_playoff_entries uuid[];
  v_standing record;
  v_rank int;
  v_seed int;
  v_playoff_count int;
  -- bracket generation vars
  v_bracket_size int;
  v_rounds int;
  v_losers_rounds int;
  v_w_r1_count int;
  v_positions int[];
  v_new_positions int[];
  v_seeded uuid[];
  v_size int;
  v_i int;
  v_j int;
  v_match_count int;
  v_winner_id uuid;
  v_feeder_a_status text;
  v_feeder_b_status text;
  v_elim_type text;
  v_fmt text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
  IF v_tournament IS NULL THEN RAISE EXCEPTION '大会が見つかりません'; END IF;
  IF v_tournament.host_user_id <> v_uid
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION '主催者のみ実行可能です';
  END IF;
  IF v_tournament.format <> 'league' THEN RAISE EXCEPTION 'リーグ形式の大会のみ'; END IF;
  IF coalesce(v_tournament.block_count, 1) < 2 THEN RAISE EXCEPTION 'ブロック数が2以上の大会のみ'; END IF;
  IF v_tournament.group_phase_status <> 'completed' THEN RAISE EXCEPTION 'グループステージが完了していません'; END IF;

  -- Get groups
  SELECT array_agg(DISTINCT assigned_group ORDER BY assigned_group) INTO v_groups
  FROM league_standings WHERE tournament_id = p_tournament_id AND assigned_group IS NOT NULL;

  -- Determine advance count
  SELECT count(*)::int INTO v_group_size FROM league_standings
  WHERE tournament_id = p_tournament_id AND assigned_group = v_groups[1];
  v_advance_count := coalesce(v_tournament.playoff_advance_count, greatest(1, v_group_size / 2));

  -- Select top N from each group with cross-group seeding
  v_playoff_entries := ARRAY[]::uuid[];
  FOR v_rank IN 1..v_advance_count LOOP
    FOREACH v_group_label IN ARRAY v_groups LOOP
      SELECT ls.entry_id INTO v_standing
      FROM league_standings ls
      WHERE ls.tournament_id = p_tournament_id AND ls.assigned_group = v_group_label
      ORDER BY ls.points DESC, (ls.rounds_won - ls.rounds_lost) DESC, ls.wins DESC
      OFFSET v_rank - 1 LIMIT 1;

      IF v_standing IS NOT NULL THEN
        v_playoff_entries := array_append(v_playoff_entries, v_standing.entry_id);
      END IF;
    END LOOP;
  END LOOP;

  v_playoff_count := coalesce(array_length(v_playoff_entries, 1), 0);
  IF v_playoff_count < 2 THEN RAISE EXCEPTION '決勝トーナメント進出チームが2未満です'; END IF;

  -- Update seed_number for playoff entries
  FOR v_i IN 1..v_playoff_count LOOP
    UPDATE tournament_entries SET seed_number = v_i, playoff_seed = v_i
    WHERE id = v_playoff_entries[v_i];
  END LOOP;

  -- Mark non-advancing entries as eliminated
  UPDATE tournament_entries SET status = 'eliminated'
  WHERE tournament_id = p_tournament_id AND id != ALL(v_playoff_entries) AND status <> 'eliminated';

  -- Delete any existing bracket matches (safety)
  DELETE FROM tournament_matches WHERE tournament_id = p_tournament_id AND bracket_side IN ('winners', 'losers', 'grand_final');

  -- ══ Generate bracket (inline from rpc_tournament_generate_bracket logic) ══
  v_elim_type := v_tournament.playoff_elimination_type;

  v_bracket_size := 1;
  WHILE v_bracket_size < v_playoff_count LOOP v_bracket_size := v_bracket_size * 2; END LOOP;
  v_rounds := (log(2, v_bracket_size))::int;
  v_w_r1_count := v_bracket_size / 2;

  -- Standard seeding order
  v_positions := ARRAY[1]; v_size := 1;
  WHILE v_size < v_bracket_size LOOP
    v_size := v_size * 2;
    v_new_positions := ARRAY[]::int[];
    FOR v_i IN 1..array_length(v_positions, 1) LOOP
      v_new_positions := array_append(v_new_positions, v_positions[v_i]);
      v_new_positions := array_append(v_new_positions, v_size + 1 - v_positions[v_i]);
    END LOOP;
    v_positions := v_new_positions;
  END LOOP;

  v_seeded := array_fill(NULL::uuid, ARRAY[v_bracket_size]);
  FOR v_i IN 1..v_bracket_size LOOP
    IF v_positions[v_i] <= v_playoff_count THEN v_seeded[v_i] := v_playoff_entries[v_positions[v_i]]; END IF;
  END LOOP;

  -- W R1 (2チームなら R1 = 決勝なので wf 上書きを適用)
  v_fmt := CASE WHEN v_rounds = 1
                THEN _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'wf')
                ELSE v_tournament.match_format END;
  FOR v_i IN 1..v_w_r1_count LOOP
    INSERT INTO tournament_matches (tournament_id, round, match_number, entry_a_id, entry_b_id, status, bracket_side, match_format)
    VALUES (p_tournament_id, 1, v_i, v_seeded[v_i*2-1], v_seeded[v_i*2],
      CASE WHEN v_seeded[v_i*2-1] IS NULL OR v_seeded[v_i*2] IS NULL THEN 'bye' ELSE 'pending' END,
      'winners', v_fmt);
  END LOOP;

  -- W R2..Rfinal (最終ラウンド = 勝者側決勝は wf 上書き)
  FOR v_j IN 2..v_rounds LOOP
    v_match_count := (v_bracket_size / power(2, v_j))::int;
    v_fmt := CASE WHEN v_j = v_rounds
                  THEN _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'wf')
                  ELSE v_tournament.match_format END;
    FOR v_i IN 1..v_match_count LOOP
      INSERT INTO tournament_matches (tournament_id, round, match_number, status, bracket_side, match_format)
      VALUES (p_tournament_id, v_j, v_i, 'pending', 'winners', v_fmt);
    END LOOP;
  END LOOP;

  -- Auto-advance W R1 byes
  FOR v_i IN 1..v_w_r1_count LOOP
    IF v_seeded[v_i*2-1] IS NOT NULL AND v_seeded[v_i*2] IS NULL THEN v_winner_id := v_seeded[v_i*2-1];
    ELSIF v_seeded[v_i*2-1] IS NULL AND v_seeded[v_i*2] IS NOT NULL THEN v_winner_id := v_seeded[v_i*2];
    ELSE CONTINUE; END IF;

    UPDATE tournament_matches SET winner_entry_id = v_winner_id, completed_at = now()
    WHERE tournament_id = p_tournament_id AND round = 1 AND match_number = v_i AND bracket_side = 'winners';

    IF v_rounds >= 2 THEN
      IF v_i % 2 = 1 THEN
        UPDATE tournament_matches SET entry_a_id = v_winner_id
        WHERE tournament_id = p_tournament_id AND round = 2 AND match_number = ceil(v_i::numeric/2)::int AND bracket_side = 'winners';
      ELSE
        UPDATE tournament_matches SET entry_b_id = v_winner_id
        WHERE tournament_id = p_tournament_id AND round = 2 AND match_number = ceil(v_i::numeric/2)::int AND bracket_side = 'winners';
      END IF;
    END IF;
  END LOOP;

  -- Losers bracket (if double elim)
  IF v_elim_type = 'double' THEN
    v_losers_rounds := (v_rounds - 1) * 2;
    IF v_losers_rounds > 0 THEN
      FOR v_j IN 1..v_losers_rounds LOOP
        v_match_count := greatest(1, (v_bracket_size / power(2, ceil(v_j::numeric/2) + 1))::int);
        v_fmt := CASE WHEN v_j = v_losers_rounds
                      THEN _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'lf')
                      ELSE v_tournament.match_format END;
        FOR v_i IN 1..v_match_count LOOP
          INSERT INTO tournament_matches (tournament_id, round, match_number, status, bracket_side, match_format)
          VALUES (p_tournament_id, v_j, v_i, 'pending', 'losers', v_fmt);
        END LOOP;
      END LOOP;

      FOR v_j IN 1..(v_w_r1_count / 2) LOOP
        SELECT status INTO v_feeder_a_status FROM tournament_matches WHERE tournament_id = p_tournament_id AND bracket_side = 'winners' AND round = 1 AND match_number = v_j;
        SELECT status INTO v_feeder_b_status FROM tournament_matches WHERE tournament_id = p_tournament_id AND bracket_side = 'winners' AND round = 1 AND match_number = v_w_r1_count + 1 - v_j;
        IF v_feeder_a_status = 'bye' AND v_feeder_b_status = 'bye' THEN
          UPDATE tournament_matches SET status = 'bye', completed_at = now()
          WHERE tournament_id = p_tournament_id AND bracket_side = 'losers' AND round = 1 AND match_number = v_j;
        END IF;
      END LOOP;
    END IF;

    v_fmt := _tournament_round_format(v_tournament.metadata, v_tournament.match_format, 'gf');
    INSERT INTO tournament_matches (tournament_id, round, match_number, status, bracket_side, match_format)
    VALUES (p_tournament_id, 1, 1, 'pending', 'grand_final', v_fmt);

    IF v_tournament.gf_reset THEN
      INSERT INTO tournament_matches (tournament_id, round, match_number, status, bracket_side, match_format)
      VALUES (p_tournament_id, 2, 1, 'pending', 'grand_final', v_fmt);
    END IF;
  END IF;

  UPDATE tournaments SET group_phase_status = 'playoff', updated_at = now() WHERE id = p_tournament_id;

  RETURN json_build_object('ok', true, 'playoff_teams', v_playoff_count, 'bracket_size', v_bracket_size,
    'elimination', v_elim_type, 'advance_per_group', v_advance_count);
END;
$$;

-- ------------------------------------------------------------
-- 4) rpc_tournament_start_banpick
--    per-match の match_format を正とする (従来は tournaments.match_format で
--    上書きしていたため、ラウンド別BOが消えていた)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_tournament_start_banpick(p_tournament_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_tournament record;
  v_selected_mode text;
  v_rand int;
  v_first_turn uuid;
  v_is_host boolean;
  v_is_participant boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_match FROM tournament_matches WHERE id = p_tournament_match_id;
  IF v_match IS NULL THEN RAISE EXCEPTION '試合が見つかりません'; END IF;
  IF v_match.banpick_status <> 'waiting' THEN RAISE EXCEPTION 'バンピックは既に開始されています'; END IF;
  IF v_match.entry_a_id IS NULL OR v_match.entry_b_id IS NULL THEN RAISE EXCEPTION '対戦相手が決まっていません'; END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = v_match.tournament_id;

  -- 権限チェック: 主催者 or この試合の参加者
  v_is_host := (v_tournament.host_user_id = v_uid) OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true);
  SELECT EXISTS (
    SELECT 1 FROM tournament_entries te
    WHERE te.tournament_id = v_match.tournament_id
      AND te.user_id = v_uid
      AND te.assigned_team_index IN (
        SELECT assigned_team_index FROM tournament_entries WHERE id IN (v_match.entry_a_id, v_match.entry_b_id)
      )
  ) OR EXISTS (
    SELECT 1 FROM tournament_entries te WHERE te.id IN (v_match.entry_a_id, v_match.entry_b_id) AND te.user_id = v_uid
  ) INTO v_is_participant;

  IF NOT v_is_host AND NOT v_is_participant THEN
    RAISE EXCEPTION 'この試合の参加者または主催者のみ開始できます';
  END IF;

  -- モード決定 (この試合の match_format を使用)
  IF v_match.match_format = 'bo1' THEN
    IF v_tournament.bo1_mode = 'random' THEN
      v_rand := floor(random() * 9)::int;
      IF v_rand < 6 THEN v_selected_mode := 'hp';
      ELSIF v_rand < 8 THEN v_selected_mode := 'snd';
      ELSE v_selected_mode := 'ovl'; END IF;
    ELSE
      v_selected_mode := v_tournament.bo1_mode;
    END IF;
  ELSE
    v_selected_mode := 'hp';
  END IF;

  -- 先行チームをランダム抽選
  IF random() < 0.5 THEN
    v_first_turn := v_match.entry_a_id;
  ELSE
    v_first_turn := v_match.entry_b_id;
  END IF;

  UPDATE tournament_matches
  SET selected_mode = v_selected_mode,
      current_game = 1,
      games = '[]'::jsonb,
      banpick_status = 'in_progress',
      banpick_turn_entry_id = v_first_turn,
      banpick_action = 'ban',
      bans = '[]'::jsonb,
      selected_map = NULL,
      side_choice = NULL
  WHERE id = p_tournament_match_id;

  RETURN json_build_object('ok', true, 'mode', v_selected_mode, 'format', v_match.match_format, 'first_turn', v_first_turn);
END;
$$;
