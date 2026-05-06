-- ============================================================
-- Double Elimination Bracket: Corrected Implementation
-- ============================================================
-- Fixes:
-- 1. Standard bracket seeding order (1v8, 4v5, 2v7, 3v6)
-- 2. Power-of-2 padding with byes
-- 3. Losers R1: mirror-fold (rematch avoidance)
-- 4. Losers advancement: odd=inner(1:1), even=dropdown(halving)
-- 5. Bye cascade in losers bracket
-- ============================================================


-- ============================================================
-- Helper: auto-advance losers bracket byes (cascade loop)
-- ============================================================
CREATE OR REPLACE FUNCTION public._tournament_losers_advance_if_bye(
  p_tournament_id uuid,
  p_losers_match_id uuid,
  p_w_r1_count int,
  p_losers_rounds int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lm record;
  v_feeder_status text;
  v_feeder_winner uuid;
  v_the_entry uuid;
  v_is_bye boolean;
  v_next_round int;
  v_next_match int;
  v_next_slot text;
  v_next_match_id uuid;
  v_current_match_id uuid;
BEGIN
  v_current_match_id := p_losers_match_id;

  LOOP
    SELECT * INTO v_lm FROM tournament_matches WHERE id = v_current_match_id;
    IF v_lm IS NULL OR v_lm.status IN ('completed', 'bye') THEN EXIT; END IF;

    -- Both entries set → match is playable, done
    IF v_lm.entry_a_id IS NOT NULL AND v_lm.entry_b_id IS NOT NULL THEN EXIT; END IF;
    -- Neither entry → nothing to advance
    IF v_lm.entry_a_id IS NULL AND v_lm.entry_b_id IS NULL THEN EXIT; END IF;

    v_is_bye := false;

    IF v_lm.entry_a_id IS NULL THEN
      -- Slot A missing — check its feeder
      IF v_lm.round = 1 THEN
        -- L R1 slot A ← W R1 M_(match_number) loser
        SELECT status INTO v_feeder_status FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'winners'
          AND round = 1 AND match_number = v_lm.match_number;
        v_is_bye := (v_feeder_status = 'bye');
      ELSIF v_lm.round % 2 = 0 THEN
        -- Even (dropdown) slot A ← L R(round-1) M_(match_number) winner (1:1)
        SELECT winner_entry_id, status INTO v_feeder_winner, v_feeder_status
        FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'losers'
          AND round = v_lm.round - 1 AND match_number = v_lm.match_number;
        v_is_bye := (v_feeder_status IN ('completed', 'bye') AND v_feeder_winner IS NULL);
      ELSE
        -- Odd (inner, round>1) slot A ← L R(round-1) M_(2*match-1) winner (halving odd)
        SELECT winner_entry_id, status INTO v_feeder_winner, v_feeder_status
        FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'losers'
          AND round = v_lm.round - 1 AND match_number = 2 * v_lm.match_number - 1;
        v_is_bye := (v_feeder_status IN ('completed', 'bye') AND v_feeder_winner IS NULL);
      END IF;

    ELSIF v_lm.entry_b_id IS NULL THEN
      -- Slot B missing — check its feeder
      IF v_lm.round = 1 THEN
        -- L R1 slot B ← W R1 M_(w_r1_count+1-match_number) loser (mirror)
        SELECT status INTO v_feeder_status FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'winners'
          AND round = 1 AND match_number = p_w_r1_count + 1 - v_lm.match_number;
        v_is_bye := (v_feeder_status = 'bye');
      ELSIF v_lm.round % 2 = 0 THEN
        -- Even (dropdown) slot B ← W R(round/2+1) M_(match_number) loser
        -- Winners match might not have completed yet → not a bye
        SELECT status INTO v_feeder_status FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'winners'
          AND round = v_lm.round / 2 + 1 AND match_number = v_lm.match_number;
        v_is_bye := (v_feeder_status = 'bye');
      ELSE
        -- Odd (inner, round>1) slot B ← L R(round-1) M_(2*match) winner (halving even)
        SELECT winner_entry_id, status INTO v_feeder_winner, v_feeder_status
        FROM tournament_matches
        WHERE tournament_id = p_tournament_id AND bracket_side = 'losers'
          AND round = v_lm.round - 1 AND match_number = 2 * v_lm.match_number;
        v_is_bye := (v_feeder_status IN ('completed', 'bye') AND v_feeder_winner IS NULL);
      END IF;
    END IF;

    IF NOT v_is_bye THEN EXIT; END IF;

    -- Auto-advance the only entry as bye
    v_the_entry := coalesce(v_lm.entry_a_id, v_lm.entry_b_id);
    UPDATE tournament_matches
    SET winner_entry_id = v_the_entry, status = 'bye', completed_at = now()
    WHERE id = v_current_match_id;

    -- Last losers round → Grand Final slot B
    IF v_lm.round >= p_losers_rounds THEN
      UPDATE tournament_matches SET entry_b_id = v_the_entry
      WHERE tournament_id = p_tournament_id AND bracket_side = 'grand_final';
      EXIT;
    END IF;

    -- Determine next losers match
    IF v_lm.round % 2 = 1 THEN
      -- Odd (inner) → Even (dropdown): 1:1, slot A
      v_next_round := v_lm.round + 1;
      v_next_match := v_lm.match_number;
      v_next_slot := 'a';
    ELSE
      -- Even (dropdown) → Odd (inner): halving
      v_next_round := v_lm.round + 1;
      v_next_match := ceil(v_lm.match_number::numeric / 2)::int;
      v_next_slot := CASE WHEN v_lm.match_number % 2 = 1 THEN 'a' ELSE 'b' END;
    END IF;

    SELECT id INTO v_next_match_id FROM tournament_matches
    WHERE tournament_id = p_tournament_id AND bracket_side = 'losers'
      AND round = v_next_round AND match_number = v_next_match;

    IF v_next_match_id IS NULL THEN EXIT; END IF;

    IF v_next_slot = 'a' THEN
      UPDATE tournament_matches SET entry_a_id = v_the_entry WHERE id = v_next_match_id;
    ELSE
      UPDATE tournament_matches SET entry_b_id = v_the_entry WHERE id = v_next_match_id;
    END IF;

    v_current_match_id := v_next_match_id;
  END LOOP;
END;
$$;


-- ============================================================
-- rpc_tournament_generate_bracket (rewritten)
-- ============================================================
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
  -- Iterative doubling: [1] → [1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6]
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

  -- W R1 matches
  FOR v_i IN 1..v_w_r1_count LOOP
    INSERT INTO tournament_matches (
      tournament_id, round, match_number, entry_a_id, entry_b_id,
      status, bracket_side, match_format
    ) VALUES (
      p_tournament_id, 1, v_i,
      v_seeded[v_i * 2 - 1], v_seeded[v_i * 2],
      CASE WHEN v_seeded[v_i*2-1] IS NULL OR v_seeded[v_i*2] IS NULL
           THEN 'bye' ELSE 'pending' END,
      'winners', v_tournament.match_format
    );
  END LOOP;

  -- W R2..Rfinal empty matches
  FOR v_j IN 2..v_rounds LOOP
    v_match_count := (v_bracket_size / power(2, v_j))::int;
    FOR v_i IN 1..v_match_count LOOP
      INSERT INTO tournament_matches (
        tournament_id, round, match_number, status, bracket_side, match_format
      ) VALUES (p_tournament_id, v_j, v_i, 'pending', 'winners', v_tournament.match_format);
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
      -- Create L bracket match slots
      -- Match count per round: bracket_size / 2^(ceil(round/2)+1)
      FOR v_j IN 1..v_losers_rounds LOOP
        v_match_count := greatest(1,
          (v_bracket_size / power(2, ceil(v_j::numeric/2) + 1))::int);
        FOR v_i IN 1..v_match_count LOOP
          INSERT INTO tournament_matches (
            tournament_id, round, match_number, status, bracket_side, match_format
          ) VALUES (p_tournament_id, v_j, v_i, 'pending', 'losers', v_tournament.match_format);
        END LOOP;
      END LOOP;

      -- Mark double-bye L R1 matches
      -- L R1 M_j: feeder A = W R1 M_j, feeder B = W R1 M_(w_r1_count+1-j)
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

    -- Grand Final (round 1)
    INSERT INTO tournament_matches (
      tournament_id, round, match_number, status, bracket_side, match_format
    ) VALUES (p_tournament_id, 1, 1, 'pending', 'grand_final', v_tournament.match_format);

    -- Grand Final Reset (round 2) — only if gf_reset enabled
    IF v_tournament.gf_reset THEN
      INSERT INTO tournament_matches (
        tournament_id, round, match_number, status, bracket_side, match_format
      ) VALUES (p_tournament_id, 2, 1, 'pending', 'grand_final', v_tournament.match_format);
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


-- ============================================================
-- rpc_tournament_report_result (rewritten)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_tournament_report_result(
  p_tournament_match_id uuid,
  p_winner_entry_id uuid,
  p_score_a int DEFAULT 0,
  p_score_b int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_tournament record;
  v_is_host boolean;
  v_is_participant boolean;
  v_loser_entry_id uuid;
  v_next_round int;
  v_next_match_num int;
  v_next_match_id uuid;
  v_bracket_size int;
  v_w_r1_count int;
  v_winners_rounds int;
  v_losers_rounds int;
  -- losers placement
  v_target_l_round int;
  v_target_l_match int;
  v_target_slot text;
  v_target_match_id uuid;
  v_gf_reset_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_match FROM tournament_matches
  WHERE id = p_tournament_match_id FOR UPDATE;
  IF v_match IS NULL THEN RAISE EXCEPTION '試合が見つかりません'; END IF;
  IF v_match.status IN ('completed', 'bye') THEN
    RAISE EXCEPTION 'この試合は既に完了しています';
  END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = v_match.tournament_id;

  -- Auth: host or participant
  v_is_host := (v_tournament.host_user_id = v_uid)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true);
  IF NOT v_is_host THEN
    SELECT EXISTS (
      SELECT 1 FROM tournament_entries te
      WHERE te.tournament_id = v_match.tournament_id AND te.user_id = v_uid
        AND (te.id IN (v_match.entry_a_id, v_match.entry_b_id)
          OR te.assigned_team_index IN (
            SELECT assigned_team_index FROM tournament_entries
            WHERE id IN (v_match.entry_a_id, v_match.entry_b_id)
          ))
    ) INTO v_is_participant;
    IF NOT v_is_participant THEN
      RAISE EXCEPTION 'この試合の参加者または主催者のみ報告できます';
    END IF;
  END IF;

  -- Determine loser
  IF p_winner_entry_id = v_match.entry_a_id THEN
    v_loser_entry_id := v_match.entry_b_id;
  ELSE
    v_loser_entry_id := v_match.entry_a_id;
  END IF;

  -- Complete this match
  UPDATE tournament_matches
  SET winner_entry_id = p_winner_entry_id, loser_entry_id = v_loser_entry_id,
      score_a = p_score_a, score_b = p_score_b,
      status = 'completed', completed_at = now()
  WHERE id = p_tournament_match_id;

  -- League match: update standings + check group completion (bracket_side based, not format based)
  IF v_match.bracket_side = 'league' THEN
    UPDATE league_standings
    SET wins = wins + 1, points = points + 3,
        rounds_won = rounds_won + p_score_a, rounds_lost = rounds_lost + p_score_b,
        updated_at = now()
    WHERE tournament_id = v_match.tournament_id AND entry_id = p_winner_entry_id;
    UPDATE league_standings
    SET losses = losses + 1,
        rounds_won = rounds_won + p_score_b, rounds_lost = rounds_lost + p_score_a,
        updated_at = now()
    WHERE tournament_id = v_match.tournament_id AND entry_id = v_loser_entry_id;

    -- Update team ratings (Elo)
    PERFORM _tournament_update_team_ratings(v_match.tournament_id, p_winner_entry_id, v_loser_entry_id);

    -- Auto-detect group phase completion for block league
    IF v_tournament.block_count >= 2 THEN
      IF NOT EXISTS (
        SELECT 1 FROM tournament_matches
        WHERE tournament_id = v_match.tournament_id
          AND bracket_side = 'league' AND status = 'pending'
      ) THEN
        UPDATE tournaments
        SET group_phase_status = 'completed', updated_at = now()
        WHERE id = v_match.tournament_id AND group_phase_status = 'in_progress';
      END IF;
    END IF;

    RETURN json_build_object('ok', true, 'winner', p_winner_entry_id);
  END IF;

  -- Update team ratings for bracket matches too
  PERFORM _tournament_update_team_ratings(v_match.tournament_id, p_winner_entry_id, v_loser_entry_id);

  -- Compute bracket dimensions from W R1 count (tournament format only)
  SELECT count(*)::int INTO v_w_r1_count
  FROM tournament_matches
  WHERE tournament_id = v_match.tournament_id
    AND bracket_side = 'winners' AND round = 1;
  v_bracket_size := v_w_r1_count * 2;
  v_winners_rounds := (log(2, v_bracket_size))::int;
  v_losers_rounds := CASE
    WHEN v_tournament.elimination_type = 'double' THEN (v_winners_rounds - 1) * 2
    ELSE 0 END;

  -- ══════════════════ WINNERS BRACKET ══════════════════
  IF v_match.bracket_side = 'winners' THEN

    -- Advance winner to next winners round
    v_next_round := v_match.round + 1;
    v_next_match_num := ceil(v_match.match_number::numeric / 2)::int;
    SELECT id INTO v_next_match_id FROM tournament_matches
    WHERE tournament_id = v_match.tournament_id AND round = v_next_round
      AND match_number = v_next_match_num AND bracket_side = 'winners';

    IF v_next_match_id IS NOT NULL THEN
      -- Place in W next round
      IF v_match.match_number % 2 = 1 THEN
        UPDATE tournament_matches SET entry_a_id = p_winner_entry_id WHERE id = v_next_match_id;
      ELSE
        UPDATE tournament_matches SET entry_b_id = p_winner_entry_id WHERE id = v_next_match_id;
      END IF;
    ELSE
      -- Winners Final (no next W round)
      IF v_tournament.elimination_type = 'double' THEN
        UPDATE tournament_matches SET entry_a_id = p_winner_entry_id
        WHERE tournament_id = v_match.tournament_id AND bracket_side = 'grand_final';
      ELSE
        -- Single elim complete
        UPDATE tournaments SET status = 'completed',
          winner_info = jsonb_build_object('entry_id', p_winner_entry_id),
          updated_at = now()
        WHERE id = v_match.tournament_id;
      END IF;
    END IF;

    -- Handle loser placement
    IF v_tournament.elimination_type = 'double' AND v_loser_entry_id IS NOT NULL THEN

      IF v_losers_rounds = 0 THEN
        -- Edge case: 2 teams, no L bracket → loser goes directly to GF
        UPDATE tournament_matches SET entry_b_id = v_loser_entry_id
        WHERE tournament_id = v_match.tournament_id AND bracket_side = 'grand_final';

      ELSIF v_match.round = 1 THEN
        -- ── W R1 loser → L R1 with mirror-fold ──
        -- First half (m ≤ W/2): L R1 M_m, slot A
        -- Second half (m > W/2): L R1 M_(W+1-m), slot B
        IF v_match.match_number <= v_w_r1_count / 2 THEN
          v_target_l_round := 1;
          v_target_l_match := v_match.match_number;
          v_target_slot := 'a';
        ELSE
          v_target_l_round := 1;
          v_target_l_match := v_w_r1_count + 1 - v_match.match_number;
          v_target_slot := 'b';
        END IF;

        SELECT id INTO v_target_match_id FROM tournament_matches
        WHERE tournament_id = v_match.tournament_id AND bracket_side = 'losers'
          AND round = v_target_l_round AND match_number = v_target_l_match;

        IF v_target_match_id IS NOT NULL THEN
          IF v_target_slot = 'a' THEN
            UPDATE tournament_matches SET entry_a_id = v_loser_entry_id
            WHERE id = v_target_match_id;
          ELSE
            UPDATE tournament_matches SET entry_b_id = v_loser_entry_id
            WHERE id = v_target_match_id;
          END IF;
          PERFORM _tournament_losers_advance_if_bye(
            v_match.tournament_id, v_target_match_id, v_w_r1_count, v_losers_rounds);
        END IF;

      ELSE
        -- ── W Rk (k≥2) loser → L R(2*(k-1)), slot B, straight mapping ──
        v_target_l_round := 2 * (v_match.round - 1);
        v_target_l_match := v_match.match_number;

        SELECT id INTO v_target_match_id FROM tournament_matches
        WHERE tournament_id = v_match.tournament_id AND bracket_side = 'losers'
          AND round = v_target_l_round AND match_number = v_target_l_match;

        IF v_target_match_id IS NOT NULL THEN
          UPDATE tournament_matches SET entry_b_id = v_loser_entry_id
          WHERE id = v_target_match_id;
          PERFORM _tournament_losers_advance_if_bye(
            v_match.tournament_id, v_target_match_id, v_w_r1_count, v_losers_rounds);
        END IF;
      END IF;

    ELSIF v_tournament.elimination_type = 'single' AND v_loser_entry_id IS NOT NULL THEN
      UPDATE tournament_entries SET status = 'eliminated' WHERE id = v_loser_entry_id;
    END IF;

  -- ══════════════════ LOSERS BRACKET ══════════════════
  ELSIF v_match.bracket_side = 'losers' THEN

    -- Eliminate loser
    IF v_loser_entry_id IS NOT NULL THEN
      UPDATE tournament_entries SET status = 'eliminated' WHERE id = v_loser_entry_id;
    END IF;

    -- Advance winner
    IF v_match.round >= v_losers_rounds THEN
      -- Last losers round → Grand Final slot B
      UPDATE tournament_matches SET entry_b_id = p_winner_entry_id
      WHERE tournament_id = v_match.tournament_id AND bracket_side = 'grand_final';
    ELSE
      -- Determine next losers match
      IF v_match.round % 2 = 1 THEN
        -- Odd (inner) → Even (dropdown): 1:1, slot A
        v_next_round := v_match.round + 1;
        v_next_match_num := v_match.match_number;
        v_target_slot := 'a';
      ELSE
        -- Even (dropdown) → Odd (inner): halving
        v_next_round := v_match.round + 1;
        v_next_match_num := ceil(v_match.match_number::numeric / 2)::int;
        v_target_slot := CASE WHEN v_match.match_number % 2 = 1 THEN 'a' ELSE 'b' END;
      END IF;

      SELECT id INTO v_next_match_id FROM tournament_matches
      WHERE tournament_id = v_match.tournament_id AND bracket_side = 'losers'
        AND round = v_next_round AND match_number = v_next_match_num;

      IF v_next_match_id IS NOT NULL THEN
        IF v_target_slot = 'a' THEN
          UPDATE tournament_matches SET entry_a_id = p_winner_entry_id WHERE id = v_next_match_id;
        ELSE
          UPDATE tournament_matches SET entry_b_id = p_winner_entry_id WHERE id = v_next_match_id;
        END IF;
        PERFORM _tournament_losers_advance_if_bye(
          v_match.tournament_id, v_next_match_id, v_w_r1_count, v_losers_rounds);
      END IF;
    END IF;

  -- ══════════════════ GRAND FINAL ══════════════════
  ELSIF v_match.bracket_side = 'grand_final' THEN

    IF v_match.round = 1 THEN
      -- GF round 1: entry_a = Winners champ, entry_b = Losers champ
      IF p_winner_entry_id = v_match.entry_a_id THEN
        -- Winners champ wins → no reset needed
        IF v_loser_entry_id IS NOT NULL THEN
          UPDATE tournament_entries SET status = 'eliminated' WHERE id = v_loser_entry_id;
        END IF;
        UPDATE tournament_matches SET status = 'bye', completed_at = now()
        WHERE tournament_id = v_match.tournament_id
          AND bracket_side = 'grand_final' AND round = 2;
        UPDATE tournaments SET status = 'completed',
          winner_info = jsonb_build_object('entry_id', p_winner_entry_id),
          updated_at = now()
        WHERE id = v_match.tournament_id;
      ELSE
        -- Losers champ wins GF1 → check for reset
        SELECT id INTO v_gf_reset_id FROM tournament_matches
        WHERE tournament_id = v_match.tournament_id
          AND bracket_side = 'grand_final' AND round = 2;
        IF v_gf_reset_id IS NOT NULL THEN
          UPDATE tournament_matches
          SET entry_a_id = v_loser_entry_id,   -- W champ (lost GF1)
              entry_b_id = p_winner_entry_id    -- L champ (won GF1)
          WHERE id = v_gf_reset_id;
        ELSE
          IF v_loser_entry_id IS NOT NULL THEN
            UPDATE tournament_entries SET status = 'eliminated' WHERE id = v_loser_entry_id;
          END IF;
          UPDATE tournaments SET status = 'completed',
            winner_info = jsonb_build_object('entry_id', p_winner_entry_id),
            updated_at = now()
          WHERE id = v_match.tournament_id;
        END IF;
      END IF;

    ELSIF v_match.round = 2 THEN
      -- GF Reset: winner takes tournament
      IF v_loser_entry_id IS NOT NULL THEN
        UPDATE tournament_entries SET status = 'eliminated' WHERE id = v_loser_entry_id;
      END IF;
      UPDATE tournaments SET status = 'completed',
        winner_info = jsonb_build_object('entry_id', p_winner_entry_id),
        updated_at = now()
      WHERE id = v_match.tournament_id;
    END IF;

  END IF;

  RETURN json_build_object('ok', true, 'winner', p_winner_entry_id);
END;
$$;
