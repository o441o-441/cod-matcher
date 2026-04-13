'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'
import { usePageView } from '@/lib/usePageView'

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

type MatchTeamMemberRow = {
  id: string
  match_team_id: string
  user_id: string
  profiles?: {
    id: string
    display_name: string
  } | null
}

export default function HistoryPage() {
  const router = useRouter()
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [matchTeams, setMatchTeams] = useState<MatchTeamRow[]>([])
  const [members, setMembers] = useState<MatchTeamMemberRow[]>([])
  const [loading, setLoading] = useState(true)

  usePageView('/history')

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
        const teamRows = (teams || []) as MatchTeamRow[]
        setMatchTeams(teamRows)

        const teamIds = teamRows.map((t) => t.id)
        if (teamIds.length > 0) {
          const { data: membersData, error: membersError } = await supabase
            .from('match_team_members')
            .select('id, match_team_id, user_id, profiles!match_team_members_user_id_fkey(id, display_name)')
            .in('match_team_id', teamIds)

          if (membersError) {
            console.error('members error:', membersError)
          } else {
            setMembers((membersData || []) as unknown as MatchTeamMemberRow[])
          }
        }
      }
    } else {
      setMatchTeams([])
      setMembers([])
    }

    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchHistory)
  }, [])

  const getMemberNames = (matchTeamId: string): string => {
    const teamMembers = members.filter((m) => m.match_team_id === matchTeamId)
    if (teamMembers.length === 0) return '不明'
    return teamMembers
      .map((m) => m.profiles?.display_name ?? m.user_id.slice(0, 8))
      .join(', ')
  }

  const getWinnerNames = (winnerTeamId: string | null): string => {
    if (!winnerTeamId) return '未確定'
    return getMemberNames(winnerTeamId)
  }

  if (loading) {
    return (
      <main>
        <h1>ASCENT マッチ履歴</h1>
        <LoadingCard message="履歴を読み込み中です..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT マッチ履歴</h1>
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
              const teams = matchTeams.filter((t) => t.match_id === m.id)
              const alpha = teams.find((t) => t.side === 'alpha')
              const bravo = teams.find((t) => t.side === 'bravo')

              return (
                <div key={m.id} className="card">
                  <div className="grid grid-2">
                    <div>
                      <p className="muted">ALPHA</p>
                      <p><strong>{alpha ? getMemberNames(alpha.id) : '不明'}</strong></p>
                    </div>
                    <div>
                      <p className="muted">BRAVO</p>
                      <p><strong>{bravo ? getMemberNames(bravo.id) : '不明'}</strong></p>
                    </div>
                  </div>
                  <p style={{ marginTop: 8 }}>
                    <strong>勝者:</strong> {getWinnerNames(m.winner_match_team_id)}
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
