'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CONTROLLER_GROUPS } from '@/lib/controllers'

export default function OnboardingPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [activisionId, setActivisionId] = useState('')
  const [controller, setController] = useState('')
  const [platform, setPlatform] = useState('')
  const [skillLevel, setSkillLevel] = useState('')
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

    if (!skillLevel) {
      alert('スキルレベルを選択してください')
      setLoading(false)
      return
    }

    const initialRating = Number(skillLevel)
    const user = session.user

    const { error } = await supabase
      .from('users')
      .update({
        display_name: displayName,
        activision_id: activisionId,
        controller: controller || null,
        platform: platform || null,
        is_profile_complete: true,
      })
      .eq('auth_user_id', user.id)

    if (error) {
      alert('保存失敗: ' + error.message)
      setLoading(false)
      return
    }

    // /match 系（パーティーモデル）が参照する profiles テーブルにも反映する
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          display_name: displayName,
          is_onboarded: true,
          current_rating: initialRating,
          initial_rating: initialRating,
          peak_rating: initialRating,
        },
        { onConflict: 'id' }
      )

    if (profileError) {
      alert('プロフィール同期に失敗: ' + profileError.message)
      setLoading(false)
      return
    }

    router.push('/menu')
  }

  return (
    <main style={{ padding: '40px' }}>
      <h1>ASCENT プロフィール登録</h1>

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
        <p>使用デバイス</p>
        <select
          value={controller}
          onChange={(e) => setController(e.target.value)}
        >
          <option value="">選択してください</option>
          {CONTROLLER_GROUPS.map((g) => (
            <optgroup key={g.manufacturer} label={g.manufacturer}>
              {g.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div style={{ marginTop: '20px' }}>
        <p>プラットフォーム</p>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="">選択してください</option>
          <option value="Battle.net">Battle.net</option>
          <option value="Steam">Steam</option>
          <option value="PlayStation">PlayStation</option>
          <option value="Xbox">Xbox</option>
        </select>
      </div>

      <div style={{ marginTop: '20px' }}>
        <p>スキルレベル</p>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
          ランクマッチでの最高ランクを基準に選択してください。初期レートに反映されます。
        </p>
        <select
          value={skillLevel}
          onChange={(e) => setSkillLevel(e.target.value)}
        >
          <option value="">選択してください</option>
          <option value="1400">初級者（プラチナ以下）</option>
          <option value="1500">中級者（ダイヤ）</option>
          <option value="1600">上級者（クリムゾン以上）</option>
        </select>
      </div>

      <div style={{ marginTop: '20px' }}>
        <button onClick={handleSave} disabled={loading}>
          {loading ? '保存中...' : '保存'}
        </button>
      </div>
    </main>
  )
}
