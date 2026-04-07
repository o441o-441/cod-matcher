'use client'

import { useEffect, useRef, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  winner_team_id: string | null
  loser_team_id: string | null
  status: string
  created_at: string
}

type TeamMap = Record<string, string>

export default function HistoryPage() {
  const router = useRouter()
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamNames, setTeamNames] = useState<TeamMap>({})
  const [loading, setLoading] = useState(true)
  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('matches')
      .select('id, team1_id, team2_id, winner_team_id, loser_team_id, status, created_at')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('history error:', error)
      setLoading(false)
      return
    }

    const matchList = data || []
    setMatches(matchList)

    const teamIds = Array.from(
      new Set(matchList.flatMap((m) => [m.team1_id, m.team2_id])),
    )

    if (teamIds.length > 0) {
      const { data: teams, error: teamError } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', teamIds)

      if (teamError) {
        console.error('teamError:', teamError)
      } else {
        const map: TeamMap = {}
        for (const team of teams || []) {
          map[team.id] = team.name
        }
        setTeamNames(map)
      }
    } else {
      setTeamNames({})
    }

    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchHistory)

    const channel = supabase
      .channel('history-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
        },
        async (payload) => {
          const newRow = payload.new as MatchRow
          if (newRow.status === 'completed') {
            await fetchHistory()
          }
        },
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

  if (loading) {
    return (
      <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
        <h1>マッチ履歴</h1>
        <LoadingCard message="履歴を読み込み中です..." />
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
      <h1>マッチ履歴</h1>

      <p>完了した試合の履歴です</p>

      <div style={{ marginTop: 12 }}>
        <button onClick={() => router.push('/mypage')}>マイページへ戻る</button>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>履歴一覧</h2>

        {matches.length === 0 ? (
          <EmptyCard title="履歴がありません" message="完了した試合がまだありません。" />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {matches.map((m) => (
              <div
                key={m.id}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div>
                  <strong>対戦:</strong> {teamNames[m.team1_id] || '不明'} vs{' '}
                  {teamNames[m.team2_id] || '不明'}
                </div>

                <div style={{ marginTop: 6 }}>
                  <strong>勝者:</strong> {teamNames[m.winner_team_id || ''] || '未確定'}
                </div>

                <div style={{ marginTop: 6 }}>
                  <strong>日時:</strong> {new Date(m.created_at).toLocaleString('ja-JP')}
                </div>

                <div style={{ marginTop: 12 }}>
                  <button onClick={() => router.push(`/match/${m.id}/report`)}>
                    試合詳細
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}