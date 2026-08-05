'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

const MAX_NAME_LEN = 30

export default function CreateTeamPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [existingTeamId, setExistingTeamId] = useState<string | null>(null)

  useEffect(() => {
    const checkExistingTeam = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      const authUserId = session.user.id
      setMyUserId(authUserId)

      const { data: existingMembership, error: membershipError } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', authUserId)
        .maybeSingle()

      if (membershipError) {
        console.error('membershipError:', membershipError)
        showToast('所属チームの確認に失敗しました', 'error')
        setChecking(false)
        return
      }

      setExistingTeamId(existingMembership?.team_id ?? null)
      setChecking(false)
    }

    checkExistingTeam()
  }, [router, showToast])

  const handleCreateTeam = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = teamName.trim()

    if (trimmed.length < 2) {
      showToast('チーム名は2文字以上で入力してください', 'error')
      return
    }
    if (trimmed.length > MAX_NAME_LEN) {
      showToast(`チーム名は${MAX_NAME_LEN}文字以内にしてください`, 'error')
      return
    }
    if (!myUserId) {
      showToast('ユーザー情報が取得できません', 'error')
      return
    }

    setLoading(true)

    const { data, error } = await supabase.rpc('create_team_atomic', {
      p_team_name: trimmed,
      p_owner_user_id: myUserId,
    })

    if (error) {
      console.error('create_team_atomic error:', error)
      showToast(error.message || 'チーム作成に失敗しました', 'error')
      setLoading(false)
      return
    }

    showToast('チームを作成しました！次はメンバーを招待しましょう', 'success')
    const teamId = (data as { team_id?: string } | null)?.team_id
    router.push(teamId ? `/team/${teamId}` : '/menu')
  }

  if (checking) {
    return (
      <main>
        <div className="eyebrow">CREATE TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Create</em> Team
        </h1>
        <p className="muted">確認中...</p>
      </main>
    )
  }

  if (existingTeamId) {
    return (
      <main>
        <div className="eyebrow">CREATE TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Create</em> Team
        </h1>

        <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div className="card-strong">
            <div className="sec-title">すでにチームに所属しています</div>
            <p className="muted" style={{ marginTop: 0 }}>
              新しいチームを作成するには、先に現在のチームから脱退してください。
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={() => router.push(`/team/${existingTeamId}`)}>
                自分のチームを見る
              </button>
              <button className="btn-ghost" onClick={() => router.push('/menu')}>
                メニューへ戻る
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">CREATE TEAM</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Create</em> Team
      </h1>
      <p className="muted">新しいチームを作成します（メンバーは最大5人）</p>

      <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
        <form className="card-strong" onSubmit={handleCreateTeam}>
          <div className="sec-title">チーム情報</div>

          <div className="stack">
            <div>
              <div className="rowx">
                <label htmlFor="team-name" className="stat-label">TEAM NAME</label>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {teamName.trim().length}/{MAX_NAME_LEN}
                </span>
              </div>
              <input
                id="team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="チーム名を入力（2〜30文字）"
                maxLength={MAX_NAME_LEN}
                style={{ marginTop: 6 }}
              />
            </div>

            <button
              type="submit"
              className="btn-primary btn-block btn-lg"
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              {loading ? '作成中...' : 'チームを作成'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
