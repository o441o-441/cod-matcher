-- ============================================================
-- 交流戦の開始5分前リマインド
--   - scrim_matches.reminded_at で二重送信防止
--   - pg_cron 毎分: 開始時刻(JST 20:00 + slot*30分)の5分前に入ったら
--     _scrimboard_notify(id, 'reminder') を呼ぶ
--   - reminder イベント: チーム側Webhook(個人メンション) + 全メンバーへサイト内通知
-- ※ _scrimboard_notify の最新定義はこのファイル (scrim_mixed_rooms.sql の定義に
--    reminder イベントを追加したもの)
-- ============================================================

ALTER TABLE public.scrim_matches ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- _scrimboard_notify に 'reminder' イベントを追加
CREATE OR REPLACE FUNCTION public._scrimboard_notify(p_match_id uuid, p_event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_m record;
  v_host_name text;
  v_guest_name text;
  v_host_wh text;
  v_guest_wh text;
  v_host_contact text;
  v_guest_contact text;
  v_host_mentions text[];
  v_guest_mentions text[];
  v_label text;
  v_when text;
  v_page text;
  v_content_host text;
  v_content_guest text;
  v_site_body text;
begin
  select * into v_m from scrim_matches where id = p_match_id;
  if v_m is null then return; end if;

  v_host_name := _scrimboard_side_name(v_m.host_team_id, v_m.host_room_id);
  v_guest_name := _scrimboard_side_name(v_m.guest_team_id, v_m.guest_room_id);
  if v_m.host_team_id is not null then
    select discord_webhook_url into v_host_wh from team_settings where team_id = v_m.host_team_id;
    select public_contact into v_host_contact from scrim_team_prefs where team_id = v_m.host_team_id;
    select array_agg(i.provider_id) into v_host_mentions
    from team_members tm
    join auth.identities i on i.user_id = tm.user_id and i.provider = 'discord'
    where tm.team_id = v_m.host_team_id and i.provider_id ~ '^\d+$';
  end if;
  if v_m.guest_team_id is not null then
    select discord_webhook_url into v_guest_wh from team_settings where team_id = v_m.guest_team_id;
    select public_contact into v_guest_contact from scrim_team_prefs where team_id = v_m.guest_team_id;
    select array_agg(i.provider_id) into v_guest_mentions
    from team_members tm
    join auth.identities i on i.user_id = tm.user_id and i.provider = 'discord'
    where tm.team_id = v_m.guest_team_id and i.provider_id ~ '^\d+$';
  end if;

  v_label := _scrimboard_format_label(v_m.hp_maps, v_m.snd_maps, v_m.ovl_maps);
  v_when := to_char(v_m.date, 'MM/DD') || ' ' || _scrimboard_slot_label(v_m.slot_start)
    || ' – ' || _scrimboard_slot_label(v_m.slot_end);
  v_page := 'https://ascent-esports.com/custom/board/' || v_m.id;

  if p_event = 'confirmed' then
    v_content_host := '⚔️ **交流戦が成立しました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ホスト決め・ロビーコード共有は試合ページで: ' || v_page
      || case when v_guest_contact is not null then E'\n' || '相手チームの連絡先: ' || v_guest_contact else '' end;
    v_content_guest := '⚔️ **交流戦が成立しました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ホスト決め・ロビーコード共有は試合ページで: ' || v_page
      || case when v_host_contact is not null then E'\n' || '相手チームの連絡先: ' || v_host_contact else '' end;
    v_site_body := '⚔️ 交流戦が成立しました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || ' · ' || v_label || '）';
  elsif p_event = 'reminder' then
    v_content_host := '⏰ **交流戦 まもなく開始です (5分前)**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ロビーコードの確認・共有は試合ページで: ' || v_page;
    v_content_guest := v_content_host;
    v_site_body := '⏰ まもなく交流戦が始まります（5分前）: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || '）';
  else
    v_content_host := '⚠️ **交流戦がキャンセルされました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || '枠はボードに戻りました: https://ascent-esports.com/custom/board';
    v_content_guest := v_content_host;
    v_site_body := '⚠️ 交流戦がキャンセルされました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || '）';
  end if;

  -- チーム側: Webhook (自チームのメンバー全員をメンション)
  if v_host_wh is not null and v_host_wh like 'https://discord.com/api/webhooks/%' then
    begin
      perform net.http_post(
        url := v_host_wh,
        body := jsonb_build_object(
          'username', 'ASCENT 交流戦ボード',
          'content',
            coalesce((select string_agg('<@' || x || '>', ' ') from unnest(v_host_mentions) as x) || E'\n', '')
            || v_content_host,
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_host_mentions), '[]'::jsonb))
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end if;
  if v_guest_wh is not null and v_guest_wh like 'https://discord.com/api/webhooks/%' then
    begin
      perform net.http_post(
        url := v_guest_wh,
        body := jsonb_build_object(
          'username', 'ASCENT 交流戦ボード',
          'content',
            coalesce((select string_agg('<@' || x || '>', ' ') from unnest(v_guest_mentions) as x) || E'\n', '')
            || v_content_guest,
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_guest_mentions), '[]'::jsonb))
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end if;

  -- ルーム側: メンバーへサイト内通知
  begin
    insert into notifications (user_id, type, body, link, is_read)
    select rm.user_id, 'scrim_match', v_site_body, '/custom/board/' || v_m.id, false
    from scrim_mixed_room_members rm
    where rm.room_id in (v_m.host_room_id, v_m.guest_room_id);
  exception when others then null;
  end;

  -- リマインドは時間が重要なのでチームメンバーにもサイト内通知を出す
  if p_event = 'reminder' then
    begin
      insert into notifications (user_id, type, body, link, is_read)
      select tm.user_id, 'scrim_match', v_site_body, '/custom/board/' || v_m.id, false
      from team_members tm
      where tm.team_id in (v_m.host_team_id, v_m.guest_team_id);
    exception when others then null;
    end;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 開始5分前チェック (pg_cron 毎分)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_scrim_match_reminder()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_m record;
BEGIN
  FOR v_m IN
    SELECT id FROM scrim_matches
    WHERE status = 'confirmed'
      AND reminded_at IS NULL
      AND ((date::text || ' 20:00')::timestamp + (slot_start * interval '30 minutes')) AT TIME ZONE 'Asia/Tokyo'
          BETWEEN now() AND now() + interval '5 minutes'
  LOOP
    UPDATE scrim_matches SET reminded_at = now() WHERE id = v_m.id AND reminded_at IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    BEGIN
      PERFORM _scrimboard_notify(v_m.id, 'reminder');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scrim-match-reminder') THEN
    PERFORM cron.unschedule('scrim-match-reminder');
  END IF;
  PERFORM cron.schedule('scrim-match-reminder', '* * * * *', 'select public.fn_scrim_match_reminder()');
END $$;
