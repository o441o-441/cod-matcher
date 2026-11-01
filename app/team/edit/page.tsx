'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type TeamRow = {
  id: string
  name: string
  owner_user_id: string
  roster_mode: 'members' | 'solo'
  guest_game_ids: string[]
}

const MAX_GUEST_IDS = 6
const MAX_GUEST_ID_LEN = 40

export default function TeamEditPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [teamName, setTeamName] = useState('')
  const [guestIds, setGuestIds] = useState<string[]>([])
  const [savingGuests, setSavingGuests] = useState(false)

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      const currentUserId = session.user.id

      // チーム取得
      const { data: member } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', currentUserId)
        .single()

      if (!member) {
        showToast('チームに所属していません', 'error')
        router.push('/menu')
        return
      }

      const { data: teamData } = await supabase
        .from('teams')
        .select('id, name, owner_user_id, roster_mode, guest_game_ids')
        .eq('id', member.team_id)
        .single()

      if (!teamData) {
        router.push('/menu')
        return
      }

      // オーナーチェック
      if (teamData.owner_user_id !== currentUserId) {
        showToast('チーム編集はオーナーのみ可能です', 'error')
        router.push('/menu')
        return
      }

      setTeam(teamData)
      setTeamName(teamData.name)
      setGuestIds(
        teamData.roster_mode === 'solo' && (teamData.guest_game_ids?.length ?? 0) > 0
          ? teamData.guest_game_ids
          : ['', '', '']
      )
      setLoading(false)
    }

    init()
  }, [router, showToast])

  const handleSave = async () => {
    if (!team) return

    const trimmed = teamName.trim()

    if (!trimmed) {
      showToast('チーム名を入力してください', 'error')
      return
    }

    if (trimmed.length > 30) {
      showToast('チーム名は30文字以内にしてください', 'error')
      return
    }

    setSaving(true)

    const { data, error } = await supabase
      .from('teams')
      .update({ name: trimmed })
      .eq('id', team.id)
      .select('id, name')

    if (error) {
      console.error(error)
      if (error.code === '23505') {
        showToast('既に使われている名前です。別の名前を入力してください。', 'error')
      } else {
        showToast(error.message || '更新に失敗しました', 'error')
      }
      setSaving(false)
      return
    }

    if (!data || data.length === 0) {
      console.error('teams update returned 0 rows', { teamId: team.id })
      showToast(
        '更新権限がありません（RLSで弾かれた可能性があります）',
        'error'
      )
      setSaving(false)
      return
    }

    showToast('チーム名を変更しました', 'success')
    router.push('/menu')
  }

  const handleSaveGuests = async () => {
    if (!team) return
    const clean = guestIds.map(g => g.trim()).filter(Boolean)
    if (clean.length < 3) {
      showToast('メンバーのゲームIDを3人分以上入力してください', 'error')
      return
    }
    if (new Set(clean).size !== clean.length) {
      showToast('同じゲームIDが重複しています', 'error')
      return
    }

    setSavingGuests(true)
    const { error } = await supabase.rpc('rpc_update_guest_ids', {
      p_team_id: team.id,
      p_guest_ids: clean,
    })
    setSavingGuests(false)

    if (error) {
      console.error(error)
      showToast(error.message || 'ゲームIDの更新に失敗しました', 'error')
      return
    }
    showToast('メンバーのゲームIDを更新しました', 'success')
  }

  if (loading) {
    return (
      <main>
        <div className="eyebrow">EDIT TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Edit</em> Team
        </h1>
        <p className="muted">読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">EDIT TEAM</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Edit</em> Team
      </h1>
      <p className="muted">
        {team?.roster_mode === 'solo' ? 'チーム名とメンバーのゲームIDを変更できます' : 'チーム名を変更できます'}
      </p>

      <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
        <div className="card-strong">
          <div className="sec-title">チーム名変更</div>

          <div className="stack">
            <div>
              <label className="stat-label">TEAM NAME</label>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                style={{ marginTop: 6 }}
              />
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn-ghost" onClick={() => router.push('/menu')}>
                キャンセル
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>

        {team?.roster_mode === 'solo' && (
          <div className="card-strong" style={{ marginTop: 16 }}>
            <div className="rowx">
              <div className="sec-title" style={{ marginBottom: 0 }}>メンバーのゲームID（3人分以上）</div>
              {guestIds.length < MAX_GUEST_IDS && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '2px 10px' }}
                  onClick={() => setGuestIds([...guestIds, ''])}
                >
                  ＋ 追加
                </button>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              ASCENT登録不要のメンバーです。交流戦・大会のロスターとして表示されます
            </p>

            <div className="stack" style={{ gap: 6 }}>
              {guestIds.map((g, i) => (
                <div key={i} className="row" style={{ gap: 6 }}>
                  <input
                    value={g}
                    onChange={(e) => {
                      const next = [...guestIds]
                      next[i] = e.target.value
                      setGuestIds(next)
                    }}
                    placeholder={`メンバー${i + 2}のゲームID`}
                    maxLength={MAX_GUEST_ID_LEN}
                    style={{ flex: 1 }}
                  />
                  {guestIds.length > 3 && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: '2px 10px' }}
                      onClick={() => setGuestIds(guestIds.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-primary" onClick={handleSaveGuests} disabled={savingGuests}>
                {savingGuests ? '保存中...' : 'ゲームIDを保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
