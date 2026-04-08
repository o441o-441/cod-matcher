'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type TeamRow = {
  id: string
  name: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

export default function TeamJoinPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)

  const [teamIdInput, setTeamIdInput] = useState('')
  const [previewTeam, setPreviewTeam] = useState<TeamRow | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      setMyUserId(session.user.id)
      setLoading(false)
    }

    init()
  }, [router, showToast])

  const handleSearchTeam = async () => {
    const trimmed = teamIdInput.trim()

    if (!trimmed) {
      showToast('チームIDを入力してください', 'error')
      return
    }

    setSearching(true)
    setPreviewTeam(null)

    const { data, error } = await supabase
      .from('teams')
      .select('id, name, rating, wins, losses, matches_played')
      .eq('id', trimmed)
      .maybeSingle()

    if (error) {
      console.error(error)
      showToast('チーム検索に失敗しました', 'error')
      setSearching(false)
      return
    }

    if (!data) {
      showToast('チームが見つかりません', 'error')
      setSearching(false)
      return
    }

    setPreviewTeam(data)
    setSearching(false)
    showToast('チームが見つかりました', 'success')
  }

  const handleJoinTeam = async () => {
    if (!myUserId || !previewTeam) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    setJoining(true)

    const { error } = await supabase.rpc('join_team_atomic', {
      p_team_id: previewTeam.id,
      p_user_id: myUserId,
    })

    if (error) {
      console.error(error)
      showToast(error.message || 'チーム参加に失敗しました', 'error')
      setJoining(false)
      return
    }

    showToast('チームに参加しました', 'success')
    router.push('/mypage')
  }

  if (loading) {
    return (
      <main>
        <h1>チーム参加</h1>
        <div className="card">
          <p>読み込み中...</p>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>チーム参加</h1>
          <p className="muted">チームIDを入力して参加します</p>
        </div>

        <div className="row">
          <button onClick={() => router.push('/mypage')}>マイページへ戻る</button>
        </div>
      </div>

      <div className="section" style={{ maxWidth: '760px', margin: '0 auto' }}>
        <div className="card-strong">
          <h2>参加するチームを探す</h2>

          <div className="stack">
            <div className="card">
              <p className="muted">チームID</p>
              <input
                value={teamIdInput}
                onChange={(e) => setTeamIdInput(e.target.value)}
                placeholder="チームIDを貼り付け"
              />
            </div>

            <div className="row">
              <button onClick={handleSearchTeam} disabled={searching}>
                {searching ? '検索中...' : '検索'}
              </button>
            </div>

            {previewTeam && (
              <div className="card">
                <p><strong>チーム名:</strong> {previewTeam.name}</p>
                <p><strong>レート:</strong> {previewTeam.rating}</p>
                <p>
                  <strong>戦績:</strong> {previewTeam.wins}勝 {previewTeam.losses}敗
                </p>
                <p><strong>試合数:</strong> {previewTeam.matches_played}</p>

                <div className="section row">
                  <button onClick={handleJoinTeam} disabled={joining}>
                    {joining ? '参加中...' : 'このチームに参加'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}