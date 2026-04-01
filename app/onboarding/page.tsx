'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function OnboardingPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [activisionId, setActivisionId] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    setLoading(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user) {
      alert('ログイン情報が見つかりません')
      setLoading(false)
      return
    }

    const user = session.user

    const { error } = await supabase
      .from('users')
      .update({
        display_name: displayName,
        activision_id: activisionId,
        is_profile_complete: true,
      })
      .eq('auth_user_id', user.id)

    if (error) {
      alert('保存失敗: ' + error.message)
      setLoading(false)
      return
    }

    router.push('/mypage')
  }

  return (
    <main style={{ padding: '40px' }}>
      <h1>プロフィール登録</h1>

      <div style={{ marginTop: '20px' }}>
        <p>表示名</p>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="表示名を入力"
        />
      </div>

      <div style={{ marginTop: '20px' }}>
        <p>Activision ID</p>
        <input
          value={activisionId}
          onChange={e => setActivisionId(e.target.value)}
          placeholder="Activision IDを入力"
        />
      </div>

      <div style={{ marginTop: '20px' }}>
        <button onClick={handleSave} disabled={loading}>
          {loading ? '保存中...' : '保存'}
        </button>
      </div>
    </main>
  )
}
