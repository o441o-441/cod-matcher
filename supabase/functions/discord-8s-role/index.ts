// ============================================================
// discord-8s-role — 8s通知オプトインとDiscordロールの同期
//
// /custom の「8s開催の通知を受け取る」保存時にクライアントから
// 呼ばれ、ログインユーザーのDiscordアカウントに @8s募集 ロールを
// 付与 (enabled=true) / 剥奪 (enabled=false) する。
//
// 必要な secrets:
//   DISCORD_BOT_TOKEN — Manage Roles 権限を持つBotのトークン
//   DISCORD_GUILD_ID  — 対象サーバーのID
// ロールIDは app_settings (key='discord_8s_role_id') が単一の情報源。
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  try {
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
    const guildId = Deno.env.get('DISCORD_GUILD_ID')
    if (!botToken || !guildId) return json(500, { error: 'Discord bot が未設定です' })

    // 呼び出し元ユーザーをJWTで特定
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json(401, { error: 'not authenticated' })

    // Discord OAuthのidentityからDiscordユーザーIDを取得
    const identity = user.identities?.find((i) => i.provider === 'discord')
    const identityData = identity?.identity_data as Record<string, unknown> | undefined
    const discordId = String(identityData?.provider_id ?? identityData?.sub ?? identity?.id ?? '')
    if (!/^\d+$/.test(discordId)) return json(400, { error: 'DiscordユーザーIDが見つかりません' })

    const body = await req.json().catch(() => null) as { enabled?: unknown } | null
    if (!body || typeof body.enabled !== 'boolean') return json(400, { error: 'enabled (boolean) が必要です' })

    // ロールIDは app_settings から (service roleで読む)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'discord_8s_role_id').maybeSingle()
    const roleId = (setting as { value: string } | null)?.value
    if (!roleId || !/^\d+$/.test(roleId)) return json(500, { error: 'discord_8s_role_id が未設定です' })

    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
      {
        method: body.enabled ? 'PUT' : 'DELETE',
        headers: {
          Authorization: `Bot ${botToken}`,
          'X-Audit-Log-Reason': `ASCENT 8s notify opt-${body.enabled ? 'in' : 'out'}`,
        },
      },
    )

    if (res.status === 204) return json(200, { ok: true, action: body.enabled ? 'added' : 'removed' })
    // 404 = サーバー未参加 (Unknown Member)。エラーではなく状態として返す
    if (res.status === 404) return json(200, { ok: false, reason: 'not_in_guild' })
    const detail = await res.text().catch(() => '')
    console.error('discord api error', res.status, detail.slice(0, 300))
    return json(502, { error: `Discord API エラー (${res.status})` })
  } catch (e) {
    console.error('discord-8s-role error', e)
    return json(500, { error: 'internal error' })
  }
})
