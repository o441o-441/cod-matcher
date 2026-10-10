// ============================================================
// x-post — X (Twitter) への自動投稿
//
// DB (pg_net) から呼ばれるサーバー間専用関数。
// OAuth 1.0a (HMAC-SHA1) で署名して X API v2 /2/tweets に投稿する。
// 認証はユーザーJWTではなく共有シークレットヘッダー (x-post-secret)。
//
// 必要な secrets:
//   X_API_KEY / X_API_SECRET       — Xアプリの Consumer Keys
//   X_ACCESS_TOKEN / X_ACCESS_SECRET — 投稿アカウントの Access Token (Read and Write)
//   X_POST_SECRET                  — DB側と共有する呼び出し認証用シークレット
// ============================================================

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

async function hmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function buildOAuthHeader(url: string, method: string): Promise<string> {
  const apiKey = Deno.env.get('X_API_KEY')!
  const apiSecret = Deno.env.get('X_API_SECRET')!
  const accessToken = Deno.env.get('X_ACCESS_TOKEN')!
  const accessSecret = Deno.env.get('X_ACCESS_SECRET')!

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: '1.0',
  }
  // JSONボディはOAuth 1.0aの署名対象に含まれない (oauthパラメータのみ)
  const paramString = Object.keys(oauthParams).sort()
    .map(k => `${enc(k)}=${enc(oauthParams[k])}`).join('&')
  const base = `${method}&${enc(url)}&${enc(paramString)}`
  const signingKey = `${enc(apiSecret)}&${enc(accessSecret)}`
  const signature = await hmacSha1(signingKey, base)

  const all = { ...oauthParams, oauth_signature: signature }
  return 'OAuth ' + Object.keys(all).sort()
    .map(k => `${enc(k)}="${enc(all[k as keyof typeof all])}"`).join(', ')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const secret = Deno.env.get('X_POST_SECRET')
  if (!secret || req.headers.get('x-post-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  if (!Deno.env.get('X_API_KEY') || !Deno.env.get('X_ACCESS_TOKEN')) {
    return new Response(JSON.stringify({ error: 'X API keys not configured' }), { status: 500 })
  }

  try {
    const body = await req.json().catch(() => null) as { text?: unknown } | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return new Response(JSON.stringify({ error: 'text required' }), { status: 400 })
    if (text.length > 280) return new Response(JSON.stringify({ error: 'text too long' }), { status: 400 })

    const url = 'https://api.x.com/2/tweets'
    const auth = await buildOAuthHeader(url, 'POST')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const resBody = await res.text()
    if (res.status === 201) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    console.error('x post failed', res.status, resBody.slice(0, 300))
    return new Response(JSON.stringify({ error: `X API ${res.status}`, detail: resBody.slice(0, 300) }), { status: 502 })
  } catch (e) {
    console.error('x-post error', e)
    return new Response(JSON.stringify({ error: 'internal error' }), { status: 500 })
  }
})
