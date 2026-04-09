'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

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
        setErrorMessage(error.message || 'ログイン処理に失敗しました')
        return
      }

      router.replace('/menu')
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (errorMessage) {
    return (
      <main>
        <h1>ログインに失敗しました</h1>
        <div className="section card-strong">
          <p className="danger">{errorMessage}</p>
          <div className="section row">
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
      <h1>ログイン処理中...</h1>
      <p className="muted">少々お待ちください</p>
    </main>
  )
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <main>
          <h1>ログイン処理中...</h1>
        </main>
      }
    >
      <CallbackContent />
    </Suspense>
  )
}
