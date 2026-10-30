-- ============================================================
-- Discord公式サーバーの所属照合 (2026-10-30、本番適用済み)
--
-- 仕組み:
--   - users.in_guild / guild_checked_at / guild_left_notified_at を追加
--   - 毎朝5:00 JST (cron: discord-guild-sync) に fn_discord_guild_sync_tick が
--     Edge Function `discord-guild-sync` を呼び、全ユーザーのDiscord IDを
--     Bot APIで照合。離脱者にはサイト内通知 (招待リンク付き、7日間隔) を送る
--   - app_settings.discord_guild_enforce:
--       'soft'   = 通知のみ (現在)
--       'strict' = 非参加メンバーを含むパーティはキュー不可
--     切替: update app_settings set value='strict' where key='discord_guild_enforce';
--   - strictのガードは rpc_queue_existing_party 内 (in_guild=false のみブロック。
--     NULL=未照合は通す)
--
-- Edge Function側: supabase/functions/discord-guild-sync/index.ts
--   (verify_jwt=false 必須 / EDGE_INTERNAL_SECRET, DISCORD_BOT_TOKEN,
--    DISCORD_GUILD_ID を使用)
-- ============================================================

alter table public.users add column if not exists in_guild boolean;
alter table public.users add column if not exists guild_checked_at timestamptz;
alter table public.users add column if not exists guild_left_notified_at timestamptz;

insert into public.app_settings (key, value) values
  ('discord_guild_enforce', 'soft'),
  ('discord_guild_sync_url', 'https://pudejxolslrlxnmmmsps.supabase.co/functions/v1/discord-guild-sync')
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.fn_discord_guild_sync_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_settings where key = 'discord_guild_sync_url';
  select value into v_secret from app_settings where key = 'edge_internal_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;
-- select cron.schedule('discord-guild-sync', '0 20 * * *', 'select public.fn_discord_guild_sync_tick()');

-- rpc_queue_existing_party への strict ガード追加分 (関数全体は本番が正):
--   if (select value from app_settings where key='discord_guild_enforce') = 'strict' then
--     select string_agg(coalesce(pr.display_name,'(名前未設定)'), '・') into v_not_in_guild
--     from party_members pm
--     join profiles pr on pr.id = pm.user_id
--     join users u on u.auth_user_id = pm.user_id
--     where pm.party_id = p_party_id and u.in_guild = false;
--     if v_not_in_guild is not null then
--       raise exception 'ASCENT公式Discordサーバーに参加していないメンバーがいます（%）。サーバーに再参加してからキューに入ってください', v_not_in_guild;
--     end if;
--   end if;
