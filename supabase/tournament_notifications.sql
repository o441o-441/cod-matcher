-- ============================================================
-- 大会通知: 公開 / エントリー締切リマインド / 対戦カード確定
--
-- (1) 大会公開 (tournaments INSERT, status='recruit')
--     → 全ユーザーへサイト内通知 + Discord Webhook
-- (2) エントリー締切リマインド (pg_cron 10分毎)
--     → 24時間前と2時間前の2段階。Discord Webhook + 主催者へサイト内通知
-- (3) 対戦カード確定 (tournament_matches の両スロットが埋まった時)
--     → 両エントリーの全メンバーへサイト内通知
--     → 専用チャンネルへ参加メンバーの個人メンション付き Discord 通知
--
-- Discord Webhook URL は app_settings に保存:
--   discord_tournament_webhook       — 公開・締切リマインド用
--   discord_tournament_match_webhook — 対戦カード確定 (個人メンション) 用
-- 未設定なら Discord 通知のみスキップ (サイト内通知は動く)。
-- ============================================================

-- 締切リマインドの送信段階 (0=未送信 / 1=24h前送信済 / 2=2h前送信済)
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS deadline_reminder_stage integer NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 共有ヘルパー: 大会用 Discord Webhook へ送信 (ベストエフォート)
-- p_key で送信先 (app_settings のキー) を切り替えられる
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public._tournament_webhook_post(jsonb);
CREATE OR REPLACE FUNCTION public._tournament_webhook_post(p_payload jsonb, p_key text DEFAULT 'discord_tournament_webhook')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT value INTO v_url FROM app_settings WHERE key = p_key;
  IF v_url IS NOT NULL AND v_url LIKE 'https://discord.com/api/webhooks/%' THEN
    PERFORM net.http_post(url := v_url, body := p_payload);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ------------------------------------------------------------
-- 共有ヘルパー: エントリーの表示名
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_entry_label(p_entry_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_entry record;
  v_label text;
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF v_entry IS NULL THEN RETURN '不明'; END IF;
  IF v_entry.team_id IS NOT NULL THEN
    SELECT name INTO v_label FROM teams WHERE id = v_entry.team_id;
    RETURN coalesce(v_label, '不明');
  END IF;
  IF v_entry.assigned_team_name IS NOT NULL THEN
    RETURN v_entry.assigned_team_name;
  END IF;
  SELECT display_name INTO v_label FROM profiles WHERE id = v_entry.user_id;
  RETURN coalesce(v_label, '不明');
END;
$$;

-- ------------------------------------------------------------
-- 共有ヘルパー: エントリーに属する全ユーザーID
--   チームエントリー: member_snapshot の user_id (無ければ現メンバー)
--   個人エントリー: 自動編成チーム (assigned_team_index) の全員
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_entry_user_ids(p_entry_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_entry record;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF v_entry IS NULL THEN RETURN '{}'; END IF;

  IF v_entry.team_id IS NOT NULL THEN
    SELECT array_agg((m->>'user_id')::uuid) INTO v_ids
    FROM jsonb_array_elements(coalesce(v_entry.member_snapshot, '[]'::jsonb)) AS m
    WHERE m->>'user_id' IS NOT NULL;
    IF v_ids IS NULL THEN
      SELECT array_agg(user_id) INTO v_ids FROM team_members WHERE team_id = v_entry.team_id;
    END IF;
    RETURN coalesce(v_ids, '{}');
  END IF;

  IF v_entry.assigned_team_index IS NOT NULL THEN
    SELECT array_agg(user_id) INTO v_ids
    FROM tournament_entries
    WHERE tournament_id = v_entry.tournament_id
      AND assigned_team_index = v_entry.assigned_team_index
      AND user_id IS NOT NULL
      AND coalesce(status, '') <> 'excluded';
    RETURN coalesce(v_ids, '{}');
  END IF;

  IF v_entry.user_id IS NOT NULL THEN RETURN ARRAY[v_entry.user_id]; END IF;
  RETURN '{}';
END;
$$;

-- ------------------------------------------------------------
-- (1) 大会公開の通知
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_tournament_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deadline_label text;
BEGIN
  IF NEW.status <> 'recruit' THEN RETURN NEW; END IF;

  v_deadline_label := CASE WHEN NEW.entry_deadline IS NOT NULL
    THEN to_char(NEW.entry_deadline AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI')
    ELSE '未設定' END;

  -- サイト内通知: 全アクティブユーザー (主催者本人は除く)
  BEGIN
    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT p.id,
           'tournament_new',
           '🏆 新しい大会「' || NEW.title || '」が公開されました（エントリー締切: ' || v_deadline_label || '）',
           '/tournaments/' || NEW.id,
           false
    FROM profiles p
    WHERE p.id <> NEW.host_user_id
      AND NOT p.is_banned
      AND (p.suspended_until IS NULL OR p.suspended_until < now())
    LIMIT 1000;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Discord 通知
  PERFORM _tournament_webhook_post(jsonb_build_object(
    'content', '',
    'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()),
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', '🏆 大会公開: ' || NEW.title,
      'description', coalesce(nullif(trim(coalesce(NEW.description, '')), ''), 'エントリー受付中！'),
      'color', 16755200,
      'fields', jsonb_build_array(
        jsonb_build_object('name', '形式', 'value', coalesce(NEW.format, '-'), 'inline', true),
        jsonb_build_object('name', 'エントリー', 'value', coalesce(NEW.entry_mode, '-'), 'inline', true),
        jsonb_build_object('name', '締切', 'value', v_deadline_label, 'inline', true)
      ),
      'footer', jsonb_build_object('text', 'ASCENT · Tournament'),
      'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_tournament_published ON public.tournaments;
CREATE TRIGGER trg_notify_tournament_published
  AFTER INSERT ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_tournament_published();

-- ------------------------------------------------------------
-- (2) エントリー締切リマインド (pg_cron から10分毎に実行)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_deadline_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  v_entry_count integer;
  v_stage integer;
  v_label text;
  v_deadline_label text;
BEGIN
  FOR t IN
    SELECT * FROM tournaments
    WHERE status = 'recruit'
      AND entry_deadline IS NOT NULL
      AND entry_deadline > now()
      AND deadline_reminder_stage < 2
      AND (
        (deadline_reminder_stage < 1 AND entry_deadline <= now() + interval '24 hours')
        OR entry_deadline <= now() + interval '2 hours'
      )
  LOOP
    v_stage := CASE WHEN t.entry_deadline <= now() + interval '2 hours' THEN 2 ELSE 1 END;
    v_label := CASE WHEN v_stage = 2 THEN 'まもなく締切（2時間以内）' ELSE '締切まで24時間を切りました' END;
    v_deadline_label := to_char(t.entry_deadline AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI');
    SELECT count(*) INTO v_entry_count FROM tournament_entries
    WHERE tournament_id = t.id AND coalesce(status, '') <> 'excluded';

    -- Discord 通知
    PERFORM _tournament_webhook_post(jsonb_build_object(
      'content', '',
      'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()),
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '⏰ ' || v_label || ': ' || t.title,
        'description', 'エントリーがまだの方はお早めに！',
        'color', CASE WHEN v_stage = 2 THEN 16729156 ELSE 16755200 END,
        'fields', jsonb_build_array(
          jsonb_build_object('name', '締切', 'value', v_deadline_label, 'inline', true),
          jsonb_build_object('name', 'エントリー状況', 'value', v_entry_count || coalesce(' / ' || t.capacity, '') || ' 組', 'inline', true)
        ),
        'footer', jsonb_build_object('text', 'ASCENT · Tournament'),
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ))
    ));

    -- 主催者へサイト内通知 (エントリー状況の把握用)
    BEGIN
      INSERT INTO notifications (user_id, type, body, link, is_read)
      VALUES (
        t.host_user_id,
        'tournament_deadline',
        '⏰ 「' || t.title || '」' || v_label || '。現在のエントリー: ' || v_entry_count || ' 組',
        '/tournaments/' || t.id,
        false
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    UPDATE tournaments SET deadline_reminder_stage = v_stage, updated_at = now() WHERE id = t.id;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- (3) 対戦カード確定の通知 (両スロットが埋まった試合)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_tournament_match_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title text;
  v_label_a text;
  v_label_b text;
  v_link text;
  v_user_ids uuid[];
  v_mention_text text;
  v_mention_ids jsonb;
BEGIN
  -- 両スロットが「今回の変更で」揃った時のみ (bye/完了済みは除外)
  IF NEW.entry_a_id IS NULL OR NEW.entry_b_id IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.status, '') IN ('bye', 'completed', 'cancelled') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.entry_a_id IS NOT NULL AND OLD.entry_b_id IS NOT NULL THEN RETURN NEW; END IF;

  BEGIN
    SELECT title INTO v_title FROM tournaments WHERE id = NEW.tournament_id;
    v_label_a := _tournament_entry_label(NEW.entry_a_id);
    v_label_b := _tournament_entry_label(NEW.entry_b_id);
    v_link := '/tournaments/' || NEW.tournament_id || '/match/' || NEW.id;
    v_user_ids := _tournament_entry_user_ids(NEW.entry_a_id) || _tournament_entry_user_ids(NEW.entry_b_id);

    INSERT INTO notifications (user_id, type, body, link, is_read)
    SELECT u,
           'tournament_match',
           '⚔️ 「' || coalesce(v_title, '大会') || '」R' || NEW.round || ' の対戦カードが決まりました: ' || v_label_a || ' vs ' || v_label_b,
           v_link,
           false
    FROM unnest(v_user_ids) AS u
    WHERE u IS NOT NULL
      -- 同じ試合の通知を既に受けている人には再送しない (再トリガー対策)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = u AND n.type = 'tournament_match' AND n.link = v_link
      );

    -- Discord 通知 (参加メンバーへの個人メンション)
    SELECT string_agg('<@' || t.provider_id || '>', ' '), jsonb_agg(t.provider_id)
    INTO v_mention_text, v_mention_ids
    FROM (
      SELECT DISTINCT i.provider_id
      FROM auth.identities i
      WHERE i.provider = 'discord'
        AND i.user_id = ANY(v_user_ids)
        AND i.provider_id ~ '^\d+$'
      LIMIT 80
    ) t;

    PERFORM _tournament_webhook_post(jsonb_build_object(
      'content', coalesce(v_mention_text, ''),
      'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(v_mention_ids, '[]'::jsonb)),
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '⚔️ 対戦カード決定: ' || coalesce(v_title, '大会') || ' R' || NEW.round,
        'description', v_label_a || ' vs ' || v_label_b,
        'url', 'https://ascent-esports.com' || v_link,
        'color', 65535,
        'footer', jsonb_build_object('text', 'ASCENT · Tournament'),
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ))
    ), 'discord_tournament_match_webhook');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_tournament_match_ready ON public.tournament_matches;
CREATE TRIGGER trg_notify_tournament_match_ready
  AFTER INSERT OR UPDATE ON public.tournament_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_tournament_match_ready();

-- ------------------------------------------------------------
-- cron ジョブ登録 (10分毎)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tournament-deadline-reminders') THEN
    PERFORM cron.unschedule('tournament-deadline-reminders');
  END IF;
  PERFORM cron.schedule('tournament-deadline-reminders', '*/10 * * * *', 'select public.fn_tournament_deadline_reminders()');
END;
$$;
