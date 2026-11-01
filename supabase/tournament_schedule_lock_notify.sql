-- ============================================================
-- 大会: スケジュール進行ロック + 開催時間通知 + 結果発表 (2026-11-01)
--
-- (1) 進行ロック (trg_tournament_schedule_lock)
--     metadata.schedule の日程ブロックに基づき、各試合のラウンドが
--     属するブロックの開始時刻まで「バンピック開始」「結果確定」を
--     サーバー側で拒否する (BEFORE UPDATE トリガー)。
--     - 主催者/管理者/内部処理 (auth.uid() なし) はバイパス
--     - どのブロックにも入っていないラウンドは最終ブロック開始後に解放
--     - スケジュール未設定の大会はロックなし (従来どおり)
--     - bye 系の自動進行 (片側エントリーなしの completed) は対象外
--
-- (2) 開催時間通知 (fn_tournament_schedule_notify, pg_cron 5分毎)
--     各日程ブロック開始の約10分前に、参加者全員+主催者へ
--     サイト内通知 + Discord個人メンション (DAY 2/3 も同様)。
--     スケジュール未設定の大会は event_start で同じ通知を1回。
--     送信済み管理: metadata.notified_blocks / metadata.event_start_notified
--
-- (3) 結果発表 (trg_record_tournament_achievements を拡張)
--     大会完了時に 3位 も実績記録 (ダブルエリミ=敗者側決勝の敗者 /
--     シングルエリミ=準決勝敗者2組 / リーグのみ=順位表3位)。
--     1〜3位の本人へサイト内通知 + Discordへ結果発表embed
--     (入賞者への個人メンション付き、公開告知Webhookへ送信)。
--
-- 旧定義: trg_record_tournament_achievements は tournament_achievements.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1) ラウンドの解放時刻 (スケジュールブロックから解決)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_round_unlock_at(p_metadata jsonb, p_side text, p_round int)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_blocks jsonb;
  v_b jsonb;
  v_start timestamptz;
  v_last timestamptz;
  v_covered boolean;
BEGIN
  v_blocks := p_metadata->'schedule';
  IF v_blocks IS NULL OR jsonb_typeof(v_blocks) <> 'array' OR jsonb_array_length(v_blocks) = 0 THEN
    RETURN NULL;
  END IF;
  FOR v_b IN SELECT * FROM jsonb_array_elements(v_blocks) LOOP
    BEGIN
      v_start := nullif(v_b->>'start', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_start := NULL;
    END;
    IF v_start IS NULL THEN CONTINUE; END IF;
    IF v_last IS NULL OR v_start > v_last THEN v_last := v_start; END IF;
    v_covered := CASE
      WHEN p_side = 'winners' THEN coalesce(nullif(v_b->>'wb_until', '')::int, 0) >= p_round
      WHEN p_side = 'losers' THEN coalesce(nullif(v_b->>'lb_until', '')::int, 0) >= p_round
      WHEN p_side = 'grand_final' THEN coalesce((v_b->>'gf')::boolean, false)
      ELSE true
    END;
    IF v_covered THEN RETURN v_start; END IF;
  END LOOP;
  -- 未割当ラウンド = 最終ブロック開始後に解放 (計画外の先行進行を防ぐ)
  RETURN v_last;
END;
$$;

-- ------------------------------------------------------------
-- 2) 進行ロックトリガー
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_tournament_schedule_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t record;
  v_unlock timestamptz;
  v_is_banpick_start boolean;
  v_is_completion boolean;
BEGIN
  v_is_banpick_start := (NEW.banpick_status = 'in_progress' AND OLD.banpick_status IS DISTINCT FROM 'in_progress');
  v_is_completion := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
  IF NOT v_is_banpick_start AND NOT v_is_completion THEN RETURN NEW; END IF;
  IF NEW.bracket_side = 'league' THEN RETURN NEW; END IF;
  -- bye 系の自動進行 (片側エントリーなし) は対象外
  IF v_is_completion AND (NEW.entry_a_id IS NULL OR NEW.entry_b_id IS NULL) THEN RETURN NEW; END IF;
  -- 内部処理 (cron/service) はバイパス
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_t FROM tournaments WHERE id = NEW.tournament_id;
  IF v_t IS NULL THEN RETURN NEW; END IF;
  -- 主催者/管理者はバイパス (代行進行・動作確認用)
  IF v_t.host_user_id = v_uid OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN
    RETURN NEW;
  END IF;

  v_unlock := _tournament_round_unlock_at(v_t.metadata, NEW.bracket_side, NEW.round);
  IF v_unlock IS NOT NULL AND now() < v_unlock THEN
    RAISE EXCEPTION 'この試合は % から開始予定です (大会スケジュールにより進行がロックされています)',
      to_char(v_unlock AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_schedule_lock ON public.tournament_matches;
CREATE TRIGGER tournament_schedule_lock
  BEFORE UPDATE ON public.tournament_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_tournament_schedule_lock();

-- ------------------------------------------------------------
-- 3) 開催時間通知 (cron 5分毎)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_schedule_notify()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  v_blocks jsonb;
  v_notified jsonb;
  v_b jsonb;
  v_i int;
  v_start timestamptz;
  v_label text;
  v_parts text[];
  v_user_ids uuid[];
  v_mention_text text;
  v_mention_ids jsonb;
  v_link text;
  v_body text;
  v_max_wb int;
  v_max_lb int;
  v_n int;
BEGIN
  FOR t IN
    SELECT * FROM tournaments
    WHERE status IN ('recruit', 'seeding', 'live')
      AND (metadata ? 'schedule' OR event_start IS NOT NULL)
  LOOP
    v_blocks := t.metadata->'schedule';
    v_link := '/tournaments/' || t.id;

    -- 通知対象ユーザー (全エントリーの全メンバー + 主催者)
    v_user_ids := NULL;

    -- 実ブラケットのラウンド数 (ラベルのクランプ用。未生成なら NULL)
    SELECT max(round) INTO v_max_wb FROM tournament_matches WHERE tournament_id = t.id AND bracket_side = 'winners';
    SELECT max(round) INTO v_max_lb FROM tournament_matches WHERE tournament_id = t.id AND bracket_side = 'losers';

    IF v_blocks IS NOT NULL AND jsonb_typeof(v_blocks) = 'array' AND jsonb_array_length(v_blocks) > 0 THEN
      -- ── スケジュールブロックごとの通知 ──
      v_notified := coalesce(t.metadata->'notified_blocks', '[]'::jsonb);
      FOR v_i IN 0..jsonb_array_length(v_blocks) - 1 LOOP
        IF v_notified @> to_jsonb(v_i) THEN CONTINUE; END IF;
        v_b := v_blocks->v_i;
        BEGIN
          v_start := nullif(v_b->>'start', '')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
          v_start := NULL;
        END;
        IF v_start IS NULL THEN CONTINUE; END IF;
        -- 開始10分前〜開始30分後の窓で1回だけ送信
        IF now() < v_start - interval '10 minutes' OR now() >= v_start + interval '30 minutes' THEN
          CONTINUE;
        END IF;

        -- 対象ラウンドのラベル (実ブラケットが小さい場合はクランプ)
        v_parts := ARRAY[]::text[];
        IF coalesce(nullif(v_b->>'wb_until', '')::int, 0) > 0 THEN
          v_n := least(nullif(v_b->>'wb_until', '')::int, coalesce(v_max_wb, 999));
          v_parts := array_append(v_parts,
            CASE WHEN v_max_wb IS NOT NULL AND v_n = v_max_wb THEN '勝者側決勝まで'
                 ELSE '勝者側' || v_n || '回戦まで' END);
        END IF;
        IF coalesce(nullif(v_b->>'lb_until', '')::int, 0) > 0
           AND (v_max_wb IS NULL OR v_max_lb IS NOT NULL) THEN
          v_n := least(nullif(v_b->>'lb_until', '')::int, coalesce(v_max_lb, 999));
          v_parts := array_append(v_parts,
            CASE WHEN v_max_lb IS NOT NULL AND v_n = v_max_lb THEN '敗者側決勝まで'
                 ELSE '敗者側' || v_n || '回戦まで' END);
        END IF;
        IF coalesce((v_b->>'gf')::boolean, false) THEN
          v_parts := array_append(v_parts, 'グランドファイナル');
        END IF;

        v_label := 'DAY ' || (v_i + 1);
        v_body := '🏁 「' || t.title || '」' || v_label || ' がまもなく開始します ('
          || to_char(v_start AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || '〜'
          || CASE WHEN array_length(v_parts, 1) > 0 THEN ' / 対象: ' || array_to_string(v_parts, '・') ELSE '' END
          || ')';

        IF v_user_ids IS NULL THEN
          SELECT coalesce(array_agg(DISTINCT u), ARRAY[]::uuid[]) || t.host_user_id INTO v_user_ids
          FROM tournament_entries e, unnest(_tournament_entry_user_ids(e.id)) AS u
          WHERE e.tournament_id = t.id AND coalesce(e.status, '') <> 'excluded';
        END IF;

        BEGIN
          INSERT INTO notifications (user_id, type, body, link, is_read)
          SELECT DISTINCT u, 'tournament_start', v_body, v_link, false
          FROM unnest(v_user_ids) AS u WHERE u IS NOT NULL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        BEGIN
          SELECT string_agg('<@' || x.provider_id || '>', ' '), jsonb_agg(x.provider_id)
          INTO v_mention_text, v_mention_ids
          FROM (
            SELECT DISTINCT i.provider_id
            FROM auth.identities i
            WHERE i.provider = 'discord' AND i.user_id = ANY(v_user_ids) AND i.provider_id ~ '^\d+$'
            LIMIT 80
          ) x;
          PERFORM _tournament_webhook_post(jsonb_build_object(
            'content', coalesce(v_mention_text, ''),
            'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(v_mention_ids, '[]'::jsonb)),
            'embeds', jsonb_build_array(jsonb_build_object(
              'title', '🏁 ' || t.title || ' — ' || v_label || ' まもなく開始',
              'description', to_char(v_start AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || ' 開始'
                || CASE WHEN array_length(v_parts, 1) > 0 THEN E'\n対象: ' || array_to_string(v_parts, '・') ELSE '' END,
              'url', 'https://ascent-esports.com' || v_link,
              'color', 16753920,
              'footer', jsonb_build_object('text', 'ASCENT · Tournament')
            ))
          ), 'discord_tournament_match_webhook');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        v_notified := v_notified || to_jsonb(v_i);
        UPDATE tournaments
        SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{notified_blocks}', v_notified), updated_at = now()
        WHERE id = t.id;
      END LOOP;

    ELSIF t.event_start IS NOT NULL
      AND coalesce(t.metadata->>'event_start_notified', '') <> 'true'
      AND now() >= t.event_start - interval '10 minutes'
      AND now() < t.event_start + interval '30 minutes' THEN
      -- ── スケジュール未設定: event_start で1回通知 ──
      v_body := '🏁 「' || t.title || '」がまもなく開始します ('
        || to_char(t.event_start AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || '〜)';

      SELECT coalesce(array_agg(DISTINCT u), ARRAY[]::uuid[]) || t.host_user_id INTO v_user_ids
      FROM tournament_entries e, unnest(_tournament_entry_user_ids(e.id)) AS u
      WHERE e.tournament_id = t.id AND coalesce(e.status, '') <> 'excluded';

      BEGIN
        INSERT INTO notifications (user_id, type, body, link, is_read)
        SELECT DISTINCT u, 'tournament_start', v_body, v_link, false
        FROM unnest(v_user_ids) AS u WHERE u IS NOT NULL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;

      BEGIN
        SELECT string_agg('<@' || x.provider_id || '>', ' '), jsonb_agg(x.provider_id)
        INTO v_mention_text, v_mention_ids
        FROM (
          SELECT DISTINCT i.provider_id
          FROM auth.identities i
          WHERE i.provider = 'discord' AND i.user_id = ANY(v_user_ids) AND i.provider_id ~ '^\d+$'
          LIMIT 80
        ) x;
        PERFORM _tournament_webhook_post(jsonb_build_object(
          'content', coalesce(v_mention_text, ''),
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(v_mention_ids, '[]'::jsonb)),
          'embeds', jsonb_build_array(jsonb_build_object(
            'title', '🏁 ' || t.title || ' — まもなく開始',
            'description', to_char(t.event_start AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI') || ' 開始',
            'url', 'https://ascent-esports.com' || v_link,
            'color', 16753920,
            'footer', jsonb_build_object('text', 'ASCENT · Tournament')
          ))
        ), 'discord_tournament_match_webhook');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;

      UPDATE tournaments
      SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{event_start_notified}', 'true'::jsonb), updated_at = now()
      WHERE id = t.id;
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tournament-schedule-notify') THEN
    PERFORM cron.unschedule('tournament-schedule-notify');
  END IF;
  PERFORM cron.schedule('tournament-schedule-notify', '*/5 * * * *', 'select public.fn_tournament_schedule_notify()');
END;
$$;

-- ------------------------------------------------------------
-- 4) 結果発表: 3位記録 + 入賞者通知 + Discord結果発表
--    (tournament_achievements.sql の完了トリガーを上書き)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_record_tournament_achievements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_champion uuid;
  v_runner uuid;
  v_thirds uuid[];
  v_max_w int;
  v_label text;
  v_label_1 text;
  v_label_2 text;
  v_labels_3 text[];
  v_third uuid;
  v_all_users uuid[];
  v_mention_text text;
  v_mention_ids jsonb;
  v_desc text;
BEGIN
  -- completed への遷移時のみ (winner_info.name 補完の再UPDATEでは再発火しない)
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  v_champion := (NEW.winner_info->>'entry_id')::uuid;
  IF v_champion IS NULL THEN RETURN NEW; END IF;

  BEGIN
    -- 準優勝: 優勝エントリーが最後に勝った試合の敗者
    SELECT loser_entry_id INTO v_runner
    FROM tournament_matches
    WHERE tournament_id = NEW.id AND winner_entry_id = v_champion AND status = 'completed'
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1;

    -- ブラケット試合が無い場合 (リーグ戦のみ) は league_standings の2位
    IF v_runner IS NULL THEN
      SELECT entry_id INTO v_runner
      FROM league_standings
      WHERE tournament_id = NEW.id AND entry_id <> v_champion
      ORDER BY points DESC, (rounds_won - rounds_lost) DESC
      LIMIT 1;
    END IF;

    -- 3位: ダブルエリミ = 敗者側決勝の敗者 / シングルエリミ = 準決勝敗者2組 /
    --       リーグのみ = 順位表3位
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = NEW.id AND bracket_side = 'losers') THEN
      SELECT ARRAY[loser_entry_id] INTO v_thirds
      FROM tournament_matches
      WHERE tournament_id = NEW.id AND bracket_side = 'losers'
        AND status = 'completed' AND loser_entry_id IS NOT NULL
      ORDER BY round DESC, completed_at DESC NULLS LAST
      LIMIT 1;
    ELSIF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = NEW.id AND bracket_side = 'winners') THEN
      SELECT max(round) INTO v_max_w FROM tournament_matches
      WHERE tournament_id = NEW.id AND bracket_side = 'winners';
      IF v_max_w >= 2 THEN
        SELECT array_agg(loser_entry_id) INTO v_thirds
        FROM tournament_matches
        WHERE tournament_id = NEW.id AND bracket_side = 'winners'
          AND round = v_max_w - 1 AND status = 'completed' AND loser_entry_id IS NOT NULL;
      END IF;
    ELSE
      SELECT ARRAY[entry_id] INTO v_thirds
      FROM league_standings
      WHERE tournament_id = NEW.id AND entry_id <> v_champion AND entry_id <> v_runner
      ORDER BY points DESC, (rounds_won - rounds_lost) DESC
      LIMIT 1;
    END IF;

    -- 実績記録
    PERFORM _tournament_record_achievement(NEW.id, v_champion, 1);
    IF v_runner IS NOT NULL AND v_runner <> v_champion THEN
      PERFORM _tournament_record_achievement(NEW.id, v_runner, 2);
    END IF;
    IF v_thirds IS NOT NULL THEN
      FOREACH v_third IN ARRAY v_thirds LOOP
        IF v_third IS NOT NULL AND v_third <> v_champion AND v_third <> coalesce(v_runner, '00000000-0000-0000-0000-000000000000'::uuid) THEN
          PERFORM _tournament_record_achievement(NEW.id, v_third, 3);
        END IF;
      END LOOP;
    END IF;

    -- 大会一覧の CHAMPION バッジ用に優勝者名を補完
    IF NEW.winner_info->>'name' IS NULL THEN
      v_label := _tournament_entry_label(v_champion);
      UPDATE tournaments SET winner_info = NEW.winner_info || jsonb_build_object('name', v_label)
      WHERE id = NEW.id;
    END IF;

    -- ── 入賞者へサイト内通知 ──
    v_label_1 := _tournament_entry_label(v_champion);
    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT DISTINCT u, 'tournament_result',
           '🏆 「' || NEW.title || '」で優勝しました！おめでとうございます！',
           '/tournaments/' || NEW.id || '/results', false
    FROM unnest(_tournament_entry_user_ids(v_champion)) AS u WHERE u IS NOT NULL;

    IF v_runner IS NOT NULL AND v_runner <> v_champion THEN
      v_label_2 := _tournament_entry_label(v_runner);
      INSERT INTO notifications (user_id, type, body, link, is_read)
      SELECT DISTINCT u, 'tournament_result',
             '🥈 「' || NEW.title || '」準優勝！お疲れさまでした！',
             '/tournaments/' || NEW.id || '/results', false
      FROM unnest(_tournament_entry_user_ids(v_runner)) AS u WHERE u IS NOT NULL;
    END IF;

    v_labels_3 := ARRAY[]::text[];
    IF v_thirds IS NOT NULL THEN
      FOREACH v_third IN ARRAY v_thirds LOOP
        IF v_third IS NOT NULL AND v_third <> v_champion AND v_third <> coalesce(v_runner, '00000000-0000-0000-0000-000000000000'::uuid) THEN
          v_labels_3 := array_append(v_labels_3, _tournament_entry_label(v_third));
          INSERT INTO notifications (user_id, type, body, link, is_read)
          SELECT DISTINCT u, 'tournament_result',
                 '🥉 「' || NEW.title || '」3位入賞！お疲れさまでした！',
                 '/tournaments/' || NEW.id || '/results', false
          FROM unnest(_tournament_entry_user_ids(v_third)) AS u WHERE u IS NOT NULL;
        END IF;
      END LOOP;
    END IF;

    -- ── Discord 結果発表 (入賞者メンション付き) ──
    SELECT coalesce(array_agg(DISTINCT u), ARRAY[]::uuid[]) INTO v_all_users
    FROM (
      SELECT unnest(_tournament_entry_user_ids(v_champion)) AS u
      UNION ALL
      SELECT unnest(_tournament_entry_user_ids(v_runner)) WHERE v_runner IS NOT NULL
      UNION ALL
      SELECT unnest(_tournament_entry_user_ids(t3)) FROM unnest(coalesce(v_thirds, ARRAY[]::uuid[])) AS t3
    ) s WHERE u IS NOT NULL;

    SELECT string_agg('<@' || x.provider_id || '>', ' '), jsonb_agg(x.provider_id)
    INTO v_mention_text, v_mention_ids
    FROM (
      SELECT DISTINCT i.provider_id
      FROM auth.identities i
      WHERE i.provider = 'discord' AND i.user_id = ANY(v_all_users) AND i.provider_id ~ '^\d+$'
      LIMIT 80
    ) x;

    v_desc := '🏆 優勝: ' || v_label_1;
    IF v_label_2 IS NOT NULL THEN v_desc := v_desc || E'\n🥈 準優勝: ' || v_label_2; END IF;
    IF array_length(v_labels_3, 1) > 0 THEN v_desc := v_desc || E'\n🥉 3位: ' || array_to_string(v_labels_3, ' / '); END IF;

    PERFORM _tournament_webhook_post(jsonb_build_object(
      'content', coalesce(v_mention_text, ''),
      'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(v_mention_ids, '[]'::jsonb)),
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '🏆 大会結果: ' || NEW.title,
        'description', v_desc,
        'url', 'https://ascent-esports.com/tournaments/' || NEW.id || '/results',
        'color', 16766720,
        'footer', jsonb_build_object('text', 'ASCENT · Tournament'),
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ))
    ), 'discord_tournament_webhook');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- 実績記録・通知の失敗で大会完了を妨げない
  END;

  RETURN NEW;
END;
$$;
