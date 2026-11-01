-- ============================================================
-- 交流戦キャンセルの理由選択 (2026-11-01)
--
-- キャンセル時に理由の選択を必須にする:
--   skill_gap = 実力差が大きいため / schedule = スケジュール変更のため
--   conduct   = 相手の素行に問題があるため (通報) / other = その他
--
-- - scrim_matches.cancel_reason / cancel_note (その他の補足、最大200字)
-- - rpc_scrimboard_cancel は理由必須に (旧1引数シグネチャは削除)
-- - キャンセル通知に理由を記載。ただし conduct は相手側にも同文が
--   届くため通知には載せない (記録のみ。フロントが通報ページへ誘導)
--
-- 本ファイルは以下を上書きする:
--   - rpc_scrimboard_cancel (旧: scrim_mixed_rooms.sql)
--   - _scrimboard_notify    (旧: scrim_match_reminder.sql)
-- ============================================================

ALTER TABLE public.scrim_matches
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancel_note text;

-- ------------------------------------------------------------
-- 1) キャンセル v3 (理由必須)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_scrimboard_cancel(uuid);

CREATE OR REPLACE FUNCTION public.rpc_scrimboard_cancel(p_match_id uuid, p_reason text, p_note text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_m record;
begin
  if v_uid is null then raise exception 'ログインが必要です'; end if;
  if p_reason is null or p_reason not in ('skill_gap', 'schedule', 'conduct', 'other') then
    raise exception 'キャンセル理由を選択してください';
  end if;

  select * into v_m from scrim_matches where id = p_match_id;
  if v_m is null then raise exception '対戦が見つかりません'; end if;
  if v_m.status <> 'confirmed' then raise exception 'この対戦はすでにキャンセル済みか終了しています'; end if;

  if not exists (
    select 1 from team_members tm
    where tm.user_id = v_uid and tm.team_id in (v_m.host_team_id, v_m.guest_team_id)
  ) and not exists (
    select 1 from scrim_mixed_room_members rm
    where rm.user_id = v_uid and rm.room_id in (v_m.host_room_id, v_m.guest_room_id)
  ) then
    raise exception 'この対戦の参加メンバーのみキャンセルできます';
  end if;

  update scrim_matches
  set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
      cancel_reason = p_reason,
      cancel_note = nullif(left(trim(coalesce(p_note, '')), 200), '')
  where id = p_match_id;

  -- ルームは募集中に戻す
  if v_m.host_room_id is not null then
    update scrim_mixed_rooms set status = 'open' where id = v_m.host_room_id and status = 'matched';
  end if;
  if v_m.guest_room_id is not null then
    update scrim_mixed_rooms set status = 'open' where id = v_m.guest_room_id and status = 'matched';
  end if;

  begin
    perform _scrimboard_notify(p_match_id, 'cancelled');
  exception when others then null;
  end;

  return json_build_object('ok', true);
end;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_scrimboard_cancel(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 2) 通知 v3: キャンセル通知に理由を記載 (conduct は除く)
-- ------------------------------------------------------------
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
  v_reason text;
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
    v_site_body := '⚠️ 交流戦がキャンセルされました: ' || v_host_name || ' vs ' || v_guest_name || '（' || v_when || '）'
      || case when v_reason is not null then ' 理由: ' || v_reason else '' end;
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
