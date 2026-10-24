-- ============================================================
-- ライブパネル用の統計RPC
--
-- トップページ / カスタムページの「いまのASCENT」パネルが呼ぶ。
-- 人がどこにいるかを可視化し、流動性のあるモードへ誘導する。
-- 集計値のみを返す (個人情報なし) ため未ログインでも呼び出し可。
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_live_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_queue_waiting int;
  v_eights_lobbies int;
  v_eights_players int;
  v_scrims_today int;
  v_rooms_open int;
BEGIN
  -- ランクマッチ待機人数 (waiting エントリーの party_size 合計。
  -- 心拍切れは cron が expired にするが、鮮度のため60秒条件も併用)
  SELECT coalesce(sum(party_size), 0) INTO v_queue_waiting
  FROM queue_entries
  WHERE status = 'waiting'
    AND queue_type = 'ranked'
    AND last_heartbeat > now() - interval '60 seconds';

  -- 8s: 募集中・振り分け中のロビー数と参加人数 (非公開ロビーは除外)
  SELECT count(*) INTO v_eights_lobbies
  FROM eights_lobbies WHERE status IN ('open', 'drafting') AND NOT is_private;
  SELECT count(*) INTO v_eights_players
  FROM eights_lobby_members m
  JOIN eights_lobbies l ON l.id = m.lobby_id
  WHERE l.status IN ('open', 'drafting') AND NOT l.is_private;

  -- 今日の交流戦 (成立済み)
  SELECT count(*) INTO v_scrims_today
  FROM scrim_matches WHERE status = 'confirmed' AND date = v_today;

  -- 募集中の混成ルーム (今日以降)
  SELECT count(*) INTO v_rooms_open
  FROM scrim_mixed_rooms WHERE status = 'open' AND date >= v_today;

  RETURN json_build_object(
    'queue_waiting', v_queue_waiting,
    'eights_lobbies', v_eights_lobbies,
    'eights_players', v_eights_players,
    'scrims_today', v_scrims_today,
    'mixed_rooms_open', v_rooms_open
  );
END;
$$;
