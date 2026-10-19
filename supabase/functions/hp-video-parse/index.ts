// ============================================================
// hp-video-parse — LK動画 (試合録画) のHUDフレームAI読み取り
//
// 交流戦の試合ページから呼ばれる (ユーザーJWT必須)。
// ブラウザ側で動画から切り出した「画面上部のHUD」フレーム (JPEG base64)
// を最大10枚ずつ受け取り、Anthropic API (vision) で
//   左右チームのスコア / 試合時間 / ヒル残り時間
// を読み取って返す。推移の導出・保存はクライアント側
// (lib/hpTimeline.ts → rpc_scrim_submit_hp_timeline)。
//
// 既存の scoreboard-parse とは独立した追加Function。
// 必要な secrets: ANTHROPIC_API_KEY
// ============================================================

// ブラウザから直接呼ばれるため CORS 必須 (preflight の OPTIONS も処理する)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MAX_FRAMES = 10
const MAX_FRAME_B64 = 600_000 // 約450KB/枚

type Frame = { i: number; data: string }
type Reading = { i: number; left: number | null; right: number | null; clock: number | null; hill: number | null }

const PROMPT = `これはCall of Duty (Black Ops 7) ハードポイントの試合映像(観戦/配信視点)から切り出した「画面上部」の連続フレームです。各フレームの直前に「フレーム N」とラベルを付けています。HUDから以下を読み取り、JSON配列だけを出力してください(説明文・コードフェンス不要):

[
  {
    "i": 0,                  // フレームのラベル番号
    "left": number | null,   // 画面上部スコアバーの左チームの累計スコア
    "right": number | null,  // 右チームの累計スコア
    "clock": number | null,  // 試合時間 "mm:ss" を秒に換算 (例 "4:32" → 272)
    "hill": number | null    // ハードポイント(ヒル)の残り時間カウントダウンが読めれば秒で。無ければ null
  }
]

注意: スコアは0〜300程度の整数。確信が持てない値は null にしてください。試合中でないフレーム(リザルト画面・キルカメラ・ロード画面・リプレイ)はすべて null で構いません。必ず渡したフレームと同じ数の要素を、同じ "i" で返してください。`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'AI解析が未設定です (ANTHROPIC_API_KEY)' })

  try {
    // JWT必須 (verify_jwt=true でデプロイ)
    const body = await req.json().catch(() => null) as { frames?: Frame[] } | null
    const frames = body?.frames
    if (!Array.isArray(frames) || frames.length === 0) return json(400, { error: 'frames が必要です' })
    if (frames.length > MAX_FRAMES) return json(400, { error: `フレームは一度に${MAX_FRAMES}枚までです` })
    for (const f of frames) {
      if (typeof f?.i !== 'number' || typeof f?.data !== 'string' || f.data.length === 0) {
        return json(400, { error: 'フレーム形式が不正です' })
      }
      if (f.data.length > MAX_FRAME_B64) return json(400, { error: 'フレーム画像が大きすぎます' })
    }

    const content: unknown[] = []
    for (const f of frames) {
      content.push({ type: 'text', text: `フレーム ${f.i}` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } })
    }
    content.push({ type: 'text', text: PROMPT })

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
      }),
    })
    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => '')
      console.error('anthropic error', aiRes.status, detail.slice(0, 300))
      return json(502, { error: `AI解析に失敗しました (${aiRes.status})` })
    }
    const aiBody = await aiRes.json() as { content?: { type: string; text?: string }[] }
    const text = (aiBody.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
    const jsonStart = text.indexOf('[')
    const jsonEnd = text.lastIndexOf(']')
    if (jsonStart < 0 || jsonEnd < 0) return json(502, { error: '解析結果を読み取れませんでした' })

    const num = (v: unknown): number | null => {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Partial<Reading>[]
    const readings: Reading[] = (Array.isArray(parsed) ? parsed : []).map(r => ({
      i: num(r?.i) ?? -1,
      left: num(r?.left),
      right: num(r?.right),
      clock: num(r?.clock),
      hill: num(r?.hill),
    })).filter(r => r.i >= 0)

    return json(200, { ok: true, readings })
  } catch (e) {
    console.error('hp-video-parse error', e)
    return json(500, { error: '解析中にエラーが発生しました' })
  }
})
