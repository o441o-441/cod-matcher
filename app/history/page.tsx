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
        <p className="eyebrow">MATCH HISTORY</p>
        <h1 className="display"><em>マッチ履歴</em></h1>
        <LoadingCard message="履歴を読み込み中です..." />
      </main>
    )
  }

  return (
    <main>
      <p className="eyebrow">MATCH HISTORY</p>
      <h1 className="display"><em>マッチ履歴</em></h1>
      <p className="muted">完了した試合の履歴です</p>

      <div className="section">
        {matches.length === 0 ? (
          <EmptyCard title="履歴がありません" message="完了した試合がまだありません。" />
        ) : (
          <div className="stack">
            {matches.map((m) => {
              const teams = matchTeams.filter((t) => t.match_id === m.id)
              const alpha = teams.find((t) => t.side === 'alpha')
              const bravo = teams.find((t) => t.side === 'bravo')
              const alphaWon = alpha && m.winner_match_team_id === alpha.id
              const bravoWon = bravo && m.winner_match_team_id === bravo.id

              return (
                <div
                  key={m.id}
                  className="card glow-hover"
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/match/${m.id}/report`)}
                >
                  <div className="grid grid-2">
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="side-chip alpha">ALPHA</span>
                        {alphaWon && <span className="badge" style={{ color: 'var(--cyan)' }}>W</span>}
                        {alpha && m.loser_match_team_id === alpha.id && <span className="badge magenta">L</span>}
                      </div>
                      <p style={{ margin: '6px 0 0' }}><strong>{alpha ? getMemberNames(alpha.id) : '不明'}</strong></p>
                    </div>
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="side-chip bravo">BRAVO</span>
                        {bravoWon && <span className="badge" style={{ color: 'var(--cyan)' }}>W</span>}
                        {bravo && m.loser_match_team_id === bravo.id && <span className="badge magenta">L</span>}
                      </div>
                      <p style={{ margin: '6px 0 0' }}><strong>{bravo ? getMemberNames(bravo.id) : '不明'}</strong></p>
                    </div>
                  </div>
                  <div className="div" />
                  <div className="rowx">
                    <p className="dim mono" style={{ fontSize: '0.75rem', margin: 0 }}>
                      {new Date(m.matched_at).toLocaleString('ja-JP')}
                    </p>
                    <p className="muted" style={{ margin: 0 }}>
                      <strong>勝者:</strong> {getWinnerNames(m.winner_match_team_id)}
                    </p>
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
