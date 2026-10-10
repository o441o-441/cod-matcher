'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { CONTROLLER_GROUPS, normalizeDeviceName } from '@/lib/controllers'

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
  const [skillLevel, setSkillLevel] = useState('1500') // 迷ったら中級者 (既定値)
  const [showDetails, setShowDetails] = useState(false)
  const [nameLocked, setNameLocked] = useState(false) // 登録済みユーザーの再訪問時は表示名変更不可
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

      const [{ data }, { data: prof }] = await Promise.all([
        supabase
          .from('users')
          .select('display_name, activision_id, controller, platform')
          .eq('auth_user_id', session.user.id)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('display_name, is_onboarded')
          .eq('id', session.user.id)
          .maybeSingle<{ display_name: string | null; is_onboarded: boolean }>(),
      ])

      if (data) {
        if (data.display_name) setDisplayName(data.display_name)
        if (data.activision_id) setActivisionId(data.activision_id)
        if (data.controller) setController(data.controller)
        if (data.platform) setPlatform(data.platform)
        if (data.controller || data.platform) setShowDetails(true)
      }
      // 登録完了済みなら表示名は確定 (変更不可)
      if (prof?.is_onboarded) {
        setNameLocked(true)
        if (prof.display_name) setDisplayName(prof.display_name)
      }

      // 表示名が未設定なら Discord の名前をプリフィル (確認して保存するだけにする)
      if (!data?.display_name && !prof?.display_name) {
        const meta = session.user.user_metadata as Record<string, unknown> | undefined
        const claims = meta?.custom_claims as Record<string, unknown> | undefined
        const discordName = String(claims?.global_name ?? meta?.full_name ?? meta?.name ?? '').trim()
        if (discordName) setDisplayName(discordName.slice(0, 30))
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

    if (!activisionId.trim()) {
      showToast('Activision IDを入力してください', 'error')
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
    {
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
        activision_id: activisionId.trim(),
        controller: normalizeDeviceName(controller) || null,
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
      <p className="muted" style={{ marginTop: 8 }}>
        あと1ステップで完了です。内容を確認して「はじめる」を押してください。
      </p>

      <form className="section card-strong stack" onSubmit={handleSave}>
        <div>
          <label htmlFor="ob-name" className="stat-label">表示名<RequiredBadge /></label>
          <input
            id="ob-name"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="表示名を入力"
            maxLength={30}
            disabled={nameLocked}
          />
          <p style={{ fontSize: 11, marginTop: 4, color: 'var(--amber)' }}>
            {nameLocked
              ? '表示名は登録済みのため変更できません。'
              : '⚠ 表示名は登録後に変更できません（誰だか分からなくなるのを防ぐため）。Discordの名前を自動入力しています。'}
          </p>
        </div>

        <div>
          <label htmlFor="ob-actid" className="stat-label">ACTIVISION ID<RequiredBadge /></label>
          <input
            id="ob-actid"
            value={activisionId}
            onChange={e => setActivisionId(e.target.value)}
            placeholder="例: PlayerName#1234567"
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.7 }}>
            ゲーム内の「アカウント」設定で確認できます。
            <span style={{ color: 'var(--amber)' }}>ゲーム内でActivision IDを変更した場合は、マイページのプロフィール編集から必ずこちらも更新してください。登録IDが実際のIDと一致しない場合は規約違反の対象となります。</span>
          </p>
        </div>

        <div>
          <label htmlFor="ob-skill" className="stat-label">スキルレベル<RequiredBadge /></label>
          <p className="muted" style={{ marginTop: 4 }}>
            ランクマッチでの最高ランク基準。初期レートに反映されます（迷ったら中級者のままでOK）。
          </p>
          <select
            id="ob-skill"
            value={skillLevel}
            onChange={(e) => setSkillLevel(e.target.value)}
          >
            <option value="1400">初級者（プラチナ以下）</option>
            <option value="1500">中級者（ダイヤ）</option>
            <option value="1600">上級者（クリムゾン以上）</option>
          </select>
        </div>

        {/* 任意項目は折りたたみ (あとからマイページで設定可能) */}
        <button type="button" onClick={() => setShowDetails(v => !v)}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-soft)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left', padding: '2px 0', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          {showDetails ? '▾ 詳細プロフィールを閉じる' : '▸ 詳細プロフィールも入力する（任意 — あとからマイページで設定できます）'}
        </button>

        {showDetails && (
          <>
            <div>
              <label htmlFor="ob-controller" className="stat-label">使用デバイス</label>
              <input
                id="ob-controller"
                value={controller}
                onChange={(e) => setController(e.target.value)}
                placeholder="例: DualSense Edge / Viper V3 Pro など自由に入力"
                maxLength={40}
                list="device-suggestions"
              />
              <datalist id="device-suggestions">
                {CONTROLLER_GROUPS.flatMap(g => g.options).map(opt => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>入力を始めると候補が表示されます。リストにないデバイスは自由に入力できます。</p>
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
          </>
        )}

        <button type="submit" className="btn-primary btn-block btn-lg" disabled={loading}>
          {loading ? '保存中...' : 'この内容ではじめる'}
        </button>
      </form>
    </main>
  )
}
