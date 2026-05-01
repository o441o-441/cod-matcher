'use client'

import { useEffect, useState } from 'react'
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
  const [initialLoading, setInitialLoading] = useState(true)

  useEffect(() => {
    const loadExisting = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setInitialLoading(false); return }

      const { data } = await supabase
        .from('users')
        .select('display_name, activision_id, controller, platform')
        .eq('auth_user_id', session.user.id)
        .maybeSingle()

      if (data) {
        if (data.display_name) setDisplayName(data.display_name)
        if (data.activision_id) setActivisionId(data.activision_id)
        if (data.controller) setController(data.controller)
        if (data.platform) setPlatform(data.platform)
      }
      setInitialLoading(false)
    }
    void loadExisting()
  }, [])

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

    // Activision ID 重複チェック（BAN 済ユーザーと照合）
    if (activisionId.trim()) {
      const { data: reuseCheck } = await supabase.rpc('rpc_check_activision_reuse', {
        p_activision_id: activisionId.trim(),
      })
      if (reuseCheck?.blocked) {
        alert(reuseCheck.reason || 'このActivision IDは使用できません')
        setLoading(false)
        return
      }
    }

    // 既存の peak_rating を取得して保持する
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('peak_rating')
      .eq('id', user.id)
      .maybeSingle()

    const existingPeak = (existingProfile?.peak_rating as number | null) ?? 0
    const newPeakRating = Math.max(initialRating, existingPeak)

    // profiles を先に保存（is_onboarded を確実にセット）
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          display_name: displayName,
          is_onboarded: true,
          current_rating: initialRating,
          initial_rating: initialRating,
          peak_rating: newPeakRating,
        },
        { onConflict: 'id' }
      )

    if (profileError) {
      alert('プロフィール同期に失敗: ' + profileError.message)
      setLoading(false)
      return
    }

    // profiles 成功後に users を更新
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

    router.push('/menu')
  }

  if (initialLoading) {
    return (
      <main>
        <div className="eyebrow">ONBOARDING</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          <em>プロフィール登録</em>
        </h1>
        <p className="muted">読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">ONBOARDING</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        ASCENT <em>プロフィール登録</em>
      </h1>

      <div className="section card-strong stack">
        <div>
          <div className="stat-label">表示名</div>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="表示名を入力"
          />
        </div>

        <div>
          <div className="stat-label">ACTIVISION ID</div>
          <input
            value={activisionId}
            onChange={e => setActivisionId(e.target.value)}
            placeholder="Activision IDを入力"
          />
        </div>

        <div>
          <div className="stat-label">使用デバイス</div>
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

        <div>
          <div className="stat-label">プラットフォーム</div>
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

        <div>
          <div className="stat-label">スキルレベル</div>
          <p className="muted" style={{ marginTop: 4 }}>
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

        <button className="btn-primary btn-block btn-lg" onClick={handleSave} disabled={loading}>
          {loading ? '保存中...' : '保存'}
        </button>
      </div>
    </main>
  )
}
