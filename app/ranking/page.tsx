'use client'

import { useEffect, useRef, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type TeamRow = {
  id: string
  name: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

export default function RankingPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchRanking = async () => {
    const { data, error } = await supabase
      .from('teams')
      .select('id, name, rating, wins, losses, matches_played')
      .order('rating', { ascending: false })

    if (error) {
      console.error('ranking error:', error)
      setLoading(false)
      return
    }

    setTeams(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchRanking()

    const channel = supabase
      .channel('ranking-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'teams',
        },
        async () => {
          await fetchRanking()
        }
      )
      .subscribe()

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [])

  const getWinRate = (team: TeamRow) => {
    if (!team.matches_played) return '0.0'
    return ((team.wins / team.matches_played) * 100).toFixed(1)
  }

  if (loading) {
    return (
      <main>
        <h1>ランキング</h1>
        <LoadingCard />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ランキング</h1>
          <p className="muted">現在の順位一覧です</p>
        </div>

        <div className="row">
          <button onClick={() => router.push('/mypage')}>マイページへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>順位一覧</h2>

        {teams.length === 0 ? (
          <EmptyCard
            title="チームがまだありません"
            message="最初のチームが作成されると、ここにランキングが表示されます。"
          />
        ) : (
          <div className="stack">
            {teams.map((team, index) => (
              <div key={team.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <p>
                      <strong>順位:</strong> #{index + 1}
                    </p>
                    <h3>{team.name}</h3>
                    <p>
                      <strong>レート:</strong> {team.rating}
                    </p>
                    <p>
                      <strong>戦績:</strong> {team.wins}勝 {team.losses}敗
                    </p>
                    <p>
                      <strong>試合数:</strong> {team.matches_played}
                    </p>
                    <p>
                      <strong>勝率:</strong> {getWinRate(team)}%
                    </p>
                  </div>

                  <div className="row">
                    <button onClick={() => router.push(`/team/${team.id}`)}>
                      チーム詳細
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}