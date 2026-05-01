'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { runSecurityChecks } from '@/lib/security-check'
import { setCache } from '@/lib/cache'

function CallbackContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      const errorParam = params.get('error')
      const errorDescription = params.get('error_description')
      if (errorParam) {
        setErrorMessage(errorDescription || errorParam)
        return
      }

      const code = params.get('code')
      if (!code) {
        // No code: maybe a stale visit. Check if we already have a session.
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session?.user) {
          router.replace('/menu')
        } else {
          router.replace('/login')
        }
        return
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        console.error('exchangeCodeForSession error:', error)
        // code再利用（リロード等）の場合、既にセッションがあればそのまま遷移
        const { data: { session: existing } } = await supabase.auth.getSession()
        if (existing?.user) {
          router.replace('/menu')
          return
        }
        setErrorMessage(error.message || 'ログイン処理に失敗しました')
        return
      }

      // セッション確立後、メニューデータをプリフェッチ + セキュリティチェックを並行実行
      const { data: { session: newSession } } = await supabase.auth.getSession()
      if (newSession?.user) {
        const uid = newSession.user.id
        // プリフェッチ（結果をキャッシュに保存、遷移をブロックしない）
        Promise.all([
          supabase.from('profiles').select('is_admin, current_rating, peak_rating, wins, losses').eq('id', uid).maybeSingle(),
          supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle(),
        ]).then(([profileRes, memberRes]) => {
          const p = profileRes.data as { is_admin: boolean | null; current_rating: number | null; peak_rating: number | null; wins: number | null; losses: number | null } | null
          if (p) {
            setCache('menu_data', {
              hasTeam: !!(memberRes.data as { team_id: string | null } | null)?.team_id,
              isAdmin: !!p.is_admin,
              rating: p.current_rating,
              peakRating: p.peak_rating,
              wins: p.wins,
              losses: p.losses,
            })
          }
        }).catch(() => { /* noop */ })

        runSecurityChecks().catch(() => { /* noop */ })
      }

      router.replace('/menu')
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (errorMessage) {
    const isTimeout = errorMessage.includes('timed out') || errorMessage.includes('timeout') || errorMessage.includes('deadline')
    return (
      <main>
        <div className="eyebrow">AUTH</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          <em>ログインに失敗しました</em>
        </h1>
        <div className="section card-strong">
          {isTimeout ? (
            <>
              <p className="danger">サーバーが混み合っています。しばらく待ってから再度お試しください。</p>
              <div className="section row">
                <button className="btn-primary" onClick={() => router.replace('/login')}>
                  再度ログインする
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="danger">{errorMessage}</p>
              <div className="section row">
                <button className="btn-primary" onClick={() => router.replace('/login')}>
                  再度ログインする
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">AUTH</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        <em>ログイン処理中...</em>
      </h1>
      <p className="muted">少々お待ちください</p>
    </main>
  )
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <main>
          <p className="muted">ログイン処理中...</p>
        </main>
      }
    >
      <CallbackContent />
    </Suspense>
  )
}
