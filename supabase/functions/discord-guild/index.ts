// ============================================================
// discord-guild — 専用Discordサーバー参加の強制
//
// ログインユーザーがASCENTのDiscordサーバーに参加しているかを
// Bot経由で確認し、未参加なら OAuth の guilds.join スコープで
// 取得した provider_token を使って自動参加させる。
//
// レスポンス:
//   { member: true }  — 参加済み (joined: true なら今回自動参加した)
//   { member: false } — 未参加で自動参加もできなかった → ゲートでブロック
//   { member: null }  — 判定不能 (Bot未設定/Discord障害) → フェイルオープン
// いずれも invite_url (招待リンク) を同梱。
//
// 必要な secrets:
//   DISCORD_BOT_TOKEN  — サーバーに参加済みで Create Invite 権限を持つBot
//   DISCORD_GUILD_ID   — 対象サーバーのID
//   DISCORD_INVITE_URL — ゲート画面に表示する永続招待リンク
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

  const inviteUrl = Deno.env.get('DISCORD_INVITE_URL') ?? null

  try {
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
    const guildId = Deno.env.get('DISCORD_GUILD_ID')
    // Bot未設定の間はフェイルオープン (サイトをロックしない)
    if (!botToken || !guildId) return json(200, { member: null, invite_url: inviteUrl })

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json(401, { error: 'not authenticated' })

    const identity = user.identities?.find((i) => i.provider === 'discord')
    const identityData = identity?.identity_data as Record<string, unknown> | undefined
    const discordId = String(identityData?.provider_id ?? identityData?.sub ?? identity?.id ?? '')
    if (!/^\d+$/.test(discordId)) return json(200, { member: null, invite_url: inviteUrl })

    const body = await req.json().catch(() => null) as { provider_token?: string | null } | null
    const providerToken = typeof body?.provider_token === 'string' ? body.provider_token : null

    const memberUrl = `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`

    // 1) 参加チェック
    const check = await fetch(memberUrl, { headers: { Authorization: `Bot ${botToken}` } })
    if (check.status === 200) return json(200, { member: true, invite_url: inviteUrl })
    if (check.status !== 404) {
      // Botの権限不足やDiscord障害 → フェイルオープン
      console.error('guild member check failed', check.status)
      return json(200, { member: null, invite_url: inviteUrl })
    }

    // 2) 未参加 → guilds.join スコープのトークンがあれば自動参加
    if (providerToken) {
      const joinRes = await fetch(memberUrl, {
        method: 'PUT',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: providerToken }),
      })
      // 201 = 参加させた / 204 = 既に参加済み
      if (joinRes.status === 201 || joinRes.status === 204) {
        return json(200, { member: true, joined: true, invite_url: inviteUrl })
      }
      console.error('guild auto-join failed', joinRes.status, await joinRes.text().catch(() => ''))
    }

    return json(200, { member: false, invite_url: inviteUrl })
  } catch (e) {
    console.error('discord-guild error', e)
    return json(200, { member: null, invite_url: inviteUrl })
  }
})
