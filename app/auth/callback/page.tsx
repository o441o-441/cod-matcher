'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { runSecurityChecks } from '@/lib/security-check'

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

      // サブアカウント検知（バックグラウンドで実行、ログインをブロックしない）
      runSecurityChecks().catch(() => { /* noop */ })

      router.replace('/menu')
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (errorMessage) {
    return (
      <main>
        <div className="eyebrow">AUTH</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          <em>ログインに失敗しました</em>
        </h1>
        <div className="section card-strong">
          <p className="danger">{errorMessage}</p>
          <div className="section">
            <button onClick={() => router.replace('/login')}>
              ログイン画面へ戻る
            </button>
          </div>
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
