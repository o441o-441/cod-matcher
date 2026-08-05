import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // トークンが実在するユーザーのものか検証 (ヘッダの存在チェックだけでは不十分)
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { fingerprint_hash?: unknown; discord_created_at?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  // 型と長さを検証 (ログ汚染・肥大化防止)
  const fingerprint =
    typeof body.fingerprint_hash === 'string' && body.fingerprint_hash.length <= 128
      ? body.fingerprint_hash
      : null
  const discordCreatedAt =
    typeof body.discord_created_at === 'string' &&
    body.discord_created_at.length <= 64 &&
    !Number.isNaN(Date.parse(body.discord_created_at))
      ? body.discord_created_at
      : null

  const { data, error } = await supabase.rpc('rpc_log_security_event', {
    p_ip_address: ip,
    p_fingerprint_hash: fingerprint,
    p_discord_created_at: discordCreatedAt,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
