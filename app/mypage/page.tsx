'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type UserRow = {
  id: string
  auth_user_id: string
  display_name: string | null
  discord_id: string | null
  activision_id: string | null
  is_profile_complete: boolean | null
}

type TeamRow = {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  status: string
  approval_status: string | null
  reported_by_team_id?: string | null
  created_at: string
}

type TeamNameMap = Record<string, string>

export default function MyPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserRow | null>(null)
  const [team, setTeam] = useState<TeamRow | null>(null)
  const [pendingMatches, setPendingMatches] = useState<MatchRow[]>([])
  const [teamNames, setTeamNames] = useState<TeamNameMap>({})
  const [pageError, setPageError] = useState('')
  const [waitingCount, setWaitingCount] = useState<number>(0)

  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchWaitingCount = async () => {
    const { count, error } = await supabase
      .from('match_queue')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('fetchWaitingCount error:', error)
      return
    }

    setWaitingCount(count || 0)
  }

  const fetchPageData = async () => {
    setPageError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user) {
      router.push('/login')
      return
    }

    const user = session.user

    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (selectError || !existingUser) {
      console.error('selectError:', selectError)
      setPageError('ユーザー情報の取得に失敗しました')
      setLoading(false)
      return
    }

    if (!existingUser.is_profile_complete) {
      router.push('/onboarding')
      return
    }

    setProfile(existingUser)

    const { data: memberRow, error: memberError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', existingUser.id)
      .maybeSingle()

    if (memberError) {
      console.error('memberError:', memberError)
      setPageError('所属チーム情報の取得に失敗しました')
    }

    if (memberRow?.team_id) {
      const { data: teamRow, error: teamError } = await supabase
        .from('teams')
        .select(
          'id, name, owner_user_id, created_at, rating, wins, losses, matches_played'
        )
        .eq('id', memberRow.team_id)
        .single()

      if (teamError) {
        console.error('teamError:', teamError)
        setPageError('チーム情報の取得に失敗しました')
      } else {
        setTeam(teamRow)
      }

      const { data: pendingData, error: pendingError } = await supabase
        .from('matches')
        .select(
          'id, team1_id, team2_id, status, approval_status, reported_by_team_id, created_at'
        )
        .or(`team1_id.eq.${memberRow.team_id},team2_id.eq.${memberRow.team_id}`)
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false })

      if (pendingError) {
        console.error('pendingError:', pendingError)
        setPageError('未承認試合の取得に失敗しました')
      } else {
        const matchList = (pendingData || []) as MatchRow[]
        setPendingMatches(matchList)

        const uniqueTeamIds = Array.from(
          new Set(matchList.flatMap((m) => [m.team1_id, m.team2_id]))
        )

        if (uniqueTeamIds.length > 0) {
          const { data: teamsData, error: teamsError } = await supabase
            .from('teams')
            .select('id, name')
            .in('id', uniqueTeamIds)

          if (teamsError) {
            console.error('teamsError:', teamsError)
          } else {
            const map: TeamNameMap = {}
            for (const item of teamsData || []) {
              map[item.id] = item.name
            }
            setTeamNames(map)
          }
        } else {
          setTeamNames({})
        }
      }
    } else {
      setTeam(null)
      setPendingMatches([])
      setTeamNames({})
    }

    await fetchWaitingCount()
    setLoading(false)
  }

  useEffect(() => {
    fetchPageData()

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [router])

  useEffect(() => {
    const channel = supabase
      .channel(`mypage-realtime-global`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_queue',
        },
        async () => {
          await fetchWaitingCount()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
        },
        async () => {
          await fetchPageData()
        }
      )
      .subscribe((status) => {
        console.log('mypage realtime status:', status)
      })

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    showToast('ログアウトしました', 'info')
    router.push('/login')
  }

  const getOpponentId = (match: MatchRow, myTeamId: string) => {
    return match.team1_id === myTeamId ? match.team2_id : match.team1_id
  }

  const approvalNeededMatches = useMemo(() => {
    if (!team) return []
    return pendingMatches.filter((match) => match.reported_by_team_id !== team.id)
  }, [pendingMatches, team])

  const waitingOpponentMatches = useMemo(() => {
    if (!team) return []
    return pendingMatches.filter((match) => match.reported_by_team_id === team.id)
  }, [pendingMatches, team])

  if (loading) {
    return (
      <main>
        <h1>マイページ</h1>
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
          <h1>マイページ</h1>
          <p className="muted">チーム状況や対戦導線をここから管理します</p>
        </div>

        <div className="row">
          <span className="badge">ログイン中</span>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </div>

      {pageError && (
        <div className="section">
          <div className="card">
            <p className="danger">
              <strong>エラー:</strong> {pageError}
            </p>
          </div>
        </div>
      )}

      <div className="section grid grid-2">
        <div className="card-strong">
          <h2>プロフィール</h2>
          <div className="stack">
            <div className="card">
              <p className="muted">表示名</p>
              <h3>{profile?.display_name || '未設定'}</h3>
            </div>

            <div className="card">
              <p className="muted">Activision ID</p>
              <h3>{profile?.activision_id || '未設定'}</h3>
            </div>

            <div className="card">
              <p className="muted">Discord ID</p>
              <h3>{profile?.discord_id || '未設定'}</h3>
            </div>

            <div className="row">
              <button onClick={() => router.push('/profile/edit')}>
                プロフィールを編集
              </button>
            </div>
          </div>
        </div>

        <div className="card-strong">
          <h2>現在の状況</h2>
          <div className="stack">
            <p>
              <strong>待機中チーム数:</strong> {waitingCount}チーム
            </p>
            <p>
              <strong>あなたの承認待ち:</strong> {approvalNeededMatches.length}件
            </p>
            <p>
              <strong>相手の承認待ち:</strong> {waitingOpponentMatches.length}件
            </p>
          </div>
        </div>
      </div>

      {team && approvalNeededMatches.length > 0 && (
        <div className="section card-strong">
          <h2>あなたの承認が必要</h2>

          <div className="stack">
            {approvalNeededMatches.map((match) => {
              const opponentId = getOpponentId(match, team.id)
              const opponentName = teamNames[opponentId] || '不明'

              return (
                <div key={match.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <p>
                        <strong>対戦相手:</strong> {opponentName}
                      </p>
                      <p className="danger">
                        <strong>状態:</strong> あなたの承認待ち
                      </p>
                      <p>
                        <strong>試合日時:</strong>{' '}
                        {new Date(match.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="row">
                      <button onClick={() => router.push(`/match/${match.id}`)}>
                        承認しに行く
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {team && waitingOpponentMatches.length > 0 && (
        <div className="section card-strong">
          <h2>相手の承認待ち</h2>

          <div className="stack">
            {waitingOpponentMatches.map((match) => {
              const opponentId = getOpponentId(match, team.id)
              const opponentName = teamNames[opponentId] || '不明'

              return (
                <div key={match.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <p>
                        <strong>対戦相手:</strong> {opponentName}
                      </p>
                      <p className="muted">
                        <strong>状態:</strong> 相手の承認待ち
                      </p>
                      <p>
                        <strong>試合日時:</strong>{' '}
                        {new Date(match.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="row">
                      <button onClick={() => router.push(`/match/${match.id}`)}>
                        試合詳細へ
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="section">
        <div className="card-strong">
          <h2>所属チーム</h2>

          {team ? (
            <>
              <div className="grid grid-2">
                <div className="card">
                  <p className="muted">チーム名</p>
                  <h3>{team.name}</h3>
                </div>

                <div className="card">
                  <p className="muted">レート</p>
                  <h3>{team.rating}</h3>
                </div>

                <div className="card">
                  <p className="muted">戦績</p>
                  <h3>
                    {team.wins}勝 {team.losses}敗
                  </h3>
                </div>

                <div className="card">
                  <p className="muted">試合数</p>
                  <h3>{team.matches_played}</h3>
                </div>
              </div>

              <div className="section row">
                <button onClick={() => router.push('/team/edit')}>
                  チーム名を編集
                </button>
                <button onClick={() => router.push(`/team/${team.id}`)}>
                  チーム詳細を見る
                </button>
                <button onClick={() => router.push('/match')}>
                  対戦開始
                </button>
                <button onClick={() => router.push('/ranking')}>
                  ランキングを見る
                </button>
                <button onClick={() => router.push('/history')}>
                  マッチ履歴
                </button>
              </div>
            </>
          ) : (
            <>
              <p>まだチームに所属していません</p>
              <div className="section row">
                <button onClick={() => router.push('/team/create')}>
                  チームを作成
                </button>
                <button onClick={() => router.push('/team/join')}>
                  チームに参加
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}