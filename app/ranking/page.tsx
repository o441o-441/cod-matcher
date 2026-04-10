'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type ProfileRow = {
  id: string
  display_name: string | null
  current_rating: number | null
  wins: number | null
  losses: number | null
  rating_games_played: number | null
}

export default function RankingPage() {
  const router = useRouter()
  const [players, setPlayers] = useState<ProfileRow[]>([])
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const fetchRanking = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, current_rating, wins, losses, rating_games_played')
      .gt('rating_games_played', 0)
      .order('current_rating', { ascending: false })
      .limit(100)

    if (error) {
      console.error('ranking error:', error)
      setLoading(false)
      return
    }

    const profileList = (data || []) as ProfileRow[]
    setPlayers(profileList)

    const userIds = profileList.map((p) => p.id)
    if (userIds.length > 0) {
      const { data: memberData } = await supabase
        .from('team_members')
        .select('user_id, team_id')
        .in('user_id', userIds)

      if (memberData && memberData.length > 0) {
        const teamIds = [...new Set((memberData as { user_id: string; team_id: string }[]).map((m) => m.team_id))]
        const { data: teamsData } = await supabase
          .from('teams')
          .select('id, name')
          .in('id', teamIds)
          .eq('is_disbanded', false)

        const teamMap: Record<string, string> = {}
        for (const t of (teamsData || []) as { id: string; name: string }[]) {
          teamMap[t.id] = t.name
        }

        const userTeamMap: Record<string, string> = {}
        for (const m of memberData as { user_id: string; team_id: string }[]) {
          if (teamMap[m.team_id]) {
            userTeamMap[m.user_id] = teamMap[m.team_id]
          }
        }
        setTeamNames(userTeamMap)
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchRanking)
  }, [])

  if (loading) {
    return (
      <main>
        <h1>ランキング</h1>
        <LoadingCard message="ランキングを読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ランキング</h1>
          <p className="muted">個人レート順位</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {players.length === 0 ? (
          <EmptyCard title="まだランキングデータがありません" message="試合を行うとランキングに反映されます。" />
        ) : (
          <div className="stack">
            {players.map((p, index) => {
              const wins = p.wins ?? 0
              const losses = p.losses ?? 0
              const total = wins + losses
              const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0'

              return (
                <div key={p.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p className="muted">#{index + 1}</p>
                      <h3 style={{ marginTop: 0 }}>{p.display_name || '(名前未設定)'}</h3>
                      {teamNames[p.id] && (
                        <p className="muted" style={{ marginTop: 2 }}>{teamNames[p.id]}</p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <h3 style={{ marginTop: 0 }}>{p.current_rating ?? '-'}</h3>
                      <p className="muted">{wins}勝 {losses}敗 / 勝率 {winRate}%</p>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button onClick={() => router.push(`/users/${p.id}`)}>
                      プロフィール
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
