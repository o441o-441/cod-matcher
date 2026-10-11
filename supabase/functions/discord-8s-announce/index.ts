// ============================================================
// discord-8s-announce — 8s関連メッセージをBotとして送信
//
// DB (pg_net) から呼ばれるサーバー間専用。kind で種別を切替:
//   kind: 'lobby' (既定) — 開催告知。「参加する」+ ロール選択ボタン付き
//   kind: 'teams'        — チーム編成確定。ALPHA/BRAVO の編成表 + 全員メンション
//
// 必要な secrets:
//   DISCORD_BOT_TOKEN      — チャンネルに送信権限のあるBot
//   DISCORD_8S_CHANNEL_ID  — 送信先チャンネルID
//   EDGE_INTERNAL_SECRET   — DB側 (app_settings.edge_internal_secret) と共有
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type TeamMember = { name: string; role: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const secret = Deno.env.get('EDGE_INTERNAL_SECRET')
  if (!secret || req.headers.get('x-internal-secret') !== secret) {
    return json(401, { error: 'unauthorized' })
  }
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  const channelId = Deno.env.get('DISCORD_8S_CHANNEL_ID')
  if (!botToken || !channelId) return json(500, { error: 'bot not configured' })

  try {
    const body = await req.json().catch(() => null) as {
      kind?: string
      lobby_id?: string; title?: string; host_name?: string
      rate_label?: string; when_label?: string; mention_ids?: string[]
      alpha?: TeamMember[]; bravo?: TeamMember[]
      alpha_avg?: number; bravo_avg?: number
    } | null
    if (!body?.lobby_id || !body.title) return json(400, { error: 'invalid payload' })

    const lobbyUrl = `https://ascent-esports.com/custom/eights/${body.lobby_id}`
    const mentionIds = (body.mention_ids ?? []).filter(id => /^\d+$/.test(id))

    const send = (payload: unknown) =>
      fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

    // ---- チーム編成確定 ----
    if (body.kind === 'teams') {
      const lines = (team: TeamMember[]) => team.map(m => `• ${m.name}（${m.role}）`).join('\n') || '—'
      const res = await send({
        content: mentionIds.map(id => `<@${id}>`).join(' ')
          + '\n✅ **チーム編成が確定しました！VCで集合を確認して試合を開始してください**',
        allowed_mentions: { parse: [], users: mentionIds.slice(0, 80) },
        embeds: [{
          title: `✅ チーム編成確定: ${body.title}`,
          url: lobbyUrl,
          color: 65440,
          fields: [
            { name: `ALPHA（PEAK平均 ${body.alpha_avg ?? '-'}）`, value: lines(body.alpha ?? []), inline: true },
            { name: `BRAVO（PEAK平均 ${body.bravo_avg ?? '-'}）`, value: lines(body.bravo ?? []), inline: true },
          ],
          footer: { text: 'ASCENT · 8s Lobby' },
          timestamp: new Date().toISOString(),
        }],
        components: [{
          type: 1,
          components: [{ type: 2, style: 5, label: 'ロビーを見る', url: lobbyUrl }],
        }],
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        console.error('teams announce failed', res.status, detail.slice(0, 300))
        return json(502, { error: `Discord API ${res.status}` })
      }
      return json(200, { ok: true })
    }

    // ---- 開催告知 (既定) ----
    const embed = {
      title: `⚡ 8s 開催: ${body.title}`,
      description: '8人カスタムマッチのロビーが作成されました。下のボタンからワンタップで参加・ロール選択ができます！',
      url: lobbyUrl,
      color: 65535,
      fields: [
        { name: '開催', value: body.when_label ?? '今すぐ', inline: true },
        { name: 'ホスト', value: body.host_name ?? '不明', inline: true },
        { name: 'レート制限', value: body.rate_label ?? 'なし', inline: true },
        { name: '参加状況', value: '1 / 8', inline: true },
      ],
      footer: { text: 'ASCENT · 8s Lobby' },
      timestamp: new Date().toISOString(),
    }
    const components = [
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: '参加する', custom_id: `eights_join:${body.lobby_id}` },
          { type: 2, style: 5, label: 'ロビーを見る', url: lobbyUrl },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: 'ロール: AR', custom_id: `eights_role:${body.lobby_id}:AR` },
          { type: 2, style: 2, label: 'ロール: SMG', custom_id: `eights_role:${body.lobby_id}:SMG` },
          { type: 2, style: 2, label: 'ロール: FLEX', custom_id: `eights_role:${body.lobby_id}:FLEX` },
        ],
      },
    ]

    // 先頭メッセージ: 最初の80人のメンション + Embed + ボタン
    const firstChunk = mentionIds.slice(0, 80)
    const firstRes = await send({
      content: firstChunk.map(id => `<@${id}>`).join(' '),
      allowed_mentions: { parse: [], users: firstChunk },
      embeds: [embed],
      components,
    })
    if (!firstRes.ok) {
      const detail = await firstRes.text().catch(() => '')
      console.error('announce failed', firstRes.status, detail.slice(0, 300))
      return json(502, { error: `Discord API ${firstRes.status}` })
    }
    const firstMsg = await firstRes.json() as { id: string }

    // 81人目以降はメンションのみの追加メッセージ
    for (let pos = 80; pos < mentionIds.length; pos += 80) {
      const chunk = mentionIds.slice(pos, pos + 80)
      await send({
        content: chunk.map(id => `<@${id}>`).join(' '),
        allowed_mentions: { parse: [], users: chunk },
      }).catch(() => null)
    }

    // 参加状況更新用にメッセージIDを保存 (ベストエフォート)
    try {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      await admin.from('eights_lobbies').update({ discord_message_id: firstMsg.id }).eq('id', body.lobby_id)
    } catch { /* noop */ }

    return json(200, { ok: true, message_id: firstMsg.id })
  } catch (e) {
    console.error('discord-8s-announce error', e)
    return json(500, { error: 'internal error' })
  }
})
