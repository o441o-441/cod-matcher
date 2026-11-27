-- ============================================================
-- 大会バンピック進行RPC (ban×2 → pick_map → pick_side をゲームごとに繰り返す)
--
-- この関数は従来DBにのみ存在していた (リポジトリにSQLなし)。
-- 2026-11-27 の修正 (fix_banpick_alternate_first_turn) を機にファイル化。
--
-- 修正内容: 次ゲームの先行決定バグ
--   旧実装は「偶数ゲーム=entry_b / 奇数ゲーム=entry_a」の固定割当だったため、
--   ゲーム1の抽選で entry_b が先行になると ゲーム1・2 連続で entry_b が
--   マップピック側になっていた (BO3が2-0なら全マップ相手ピック)。
--   pick_side 時点の banpick_turn_entry_id は今ゲームの後攻側なので、
--   それを次ゲームの先行に引き継げば抽選結果に依らず先行が交互になる。
--
-- ターン遷移 (1ゲーム内): ban(先行) → ban(後攻) → pick_map(先行) → pick_side(後攻)
-- 主催者/管理者はターンに関係なく両チーム分を代行可能。
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_tournament_banpick_action(p_tournament_match_id uuid, p_action text, p_target text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_tournament record;
  v_is_host boolean;
  v_is_my_turn boolean;
  v_next_turn uuid;
  v_bans jsonb;
  v_total_games int;
  v_mode_order text[] := ARRAY['hp','snd','ovl','hp','snd'];
  v_next_game int;
  v_game_record jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_match FROM tournament_matches WHERE id = p_tournament_match_id FOR UPDATE;
  IF v_match IS NULL THEN RAISE EXCEPTION '試合が見つかりません'; END IF;
  IF v_match.banpick_status <> 'in_progress' THEN RAISE EXCEPTION 'バンピックは進行中ではありません'; END IF;
  IF v_match.banpick_action <> p_action THEN RAISE EXCEPTION 'アクションタイプが一致しません'; END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = v_match.tournament_id;
  v_is_host := (v_tournament.host_user_id = v_uid) OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true);

  IF NOT v_is_host THEN
    SELECT EXISTS (
      SELECT 1 FROM tournament_entries te
      WHERE te.tournament_id = v_match.tournament_id
        AND te.user_id = v_uid
        AND (
          te.id = v_match.banpick_turn_entry_id
          OR te.assigned_team_index = (SELECT assigned_team_index FROM tournament_entries WHERE id = v_match.banpick_turn_entry_id LIMIT 1)
        )
    ) INTO v_is_my_turn;
    IF NOT v_is_my_turn THEN RAISE EXCEPTION 'あなたのターンではありません'; END IF;
  END IF;

  v_bans := v_match.bans;
  v_total_games := CASE v_match.match_format WHEN 'bo3' THEN 3 WHEN 'bo5' THEN 5 ELSE 1 END;

  IF p_action = 'ban' THEN
    v_bans := v_bans || to_jsonb(p_target);
    IF jsonb_array_length(v_bans) < 2 THEN
      v_next_turn := CASE WHEN v_match.banpick_turn_entry_id = v_match.entry_a_id THEN v_match.entry_b_id ELSE v_match.entry_a_id END;
      UPDATE tournament_matches SET bans = v_bans, banpick_turn_entry_id = v_next_turn WHERE id = p_tournament_match_id;
    ELSE
      v_next_turn := CASE WHEN v_match.banpick_turn_entry_id = v_match.entry_a_id THEN v_match.entry_b_id ELSE v_match.entry_a_id END;
      UPDATE tournament_matches SET bans = v_bans, banpick_turn_entry_id = v_next_turn, banpick_action = 'pick_map' WHERE id = p_tournament_match_id;
    END IF;

  ELSIF p_action = 'pick_map' THEN
    v_next_turn := CASE WHEN v_match.banpick_turn_entry_id = v_match.entry_a_id THEN v_match.entry_b_id ELSE v_match.entry_a_id END;
    UPDATE tournament_matches SET selected_map = p_target, banpick_turn_entry_id = v_next_turn, banpick_action = 'pick_side' WHERE id = p_tournament_match_id;

  ELSIF p_action = 'pick_side' THEN
    v_game_record := jsonb_build_object('game', v_match.current_game, 'mode', v_match.selected_mode, 'map', v_match.selected_map, 'bans', v_bans, 'side', p_target);
    v_next_game := v_match.current_game + 1;

    IF v_next_game > v_total_games THEN
      UPDATE tournament_matches
      SET side_choice = p_target, games = v_match.games || v_game_record,
          banpick_status = 'completed', banpick_action = NULL, banpick_turn_entry_id = NULL
      WHERE id = p_tournament_match_id;
    ELSE
      -- 次ゲームの先行 = 今ゲームの後攻。
      -- pick_side 時点の banpick_turn_entry_id がちょうど今ゲームの後攻側なので、
      -- これを引き継ぐことでゲーム1の抽選結果に依らず先行が交互になる。
      v_next_turn := v_match.banpick_turn_entry_id;

      UPDATE tournament_matches
      SET side_choice = p_target, games = v_match.games || v_game_record,
          current_game = v_next_game, selected_mode = v_mode_order[v_next_game],
          selected_map = NULL, bans = '[]'::jsonb,
          banpick_turn_entry_id = v_next_turn,
          banpick_action = 'ban'
      WHERE id = p_tournament_match_id;
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'action', p_action, 'target', p_target);
END;
$function$;
