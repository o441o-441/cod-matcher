-- ============================================================
-- 交流戦通知の公式Discordフォールバック (2026-11-13)
--
-- チームの Webhook (team_settings.discord_webhook_url) が未設定
-- または不正な形式のチームには、公式Discordサーバーの交流戦
-- チャンネル (app_settings key='discord_scrim_webhook') へ
-- メンバー全員をメンションして通知する。
--
-- - 両チームとも未設定なら1つの投稿にまとめる (メンションは合算)
-- - 公開チャンネルのため、相手の公開連絡先 (public_contact) は
--   公式チャンネルの投稿には載せない (試合ページへ誘導)
-- - reminder は開始後に価値が無いので _discord_post_tracked で
--   30分後に自動削除。confirmed / cancelled は恒久投稿
-- - 'discord_scrim_webhook' が未設定なら何もしない (段階導入可)
--
-- 本ファイルは以下を上書きする:
--   - _scrimboard_notify (旧: scrim_cancel_reason.sql)
-- ============================================================

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
  v_host_wh_ok boolean;
  v_guest_wh_ok boolean;
  v_host_contact text;
  v_guest_contact text;
  v_host_mentions text[];
  v_guest_mentions text[];
  v_label text;
  v_when text;
  v_page text;
  v_content_host text;
  v_content_guest text;
  v_content_official text;
  v_site_body text;
  v_reason text;
  v_fb_mentions text[] := '{}';
  v_fb boolean := false;
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

  v_host_wh_ok := v_host_wh is not null and v_host_wh like 'https://discord.com/api/webhooks/%';
  v_guest_wh_ok := v_guest_wh is not null and v_guest_wh like 'https://discord.com/api/webhooks/%';

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
    -- 公式チャンネル版: 連絡先は載せない (公開チャンネルのため)
    v_content_official := '⚔️ **交流戦が成立しました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ホスト決め・ロビーコード共有は試合ページで: ' || v_page || E'\n'
      || '-# チーム設定でWebhookを登録すると自チームのサーバーで通知を受け取れます';
    v_site_body := '⚔️ 交流戦が成立しました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || ' · ' || v_label || '）';
  elsif p_event = 'reminder' then
    v_content_host := '⏰ **交流戦 まもなく開始です (5分前)**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || 'ロビーコードの確認・共有は試合ページで: ' || v_page;
    v_content_guest := v_content_host;
    v_content_official := v_content_host;
    v_site_body := '⏰ まもなく交流戦が始まります（5分前）: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || '）';
  else
    -- キャンセル理由 (conduct は双方に同文が届くため通知には載せない)
    v_reason := case v_m.cancel_reason
      when 'skill_gap' then '実力差が大きいため'
      when 'schedule' then 'スケジュール変更のため'
      when 'other' then 'その他' || case when v_m.cancel_note is not null then ' (' || v_m.cancel_note || ')' else '' end
      else null end;
    v_content_host := '⚠️ **交流戦がキャンセルされました**' || E'\n'
      || v_host_name || ' vs ' || v_guest_name || E'\n'
      || v_when || ' · ' || v_label || E'\n'
      || case when v_reason is not null then '理由: ' || v_reason || E'\n' else '' end
      || '枠はボードに戻りました: https://ascent-esports.com/custom/board';
    v_content_guest := v_content_host;
    v_content_official := v_content_host;
    v_site_body := '⚠️ 交流戦がキャンセルされました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || '）'
      || case when v_reason is not null then ' 理由: ' || v_reason else '' end;
  end if;

  -- チーム側: Webhook (自チームのメンバー全員をメンション)
  if v_host_wh_ok then
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
  if v_guest_wh_ok then
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

  -- Webhook 未設定のチームには公式Discordの交流戦チャンネルで通知
  -- (両チーム未設定なら1投稿にまとめる。キー未設定なら _discord_post_tracked が無視)
  if v_m.host_team_id is not null and not v_host_wh_ok then
    v_fb := true;
    v_fb_mentions := v_fb_mentions || coalesce(v_host_mentions, '{}');
  end if;
  if v_m.guest_team_id is not null and not v_guest_wh_ok then
    v_fb := true;
    v_fb_mentions := v_fb_mentions || coalesce(v_guest_mentions, '{}');
  end if;
  if v_fb then
    begin
      perform _discord_post_tracked(
        'discord_scrim_webhook',
        jsonb_build_object(
          'username', 'ASCENT 交流戦ボード',
          'content',
            coalesce((select string_agg('<@' || x || '>', ' ') from unnest(v_fb_mentions) as x) || E'\n', '')
            || v_content_official,
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array(), 'users', coalesce(to_jsonb(v_fb_mentions), '[]'::jsonb))
        ),
        case when p_event = 'reminder' then 30 else null end
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
