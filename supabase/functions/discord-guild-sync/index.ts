// ============================================================
// discord-guild-sync — Discord公式サーバーの所属照合 (毎朝5:00 JSTにcronから実行)
//
// 全ユーザーのDiscord ID (users.discord_user_id) をBot APIで照合し、
// users.in_guild / guild_checked_at を更新する。離脱を検知したユーザーには
// サイト内通知 (招待リンク付き) を送る。再通知は7日間隔。
//
// 認証: x-internal-secret ヘッダ (EDGE_INTERNAL_SECRET)。
// ⚠️ 必ず verify_jwt=false でデプロイすること (DBのnet.http_postはJWTを持たない)
// 必要な secrets: EDGE_INTERNAL_SECRET, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type UserRow = {
  auth_user_id: string
  discord_user_id: string
  in_guild: boolean | null
  guild_left_notified_at: string | null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const secret = Deno.env.get('EDGE_INTERNAL_SECRET')
  if (!secret || req.headers.get('x-internal-secret') !== secret) {
    return json(401, { error: 'unauthorized' })
  }
  const token = Deno.env.get('DISCORD_BOT_TOKEN')
  const guildId = Deno.env.get('DISCORD_GUILD_ID')
  if (!token || !guildId) return json(500, { error: 'DISCORD_BOT_TOKEN / DISCORD_GUILD_ID が未設定です' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: rows, error } = await admin
    .from('users')
    .select('auth_user_id, discord_user_id, in_guild, guild_left_notified_at')
    .not('discord_user_id', 'is', null)
    .not('auth_user_id', 'is', null)
  if (error) return json(500, { error: error.message })

  const { data: inviteRow } = await admin
    .from('app_settings').select('value').eq('key', 'discord_server_invite').maybeSingle()
  const invite = (inviteRow as { value: string } | null)?.value ?? null

  let members = 0
  let left = 0
  let notified = 0
  let errors = 0

  for (const r of (rows ?? []) as UserRow[]) {
    if (!/^\d+$/.test(r.discord_user_id)) continue
    try {
      let res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${r.discord_user_id}`, {
        headers: { Authorization: `Bot ${token}` },
      })
      if (res.status === 429) {
        const retryAfter = Number((await res.json().catch(() => null))?.retry_after ?? 1)
        await sleep(Math.min(retryAfter, 5) * 1000)
        res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${r.discord_user_id}`, {
          headers: { Authorization: `Bot ${token}` },
        })
      }
      let isMember: boolean
      if (res.ok) isMember = true
      else if (res.status === 404) isMember = false
      else { errors++; continue } // 一時エラーはこのユーザーをスキップ (前回の状態を保持)

      await admin.from('users')
        .update({ in_guild: isMember, guild_checked_at: new Date().toISOString() })
        .eq('auth_user_id', r.auth_user_id)

      if (isMember) {
        members++
      } else {
        left++
        // 離脱の初検知、または前回通知から7日以上経過していれば再通知
        const lastNotified = r.guild_left_notified_at ? Date.parse(r.guild_left_notified_at) : 0
        const firstDetection = r.in_guild !== false
        if (firstDetection || Date.now() - lastNotified > 7 * 24 * 3600 * 1000) {
          await admin.from('notifications').insert({
            user_id: r.auth_user_id,
            type: 'discord_guild',
            body: 'ASCENT公式Discordサーバーから退出した状態になっています。試合の連絡や通知が届かなくなるため、再参加をお願いします。',
            link: invite,
            is_read: false,
          })
          await admin.from('users')
            .update({ guild_left_notified_at: new Date().toISOString() })
            .eq('auth_user_id', r.auth_user_id)
          notified++
        }
      }
      await sleep(50) // レート制限対策 (~20req/s)
    } catch (e) {
      console.error('guild check error', r.discord_user_id, e)
      errors++
    }
  }

  console.log(`guild sync done: members=${members} left=${left} notified=${notified} errors=${errors}`)
  return json(200, { ok: true, members, left, notified, errors })
})
