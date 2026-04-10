'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type MatchRow = {
  id: string
  status: string
  winner_match_team_id: string | null
  loser_match_team_id: string | null
  matched_at: string
}

type MatchTeamRow = {
  id: string
  match_id: string
  side: 'alpha' | 'bravo'
  display_name: string | null
}

export default function HistoryPage() {
  const router = useRouter()
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [matchTeams, setMatchTeams] = useState<MatchTeamRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('matches')
      .select('id, status, winner_match_team_id, loser_match_team_id, matched_at')
      .eq('status', 'completed')
      .order('matched_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('history error:', error)
      setLoading(false)
      return
    }

    const matchList = (data || []) as MatchRow[]
    setMatches(matchList)

    const matchIds = matchList.map((m) => m.id)

    if (matchIds.length > 0) {
      const { data: teams, error: teamsError } = await supabase
        .from('match_teams')
        .select('id, match_id, side, display_name')
        .in('match_id', matchIds)

      if (teamsError) {
        console.error('teams error:', teamsError)
      } else {
        setMatchTeams((teams || []) as MatchTeamRow[])
      }
    } else {
      setMatchTeams([])
    }

    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchHistory)
  }, [])

  const getTeamsForMatch = (matchId: string) => {
    return matchTeams.filter((t) => t.match_id === matchId)
  }

  const getTeamLabel = (teamId: string | null) => {
    if (!teamId) return '未確定'
    const team = matchTeams.find((t) => t.id === teamId)
    if (!team) return '不明'
    return `${team.side.toUpperCase()}${team.display_name ? ` (${team.display_name})` : ''}`
  }

  if (loading) {
    return (
      <main>
        <h1>マッチ履歴</h1>
        <LoadingCard message="履歴を読み込み中です..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>マッチ履歴</h1>
          <p className="muted">完了した試合の履歴です</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {matches.length === 0 ? (
          <EmptyCard title="履歴がありません" message="完了した試合がまだありません。" />
        ) : (
          <div className="stack">
            {matches.map((m) => {
              const teams = getTeamsForMatch(m.id)
              const alpha = teams.find((t) => t.side === 'alpha')
              const bravo = teams.find((t) => t.side === 'bravo')

              return (
                <div key={m.id} className="card">
                  <p>
                    <strong>対戦:</strong>{' '}
                    {alpha ? `ALPHA${alpha.display_name ? ` (${alpha.display_name})` : ''}` : '不明'}{' '}
                    vs{' '}
                    {bravo ? `BRAVO${bravo.display_name ? ` (${bravo.display_name})` : ''}` : '不明'}
                  </p>
                  <p>
                    <strong>勝者:</strong> {getTeamLabel(m.winner_match_team_id)}
                  </p>
                  <p className="muted">
                    {new Date(m.matched_at).toLocaleString('ja-JP')}
                  </p>
                  <div className="section row">
                    <button onClick={() => router.push(`/match/${m.id}/report`)}>
                      試合詳細
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
