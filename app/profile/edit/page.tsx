'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { CONTROLLER_GROUPS } from '@/lib/controllers'

type UserRow = {
  id: string
  auth_user_id: string
  display_name: string | null
  discord_id: string | null
  activision_id: string | null
  controller: string | null
  platform: string | null
  is_profile_complete: boolean | null
}

export default function ProfileEditPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<UserRow | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [activisionId, setActivisionId] = useState('')
  const [discordId, setDiscordId] = useState('')
  const [controller, setController] = useState('')
  const [platform, setPlatform] = useState('')
  const [bio, setBio] = useState('')
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  useEffect(() => {
    const fetchProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }
      setAuthUserId(session.user.id)

      const { data, error } = await supabase
        .from('users')
        .select('id, auth_user_id, display_name, discord_id, activision_id, controller, platform, is_profile_complete')
        .eq('auth_user_id', session.user.id)
        .single()

      if (error || !data) {
        console.error('fetchProfile error:', error)
        showToast('プロフィールの取得に失敗しました', 'error')
        router.push('/mypage')
        return
      }

      setProfile(data)
      setDisplayName(data.display_name || '')
      setActivisionId(data.activision_id || '')
      setDiscordId(data.discord_id || '')
      setController(data.controller || '')
      setPlatform(data.platform || '')

      const { data: prof } = await supabase
        .from('profiles')
        .select('bio')
        .eq('id', session.user.id)
        .maybeSingle<{ bio: string | null }>()
      setBio(prof?.bio ?? '')

      setLoading(false)
    }

    fetchProfile()
  }, [router, showToast])

  const handleSave = async () => {
    if (!profile) {
      showToast('プロフィール情報が見つかりません', 'error')
      return
    }

    const trimmedDisplayName = displayName.trim()
    const trimmedActivisionId = activisionId.trim()

    if (!trimmedDisplayName) {
      showToast('表示名を入力してください', 'error')
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from('users')
      .update({
        display_name: trimmedDisplayName,
        activision_id: trimmedActivisionId || null,
        controller: controller || null,
        platform: platform || null,
      })
      .eq('id', profile.id)

    if (error) {
      console.error('save profile error:', error)
      if (error.code === '23505') {
        showToast('既に使われている名前です。別の名前を入力してください。', 'error')
      } else {
        showToast('プロフィール更新に失敗しました', 'error')
      }
      setSaving(false)
      return
    }

    if (authUserId) {
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          display_name: trimmedDisplayName,
          bio: bio.trim() || null,
        })
        .eq('id', authUserId)
      if (profileErr) {
        console.error('save profile error:', profileErr)
        if (profileErr.code === '23505') {
          showToast('既に使われている名前です。別の名前を入力してください。', 'error')
        } else {
          showToast('プロフィール更新に失敗しました', 'error')
        }
        setSaving(false)
        return
      }
    }

    showToast('プロフィールを更新しました', 'success')
    setSaving(false)
    router.push('/mypage')
  }

  if (loading) {
    return (
      <main>
        <div className="eyebrow">EDIT PROFILE</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Edit</em> Profile
        </h1>
        <p className="muted">読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">EDIT PROFILE</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Edit</em> Profile
      </h1>
      <p className="muted">表示名と Activision ID を編集できます</p>

      <div className="section" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="card-strong">
          <div className="sec-title">アカウント情報</div>

          <div className="stack">
            <div>
              <label className="stat-label">DISPLAY NAME</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="表示名を入力"
                style={{ marginTop: 6 }}
              />
            </div>

            <div>
              <label className="stat-label">ACTIVISION ID</label>
              <input
                value={activisionId}
                onChange={(e) => setActivisionId(e.target.value)}
                placeholder="Activision IDを入力"
                style={{ marginTop: 6 }}
              />
            </div>

            <div>
              <label className="stat-label">DEVICE</label>
              <select
                value={controller}
                onChange={(e) => setController(e.target.value)}
                style={{ marginTop: 6 }}
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
              <label className="stat-label">PLATFORM</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                style={{ marginTop: 6 }}
              >
                <option value="">選択してください</option>
                <option value="Battle.net">Battle.net</option>
                <option value="Steam">Steam</option>
                <option value="PlayStation">PlayStation</option>
                <option value="Xbox">Xbox</option>
              </select>
            </div>

            <div>
              <label className="stat-label">DISCORD ID</label>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text-strong)' }}>
                {discordId || '未設定'}
              </div>
              <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Discord ID はログイン情報のため編集できません
              </p>
            </div>

            <div>
              <label className="stat-label">BIO</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="プレイスタイルや得意な役割など、自由に書いてください"
                rows={5}
                style={{ marginTop: 6 }}
              />
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn-ghost" onClick={() => router.push('/mypage')}>
              キャンセル
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
