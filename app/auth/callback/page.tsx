'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function CallbackContent() {
  const params = useSearchParams()
  const code = params.get('code')
  const error = params.get('error')
  const errorDescription = params.get('error_description')

  return (
    <main style={{ padding: '40px' }}>
      <h1>Callback確認ページ</h1>
      <p>code: {code || 'なし'}</p>
      <p>error: {error || 'なし'}</p>
      <p>error_description: {errorDescription || 'なし'}</p>
    </main>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<main style={{ padding: '40px' }}>読み込み中...</main>}>
      <CallbackContent />
    </Suspense>
  )
}
