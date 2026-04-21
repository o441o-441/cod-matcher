'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function CreateTeamPage() {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [canCreate, setCanCreate] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)

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
        alert('所属チームの確認に失敗しました')
        setChecking(false)
        return
      }

      if (existingMembership?.team_id) {
        alert('すでにチームに所属しているため、新しくチームを作成できません')
        router.push('/menu')
        return
      }

      setCanCreate(true)
      setChecking(false)
    }

    checkExistingTeam()
  }, [router])

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      alert('チーム名を入力してください')
      return
    }

    if (!myUserId) {
      alert('ユーザー情報が取得できません')
      return
    }

    setLoading(true)

    const { data, error } = await supabase.rpc('create_team_atomic', {
      p_team_name: teamName,
      p_owner_user_id: myUserId,
    })

    if (error) {
      console.error('create_team_atomic error:', error)
      alert(error.message || 'チーム作成に失敗しました')
      setLoading(false)
      return
    }

    console.log('create team result:', data)

    alert('チームを作成しました！')
    router.push('/menu')
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

  if (!canCreate) {
    return (
      <main>
        <div className="eyebrow">CREATE TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Create</em> Team
        </h1>
        <p className="muted">チームを作成できません。</p>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">CREATE TEAM</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Create</em> Team
      </h1>
      <p className="muted">新しいチームを作成します</p>

      <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
        <div className="card-strong">
          <div className="sec-title">チーム情報</div>

          <div className="stack">
            <div>
              <label className="stat-label">TEAM NAME</label>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="チーム名を入力"
                style={{ marginTop: 6 }}
              />
            </div>

            <button
              className="btn-primary btn-block btn-lg"
              onClick={handleCreateTeam}
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              {loading ? '作成中...' : 'チームを作成'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
