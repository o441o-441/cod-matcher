'use client'

import { useEffect, useState } from 'react'

export default function CallbackPage() {
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorDescription, setErrorDescription] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCode(params.get('code'))
    setError(params.get('error'))
    setErrorDescription(params.get('error_description'))
  }, [])

  return (
    <main style={{ padding: '40px' }}>
      <h1>Callback確認ページ</h1>
      <p>code: {code || 'なし'}</p>
      <p>error: {error || 'なし'}</p>
      <p>error_description: {errorDescription || 'なし'}</p>
    </main>
  )
}
