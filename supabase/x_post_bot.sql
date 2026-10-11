-- ============================================================
-- X (Twitter) 自動投稿BOT
--
-- plze文化 (Xの末尾にplzeを付けて対戦募集する慣習) に乗せて、
-- ASCENTの募集をXへ自動投稿する。
--   (1) 8s開催時: 「⚡ 8s募集中！… plze #cod #MW4」
--       (rpc_eights_create_lobby 内から _x_post を呼ぶ)
--   (2) 毎日20:00 JST: 今夜の交流戦の成立件数と相手募集中チーム数
--       (成立0件かつ募集0チームの日は投稿しない)
--
-- 実体は Edge Function `x-post` (OAuth 1.0a署名でX API v2へ投稿)。
-- 呼び出し情報は app_settings に保存:
--   x_post_function_url — https://<project>.supabase.co/functions/v1/x-post
--   x_post_secret       — Edge Function と共有する認証シークレット
-- どちらか未設定なら投稿はスキップ (ベストエフォート)。
-- ============================================================

-- ------------------------------------------------------------
-- X投稿ヘルパー (ベストエフォート)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._x_post(p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_start text;
BEGIN
  SELECT value INTO v_url FROM app_settings WHERE key = 'x_post_function_url';
  SELECT value INTO v_secret FROM app_settings WHERE key = 'x_post_secret';
  IF v_url IS NULL OR v_secret IS NULL OR p_text IS NULL OR trim(p_text) = '' THEN RETURN; END IF;

  -- 本稼働開始日 (x_post_start_date, JST)。設定されていて未来日なら投稿しない
  SELECT value INTO v_start FROM app_settings WHERE key = 'x_post_start_date';
  IF v_start IS NOT NULL AND (now() AT TIME ZONE 'Asia/Tokyo')::date < v_start::date THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-post-secret', v_secret),
    body := jsonb_build_object('text', p_text)
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ------------------------------------------------------------
-- 毎日20:00 JST: 今夜の交流戦状況を投稿 (pg_cron から実行)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_x_daily_scrim_post()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_matches int;
  v_open_teams int;
  v_open_rooms int;
BEGIN
  -- 今日の成立済み交流戦
  SELECT count(*) INTO v_matches
  FROM scrim_matches WHERE status = 'confirmed' AND date = v_today;

  -- 20:00以降 (全スロット) に4人揃った空き枠が残っているチーム数
  SELECT count(DISTINCT c.team_id) INTO v_open_teams
  FROM scrim_slot_counts c
  WHERE c.date = v_today AND c.available >= 4
    AND NOT EXISTS (
      SELECT 1 FROM scrim_matches m
      WHERE m.status = 'confirmed' AND m.date = v_today
        AND (m.host_team_id = c.team_id OR m.guest_team_id = c.team_id)
        AND c.slot_index >= m.slot_start AND c.slot_index < m.slot_end
    );

  -- 募集中の混成ルーム (今日・4人以上)
  SELECT count(*) INTO v_open_rooms
  FROM scrim_mixed_rooms r
  WHERE r.date = v_today AND r.status = 'open'
    AND (SELECT count(*) FROM scrim_mixed_room_members rm WHERE rm.room_id = r.id) >= 4;

  v_open_teams := v_open_teams + v_open_rooms;

  -- 何もない日は投稿しない (空のレストランを宣伝しない)
  IF v_matches = 0 AND v_open_teams = 0 THEN RETURN; END IF;

  PERFORM _x_post(
    '🌙 今夜のASCENT交流戦' || E'\n'
    || '成立済み: ' || v_matches || '件 / 相手募集中: ' || v_open_teams || 'チーム' || E'\n'
    || '今夜の相手を探すなら → https://ascent-esports.com/custom/board' || E'\n'
    || 'plze #cod #MW4'
  );
END;
$$;

-- cron 登録: 毎日 11:00 UTC = 20:00 JST
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'x-daily-scrim-post') THEN
    PERFORM cron.unschedule('x-daily-scrim-post');
  END IF;
  PERFORM cron.schedule('x-daily-scrim-post', '0 11 * * *', 'select public.fn_x_daily_scrim_post()');
END;
$$;

-- app_settings への接続情報登録 (値は運用時に投入する。シークレットはコミットしない):
-- INSERT INTO app_settings (key, value) VALUES ('x_post_function_url', 'https://<project>.supabase.co/functions/v1/x-post');
-- INSERT INTO app_settings (key, value) VALUES ('x_post_secret', '<X_POST_SECRETと同じ値>');
