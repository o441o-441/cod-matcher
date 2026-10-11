// ============================================================
// discord-interactions — Discordのボタン操作を受けるエンドポイント
//
// Discord Developer Portal の「Interactions Endpoint URL」に設定する。
// Discordからの全リクエストは Ed25519 署名で検証 (公開鍵: DISCORD_PUBLIC_KEY)。
//
// 対応している操作:
//   - PING (エンドポイント検証) → PONG
//   - 「参加する」ボタン (custom_id: eights_join:<lobby_id>)
//     → Discord ID から ASCENT アカウントを特定して 8s ロビーに参加。
//       結果は本人にだけ見えるエフェメラル返信。成功時は告知メッセージの
//       「参加状況」フィールドも更新する。
//   - 「ロール: AR/SMG/FLEX」ボタン (custom_id: eights_role:<lobby_id>:<ROLE>)
//     → ロビーメンバーの武器ロールを設定する。
//   - 「参加をやめる」ボタン (custom_id: eights_leave:<lobby_id>)
//     → 参加をキャンセル。ホストが抜けた場合はロビー終了として表示を更新。
//
// 必要な secrets:
//   DISCORD_PUBLIC_KEY — Discordアプリの Public Key (署名検証用)
//   DISCORD_BOT_TOKEN  — 告知メッセージの参加状況更新用
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY')
  if (!publicKey) return new Response('not configured', { status: 500 })

  const sig = req.headers.get('x-signature-ed25519')
  const ts = req.headers.get('x-signature-timestamp')
  const bodyText = await req.text()
  if (!sig || !ts) return new Response('unauthorized', { status: 401 })

  let valid = false
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
    valid = await crypto.subtle.verify('Ed25519', key, hexToBytes(sig), new TextEncoder().encode(ts + bodyText))
  } catch {
    valid = false
  }
  if (!valid) return new Response('invalid request signature', { status: 401 })

  const payload = JSON.parse(bodyText) as {
    type: number
    data?: { custom_id?: string }
    member?: { user?: { id?: string } }
    user?: { id?: string }
    message?: { id: string; embeds?: { fields?: { name: string; value: string }[] }[] }
    channel_id?: string
  }

  // PING → PONG (エンドポイント検証)
  if (payload.type === 1) return json({ type: 1 })

  const ephemeral = (content: string) => json({ type: 4, data: { content, flags: 64 } })

  // ボタン押下 (MESSAGE_COMPONENT)
  if (payload.type === 3 && String(payload.data?.custom_id ?? '').startsWith('eights_join:')) {
    const lobbyId = String(payload.data!.custom_id).split(':')[1]
    const discordId = payload.member?.user?.id ?? payload.user?.id
    if (!discordId || !/^[0-9a-f-]{36}$/i.test(lobbyId)) return ephemeral('リクエストを処理できませんでした')

    try {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error } = await admin.rpc('rpc_discord_eights_join', {
        p_discord_id: String(discordId),
        p_lobby_id: lobbyId,
      })
      if (error) {
        console.error('rpc_discord_eights_join error', error)
        return ephemeral('エラーが発生しました。サイトから参加してください → https://ascent-esports.com/custom')
      }
      const r = data as { ok: boolean; code?: string; message?: string; member_count?: number }
      if (!r.ok) {
        if (r.code === 'not_registered') {
          return ephemeral('ASCENT未登録のため参加できません。まずDiscordログインで登録してください → https://ascent-esports.com/login')
        }
        return ephemeral(`参加できませんでした: ${r.message ?? '不明なエラー'}`)
      }

      // 告知メッセージの「参加状況」を更新 (ベストエフォート)
      try {
        const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
        const msg = payload.message
        if (botToken && msg?.embeds?.length && payload.channel_id) {
          const embeds = msg.embeds
          for (const e of embeds) {
            for (const f of e.fields ?? []) {
              if (f.name === '参加状況') f.value = `${r.member_count} / 8`
            }
          }
          await fetch(`https://discord.com/api/v10/channels/${payload.channel_id}/messages/${msg.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds }),
          })
        }
      } catch { /* noop */ }

      // 参加直後にロールも選べるようにボタン付きで返信
      return json({
        type: 4,
        data: {
          content: `✅ 参加しました！現在 ${r.member_count}/8人\n武器ロールも選んでおきましょう（ロビー: https://ascent-esports.com/custom/eights/${lobbyId}）`,
          flags: 64,
          components: [{
            type: 1,
            components: [
              { type: 2, style: 2, label: 'AR', custom_id: `eights_role:${lobbyId}:AR` },
              { type: 2, style: 2, label: 'SMG', custom_id: `eights_role:${lobbyId}:SMG` },
              { type: 2, style: 2, label: 'FLEX', custom_id: `eights_role:${lobbyId}:FLEX` },
            ],
          }],
        },
      })
    } catch (e) {
      console.error('discord-interactions error', e)
      return ephemeral('エラーが発生しました。サイトから参加してください → https://ascent-esports.com/custom')
    }
  }

  // 参加キャンセルボタン
  if (payload.type === 3 && String(payload.data?.custom_id ?? '').startsWith('eights_leave:')) {
    const lobbyId = String(payload.data!.custom_id).split(':')[1]
    const discordId = payload.member?.user?.id ?? payload.user?.id
    if (!discordId || !/^[0-9a-f-]{36}$/i.test(lobbyId)) return ephemeral('リクエストを処理できませんでした')

    try {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error } = await admin.rpc('rpc_discord_eights_leave', {
        p_discord_id: String(discordId),
        p_lobby_id: lobbyId,
      })
      if (error) {
        console.error('rpc_discord_eights_leave error', error)
        return ephemeral('エラーが発生しました。サイトから操作してください → https://ascent-esports.com/custom')
      }
      const r = data as { ok: boolean; code?: string; message?: string; member_count?: number; lobby_closed?: boolean }
      if (!r.ok) {
        if (r.code === 'not_registered') return ephemeral('ASCENT未登録のため操作できません → https://ascent-esports.com/login')
        if (r.code === 'not_member') return ephemeral('このロビーには参加していません')
        if (r.code === 'closed') return ephemeral('このロビーは既に終了しています')
        return ephemeral(`キャンセルできませんでした: ${r.message ?? '不明なエラー'}`)
      }

      // 告知メッセージを更新 (ベストエフォート)。ホスト退出でロビー終了ならボタンを外す
      try {
        const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
        const msg = payload.message
        if (botToken && msg?.embeds?.length && payload.channel_id) {
          const embeds = msg.embeds
          for (const e of embeds) {
            for (const f of e.fields ?? []) {
              if (f.name === '参加状況') f.value = r.lobby_closed ? '終了' : `${r.member_count} / 8`
            }
          }
          await fetch(`https://discord.com/api/v10/channels/${payload.channel_id}/messages/${msg.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(r.lobby_closed ? { embeds, components: [] } : { embeds }),
          })
        }
      } catch { /* noop */ }

      return ephemeral(r.lobby_closed
        ? '✅ 退出しました。ホストが抜けたためこのロビーは終了しました'
        : `✅ 参加をキャンセルしました（現在 ${r.member_count}/8人）`)
    } catch (e) {
      console.error('discord-interactions leave error', e)
      return ephemeral('エラーが発生しました。サイトから操作してください → https://ascent-esports.com/custom')
    }
  }

  // ロール選択ボタン
  if (payload.type === 3 && String(payload.data?.custom_id ?? '').startsWith('eights_role:')) {
    const parts = String(payload.data!.custom_id).split(':')
    const lobbyId = parts[1]
    const role = parts[2]
    const discordId = payload.member?.user?.id ?? payload.user?.id
    if (!discordId || !/^[0-9a-f-]{36}$/i.test(lobbyId) || !['AR', 'SMG', 'FLEX'].includes(role)) {
      return ephemeral('リクエストを処理できませんでした')
    }
    try {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error } = await admin.rpc('rpc_discord_eights_set_role', {
        p_discord_id: String(discordId),
        p_lobby_id: lobbyId,
        p_role: role,
      })
      if (error) {
        console.error('rpc_discord_eights_set_role error', error)
        return ephemeral('エラーが発生しました。サイトから設定してください → https://ascent-esports.com/custom')
      }
      const r = data as { ok: boolean; code?: string }
      if (!r.ok) {
        if (r.code === 'not_registered') return ephemeral('ASCENT未登録です。まずDiscordログインで登録してください → https://ascent-esports.com/login')
        if (r.code === 'not_member') return ephemeral('まだこのロビーに参加していません。先に「参加する」を押してください')
        if (r.code === 'closed') return ephemeral('このロビーは募集を終了しています')
        return ephemeral('ロールを設定できませんでした')
      }
      return ephemeral(`✅ 武器ロールを ${role} に設定しました`)
    } catch (e) {
      console.error('discord-interactions role error', e)
      return ephemeral('エラーが発生しました。サイトから設定してください → https://ascent-esports.com/custom')
    }
  }

  return ephemeral('未対応の操作です')
})
