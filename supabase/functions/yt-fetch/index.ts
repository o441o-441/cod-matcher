// ============================================================
// yt-fetch — YouTube動画のストリーム取得プロキシ (LK動画解析用)
//
// 交流戦の試合ページから呼ばれる (ユーザーJWT必須)。
// YouTubeの動画は googlevideo.com がCORS非対応のためブラウザから
// 直接読めない。この Function が
//   1. YouTube Innertube API で再生ストリームURLを解決し
//   2. mp4 (720p以下) をそのままストリーミングで中継する
// ブラウザは一度Blobとしてダウンロードした後、ローカルの
// フレーム抽出 (lib/hpVideo.ts) に乗せる。
//
// ストリームURLは取得元IPに紐づくため、解決と中継を同一リクエスト
// 内で行う (URLだけ返す設計は不可)。
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'content-length, x-video-title',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MAX_BYTES = 600 * 1024 * 1024 // 600MB

type Fmt = {
  itag?: number
  url?: string
  mimeType?: string
  height?: number
  contentLength?: string
}

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string }
  videoDetails?: { title?: string; isLiveContent?: boolean; lengthSeconds?: string }
  streamingData?: { formats?: Fmt[]; adaptiveFormats?: Fmt[] }
}

// Innertube クライアント定義 (ANDROIDが駄目なときは IOS で再試行)。
// 古いclientVersionはHTTP 400で弾かれるため、動かなくなったら更新する
const CLIENTS = [
  {
    name: 'ANDROID',
    body: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, osName: 'Android', osVersion: '14', hl: 'ja' },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  },
  {
    name: 'IOS',
    body: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '17.5.1.21F90', hl: 'ja' },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
  },
]

type Resolved = { ok: true; pr: PlayerResponse; ua: string } | { ok: false; botBlocked: boolean }

async function resolvePlayer(videoId: string): Promise<Resolved> {
  const attempts: string[] = []
  let botBlocked = false
  for (const c of CLIENTS) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua },
        body: JSON.stringify({ videoId, contentCheckOk: true, racyCheckOk: true, context: { client: c.body } }),
      })
      if (!res.ok) {
        attempts.push(`${c.name}: HTTP ${res.status}`)
        continue
      }
      const pr = await res.json() as PlayerResponse
      if (pr.playabilityStatus?.status === 'OK' && pr.streamingData) return { ok: true, pr, ua: c.ua }
      const status = pr.playabilityStatus?.status ?? 'unknown'
      const reason = pr.playabilityStatus?.reason ?? ''
      // データセンターIPへのbot対策 (LOGIN_REQUIRED + bot文言) を区別する
      if (status === 'LOGIN_REQUIRED' && /bot|ロボット/i.test(reason)) botBlocked = true
      attempts.push(`${c.name}: ${status} ${reason}`)
    } catch (e) {
      attempts.push(`${c.name}: ${e instanceof Error ? e.message : 'error'}`)
    }
  }
  console.error('yt-fetch resolve failed', videoId, attempts.join(' | '))
  return { ok: false, botBlocked }
}

// 720p以下のmp4を優先 (HUD読み取りには480p以上が望ましい)。
// adaptiveFormats の映像のみmp4でも <video> 再生・フレーム抽出には十分。
function pickFormat(sd: NonNullable<PlayerResponse['streamingData']>): Fmt | null {
  const all = [...(sd.formats ?? []), ...(sd.adaptiveFormats ?? [])]
    .filter(f => !!f.url && !!f.mimeType?.includes('video/mp4') && (f.height ?? 0) > 0)
    .filter(f => !f.contentLength || Number(f.contentLength) <= MAX_BYTES)
  if (all.length === 0) return null
  const within = all.filter(f => (f.height ?? 0) <= 720)
  const pool = within.length > 0 ? within : all
  return pool.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return json(405, { error: 'method not allowed' })

  try {
    const videoId = new URL(req.url).searchParams.get('v') ?? ''
    if (!/^[\w-]{11}$/.test(videoId)) return json(400, { error: '動画IDが不正です' })

    const resolved = await resolvePlayer(videoId)
    if (!resolved.ok) {
      return json(400, {
        error: resolved.botBlocked
          ? 'YouTube側の制限により、現在サーバー経由の取得ができません。動画をダウンロードして「動画ファイルを選択」から読み込んでください'
          : 'この動画を取得できませんでした (非公開・年齢制限・メンバー限定の可能性があります)。動画をダウンロードして「動画ファイルを選択」から読み込んでください',
      })
    }
    const { pr, ua } = resolved
    if (pr.videoDetails?.isLiveContent) return json(400, { error: 'ライブ配信は未対応です。アーカイブ化を待つか、録画ファイルをご利用ください' })
    const lengthSec = Number(pr.videoDetails?.lengthSeconds ?? 0)
    if (lengthSec > 3 * 3600) return json(400, { error: '動画が長すぎます (3時間まで)。1ゲームぶんに切り出してください' })

    const fmt = pickFormat(pr.streamingData!)
    if (!fmt?.url) return json(400, { error: '再生可能なストリームが見つかりませんでした' })

    const upstream = await fetch(fmt.url, { headers: { 'User-Agent': ua } })
    if (!upstream.ok || !upstream.body) {
      console.error('googlevideo error', upstream.status)
      return json(502, { error: `動画ストリームの取得に失敗しました (${upstream.status})。時間をおいて再試行してください` })
    }

    const headers = new Headers({ ...CORS, 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' })
    const len = upstream.headers.get('content-length') ?? fmt.contentLength
    if (len) headers.set('Content-Length', String(len))
    if (pr.videoDetails?.title) headers.set('x-video-title', encodeURIComponent(pr.videoDetails.title.slice(0, 200)))
    return new Response(upstream.body, { status: 200, headers })
  } catch (e) {
    console.error('yt-fetch error', e)
    return json(500, { error: '動画の取得中にエラーが発生しました' })
  }
})
