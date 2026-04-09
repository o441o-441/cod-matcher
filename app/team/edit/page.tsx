'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type TeamRow = {
  id: string
  name: string
  owner_user_id: string
}

export default function TeamEditPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [teamName, setTeamName] = useState('')

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
        .select('id, name, owner_user_id')
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
      showToast(error.message || '更新に失敗しました', 'error')
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

  if (loading) {
    return (
      <main>
        <h1>チーム編集</h1>
        <div className="card">
          <p>読み込み中...</p>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>チーム編集</h1>
        <button onClick={() => router.push('/menu')}>
          戻る
        </button>
      </div>

      <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
        <div className="card-strong">
          <h2>チーム名変更</h2>

          <div className="stack">
            <div className="card">
              <p className="muted">チーム名</p>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => router.push('/menu')}>
                キャンセル
              </button>
              <button onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}