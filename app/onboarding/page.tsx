'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { CONTROLLER_GROUPS } from '@/lib/controllers'

function RequiredBadge() {
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        color: 'var(--danger)',
        border: '1px solid rgba(255,77,109,0.4)',
        borderRadius: 4,
        padding: '1px 6px',
        verticalAlign: 1,
      }}
    >
      必須
    </span>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const { showToast } = useToast()
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
      if (!session?.user) {
        // シェル(ナビ)なしページなので、未ログインのまま留まると行き止まりになる
        router.replace('/login')
        return
      }

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
  }, [router])

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user) {
      showToast('ログイン情報が見つかりません。再度ログインしてください', 'error')
      setLoading(false)
      router.replace('/login')
      return
    }

    if (!displayName.trim()) {
      showToast('表示名を入力してください', 'error')
      setLoading(false)
      return
    }

    if (!skillLevel) {
      showToast('スキルレベルを選択してください', 'error')
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
        showToast(reuseCheck.reason || 'このActivision IDは使用できません', 'error')
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
          display_name: displayName.trim(),
          is_onboarded: true,
          current_rating: initialRating,
          initial_rating: initialRating,
          peak_rating: newPeakRating,
        },
        { onConflict: 'id' }
      )

    if (profileError) {
      showToast('プロフィール同期に失敗: ' + profileError.message, 'error')
      setLoading(false)
      return
    }

    // profiles 成功後に users を更新
    const { error } = await supabase
      .from('users')
      .update({
        display_name: displayName.trim(),
        activision_id: activisionId,
        controller: controller || null,
        platform: platform || null,
        is_profile_complete: true,
      })
      .eq('auth_user_id', user.id)

    if (error) {
      showToast('保存失敗: ' + error.message, 'error')
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

      <form className="section card-strong stack" onSubmit={handleSave}>
        <div>
          <label htmlFor="ob-name" className="stat-label">表示名<RequiredBadge /></label>
          <input
            id="ob-name"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="表示名を入力"
            maxLength={30}
          />
        </div>

        <div>
          <label htmlFor="ob-actid" className="stat-label">ACTIVISION ID</label>
          <input
            id="ob-actid"
            value={activisionId}
            onChange={e => setActivisionId(e.target.value)}
            placeholder="Activision IDを入力"
          />
        </div>

        <div>
          <label htmlFor="ob-controller" className="stat-label">使用デバイス</label>
          <select
            id="ob-controller"
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
          <label htmlFor="ob-platform" className="stat-label">プラットフォーム</label>
          <select
            id="ob-platform"
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
          <label htmlFor="ob-skill" className="stat-label">スキルレベル<RequiredBadge /></label>
          <p className="muted" style={{ marginTop: 4 }}>
            ランクマッチでの最高ランクを基準に選択してください。初期レートに反映されます。
          </p>
          <select
            id="ob-skill"
            value={skillLevel}
            onChange={(e) => setSkillLevel(e.target.value)}
          >
            <option value="">選択してください</option>
            <option value="1400">初級者（プラチナ以下）</option>
            <option value="1500">中級者（ダイヤ）</option>
            <option value="1600">上級者（クリムゾン以上）</option>
          </select>
        </div>

        <button type="submit" className="btn-primary btn-block btn-lg" disabled={loading}>
          {loading ? '保存中...' : '保存'}
        </button>
      </form>
    </main>
  )
}
