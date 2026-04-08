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
        router.push('/mypage')
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
    router.push('/mypage')
  }

  if (checking) {
    return (
      <main style={{ padding: '40px' }}>
        <h1>チーム作成</h1>
        <p>確認中...</p>
      </main>
    )
  }

  if (!canCreate) {
    return (
      <main style={{ padding: '40px' }}>
        <h1>チーム作成</h1>
        <p>チームを作成できません。</p>
      </main>
    )
  }

  return (
    <main style={{ padding: '40px' }}>
      <h1>チーム作成</h1>

      <div style={{ marginTop: '20px' }}>
        <p>チーム名</p>
        <input
          value={teamName}
          onChange={e => setTeamName(e.target.value)}
          placeholder="チーム名を入力"
        />
      </div>

      <div style={{ marginTop: '20px' }}>
        <button onClick={handleCreateTeam} disabled={loading}>
          {loading ? '作成中...' : 'チームを作成'}
        </button>
      </div>
    </main>
  )
}
