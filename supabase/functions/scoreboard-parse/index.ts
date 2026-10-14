// ============================================================
// scoreboard-parse — スコアボード画像のAI解析 + 自動名寄せ
//
// 交流戦の試合ページから呼ばれる (ユーザーJWT必須)。
// Storage にアップロード済みの画像を読み、Anthropic API (vision) で
// 構造化JSONに変換する。スコアボードの言語 (日/英/韓) は問わない。
// さらに両チームのロスター (Activision ID・表示名) と突合して
//   - 各プレイヤー行の ASCENT ユーザー候補
//   - スコアボードのA/Bがホスト/ゲストのどちらか
// を自動推定して返す。保存は別RPC (rpc_scrim_submit_game)。
//
// 必要な secrets: ANTHROPIC_API_KEY
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type ParsedPlayer = {
  team: 'A' | 'B'
  name: string
  kills: number | null
  deaths: number | null
  assists: number | null
  damage: number | null
  stats: Record<string, unknown>
}

const PROMPT = `これはCall of Duty (Black Ops 7) の試合終了時スコアボードのスクリーンショットです(配信画面の切り抜きの場合があります)。UI言語は日本語・英語・韓国語のいずれかです。以下のJSONだけを出力してください(説明文・コードフェンス不要):

{
  "mode": "hp" | "snd" | "ovl" | null,  // CDLハードポイント=hp, サーチ&デストロイ=snd, オーバーロード=ovl
  "map": string | null,                  // マップ名。日本語の通称があれば日本語で (例: グリッドロック, デン, フリークエンシー, 酒, コロッサス, スカー, ハシエンダ)。不明ならそのままの表記
  "duration_seconds": number | null,     // 総プレイ時間を秒に換算
  "team_a_score": number | null,         // 上のチーム(A)のスコア (画面上部の左側の数字)
  "team_b_score": number | null,
  "players": [
    {
      "team": "A" | "B",                // Aが上のブロック、Bが下のブロック
      "name": string,                    // プレイヤー名をそのまま (日本語名も正確に)
      "kills": number | null,            // キル/デス数の列から
      "deaths": number | null,
      "assists": number | null,
      "damage": number | null,           // 威力/Score/ダメージに相当する大きな数値列
      "stats": {                         // モード固有のその他の列。読めたものだけ。キーは以下に正規化:
        // HP: obj_time_sec(ハードポイント占拠時間を秒), avg_obj_time_sec, obj_kills(目標キル), contested_time_sec(競合中占拠時間), onesided_kills(ワンサイドキル), max_streak(最大ストリーク)
        // SND: plants(設置), defuses(解除), first_bloods, onesided_kills, max_streak
        // OVL: obj_kills, onesided_kills, max_streak など読めた列
      }
    }
  ]
}

注意: 数値は見えるものを正確に。読み取れないセルは null。時間 "2:04" は124のように秒へ換算。プレイヤーは最大8人。`

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .trim()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'AI解析が未設定です (ANTHROPIC_API_KEY)' })

  try {
    // JWT必須 (verify_jwt=true でデプロイ) — ユーザー特定までは不要
    const body = await req.json().catch(() => null) as { image_path?: string; match_id?: string } | null
    if (!body?.image_path || !body.match_id) return json(400, { error: 'image_path と match_id が必要です' })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 画像をStorageから取得
    const { data: blob, error: dlErr } = await admin.storage.from('scoreboards').download(body.image_path)
    if (dlErr || !blob) return json(400, { error: '画像を取得できませんでした' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > 5 * 1024 * 1024) return json(400, { error: '画像が大きすぎます' })
    let b64 = ''
    for (let i = 0; i < bytes.length; i += 32768) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + 32768))
    }
    b64 = btoa(b64)
    const mediaType = body.image_path.endsWith('.jpg') || body.image_path.endsWith('.jpeg') ? 'image/jpeg'
      : body.image_path.endsWith('.webp') ? 'image/webp' : 'image/png'

    // AI解析
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })
    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => '')
      console.error('anthropic error', aiRes.status, detail.slice(0, 300))
      return json(502, { error: `AI解析に失敗しました (${aiRes.status})` })
    }
    const aiBody = await aiRes.json() as { content?: { type: string; text?: string }[] }
    const text = (aiBody.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
    const jsonStart = text.indexOf('{')
    const jsonEnd = text.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0) return json(502, { error: '解析結果を読み取れませんでした' })
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
      mode: string | null; map: string | null; duration_seconds: number | null
      team_a_score: number | null; team_b_score: number | null
      players: ParsedPlayer[]
    }

    // ---- 名寄せ: 両サイドのロスターと突合 ----
    const { data: match } = await admin.from('scrim_matches')
      .select('host_team_id, guest_team_id, host_room_id, guest_room_id')
      .eq('id', body.match_id).maybeSingle()
    if (!match) return json(400, { error: '試合が見つかりません' })

    const sideUsers = async (teamId: string | null, roomId: string | null): Promise<string[]> => {
      const { data } = await admin.rpc('_scrimboard_side_users', { p_team_id: teamId, p_room_id: roomId })
      return (data as string[] | null) ?? []
    }
    const hostIds = await sideUsers(match.host_team_id, match.host_room_id)
    const guestIds = await sideUsers(match.guest_team_id, match.guest_room_id)
    const allIds = [...hostIds, ...guestIds]

    const [{ data: profs }, { data: usersRows }] = await Promise.all([
      allIds.length ? admin.from('profiles').select('id, display_name').in('id', allIds) : Promise.resolve({ data: [] }),
      allIds.length ? admin.from('users').select('auth_user_id, activision_id').in('auth_user_id', allIds) : Promise.resolve({ data: [] }),
    ])
    type Roster = { user_id: string; display_name: string; keys: string[] }
    const buildRoster = (ids: string[]): Roster[] => ids.map(id => {
      const p = (profs as { id: string; display_name: string | null }[] | null)?.find(x => x.id === id)
      const u = (usersRows as { auth_user_id: string; activision_id: string | null }[] | null)?.find(x => x.auth_user_id === id)
      const keys: string[] = []
      if (u?.activision_id) keys.push(normName(u.activision_id.split('#')[0]))
      if (p?.display_name) keys.push(normName(p.display_name))
      return { user_id: id, display_name: p?.display_name ?? '(名前未設定)', keys: keys.filter(Boolean) }
    })
    const hostRoster = buildRoster(hostIds)
    const guestRoster = buildRoster(guestIds)

    const matchUser = (name: string, roster: Roster[]) => {
      const n = normName(name)
      if (!n) return null
      return roster.find(r => r.keys.includes(n))
        ?? roster.find(r => r.keys.some(k => k.length >= 3 && (k.startsWith(n) || n.startsWith(k))))
        ?? null
    }

    // A/B → host/guest をマッチ数で推定
    let aHost = 0, aGuest = 0
    for (const pl of parsed.players ?? []) {
      const target = pl.team === 'A' ? 1 : -1
      if (matchUser(pl.name, hostRoster)) aHost += target
      if (matchUser(pl.name, guestRoster)) aGuest += target
    }
    const aIsHost: boolean | null = aHost === aGuest ? null : aHost > aGuest

    const players = (parsed.players ?? []).slice(0, 12).map(pl => {
      const inferredSide = aIsHost === null ? null : ((pl.team === 'A') === aIsHost ? 'host' : 'guest')
      const roster = inferredSide === 'host' ? hostRoster : inferredSide === 'guest' ? guestRoster : [...hostRoster, ...guestRoster]
      const m = matchUser(pl.name, roster)
      return { ...pl, side: inferredSide, matched_user_id: m?.user_id ?? null, matched_name: m?.display_name ?? null }
    })

    return json(200, {
      ok: true,
      mode: parsed.mode, map: parsed.map, duration_seconds: parsed.duration_seconds,
      team_a_score: parsed.team_a_score, team_b_score: parsed.team_b_score,
      a_is_host: aIsHost,
      players,
      rosters: {
        host: hostRoster.map(r => ({ user_id: r.user_id, name: r.display_name })),
        guest: guestRoster.map(r => ({ user_id: r.user_id, name: r.display_name })),
      },
    })
  } catch (e) {
    console.error('scoreboard-parse error', e)
    return json(500, { error: '解析中にエラーが発生しました' })
  }
})
