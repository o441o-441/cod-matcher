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

      // 自分取得
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', session.user.id)
        .single()

      if (!userData) {
        router.push('/mypage')
        return
      }

      // チーム取得
      const { data: member } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userData.id)
        .single()

      if (!member) {
        showToast('チームに所属していません', 'error')
        router.push('/mypage')
        return
      }

      const { data: teamData } = await supabase
        .from('teams')
        .select('id, name, owner_user_id')
        .eq('id', member.team_id)
        .single()

      if (!teamData) {
        router.push('/mypage')
        return
      }

      // オーナーチェック
      if (teamData.owner_user_id !== userData.id) {
        showToast('チーム編集はオーナーのみ可能です', 'error')
        router.push('/mypage')
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

    const { error } = await supabase
      .from('teams')
      .update({ name: trimmed })
      .eq('id', team.id)

    if (error) {
      console.error(error)
      showToast('更新に失敗しました', 'error')
      setSaving(false)
      return
    }

    showToast('チーム名を変更しました', 'success')
    router.push('/mypage')
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
        <button onClick={() => router.push('/mypage')}>
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
              <button onClick={() => router.push('/mypage')}>
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