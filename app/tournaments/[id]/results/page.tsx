'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingSkeleton } from '@/components/UIState'

type MatchRow = {
  id: string; round: number; match_number: number
  entry_a_id: string | null; entry_b_id: string | null
  winner_entry_id: string | null; loser_entry_id: string | null
  score_a: number; score_b: number; status: string; bracket_side: string
  completed_at: string | null
}

type TeamInfo = {
  entryId: string
  teamName: string
  members: { displayName: string; weaponClass: string | null; rating: number | null }[]
  avgRating: number
  wins: number
  losses: number
  roundsWon: number
  roundsLost: number
  placement: number | null
}

export default function ResultsPage() {
  const params = useParams()
  const router = useRouter()
  const tournamentId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [tournamentTitle, setTournamentTitle] = useState('')
  const [entryMode, setEntryMode] = useState('team')
  const [winnerEntryId, setWinnerEntryId] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])

  useEffect(() => {
    if (!tournamentId) return
    const load = async () => {
      const [{ data: t }, { data: matchData }, { data: entries }] = await Promise.all([
        supabase.from('tournaments').select('title, entry_mode, winner_info').eq('id', tournamentId).maybeSingle(),
        supabase.from('tournament_matches').select('*').eq('tournament_id', tournamentId).eq('status', 'completed').order('round').order('match_number'),
        supabase.from('tournament_entries').select('id, team_id, user_id, assigned_team_name, assigned_team_index, weapon_class, rating_at_entry, status').eq('tournament_id', tournamentId),
      ])

      const tData = t as { title: string; entry_mode: string; winner_info: { entry_id?: string } | null } | null
      setTournamentTitle(tData?.title ?? '')
      setEntryMode(tData?.entry_mode ?? 'team')
      setWinnerEntryId(tData?.winner_info?.entry_id ?? null)

      const completedMatches = (matchData ?? []) as MatchRow[]
      setMatches(completedMatches)

      const entryRows = (entries ?? []) as { id: string; team_id: string | null; user_id: string | null; assigned_team_name: string | null; assigned_team_index: number | null; weapon_class: string | null; rating_at_entry: number | null; status: string }[]

      // ユーザー名取得
      const allUserIds = entryRows.filter(e => e.user_id).map(e => e.user_id!)
      const allTeamIds = entryRows.filter(e => e.team_id).map(e => e.team_id!)

      const [{ data: profiles }, { data: dbTeams }] = await Promise.all([
        allUserIds.length > 0 ? supabase.from('profiles').select('id, display_name').in('id', allUserIds) : Promise.resolve({ data: [] }),
        allTeamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', allTeamIds) : Promise.resolve({ data: [] }),
      ])

      const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? '不明']))
      const teamNameMap = new Map((dbTeams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))

      // チーム情報構築
      const teamInfoMap = new Map<string, TeamInfo>()

      if (tData?.entry_mode === 'solo') {
        const teamGroups = new Map<number, typeof entryRows>()
        for (const e of entryRows) {
          if (e.assigned_team_index) {
            const group = teamGroups.get(e.assigned_team_index) ?? []
            group.push(e)
            teamGroups.set(e.assigned_team_index, group)
          }
        }
        for (const [, group] of teamGroups) {
          const rep = group[0]
          const members = group.map(e => ({
            displayName: profileMap.get(e.user_id!) ?? '不明',
            weaponClass: e.weapon_class,
            rating: e.rating_at_entry,
          }))
          const avgRating = members.length > 0 ? Math.round(members.reduce((s, m) => s + (m.rating ?? 0), 0) / members.length) : 0
          const info: TeamInfo = {
            entryId: rep.id,
            teamName: rep.assigned_team_name ?? `Team ${rep.assigned_team_index}`,
            members, avgRating,
            wins: 0, losses: 0, roundsWon: 0, roundsLost: 0, placement: null,
          }
          for (const e of group) teamInfoMap.set(e.id, info)
        }
      } else {
        for (const e of entryRows) {
          const name = e.team_id ? teamNameMap.get(e.team_id) ?? '不明' : profileMap.get(e.user_id!) ?? '不明'
          teamInfoMap.set(e.id, {
            entryId: e.id, teamName: name,
            members: [{ displayName: name, weaponClass: null, rating: e.rating_at_entry }],
            avgRating: e.rating_at_entry ?? 0,
            wins: 0, losses: 0, roundsWon: 0, roundsLost: 0, placement: null,
          })
        }
      }

      // 戦績集計
      for (const m of completedMatches) {
        if (m.winner_entry_id) {
          const winner = teamInfoMap.get(m.winner_entry_id)
          if (winner) { winner.wins++; winner.roundsWon += m.score_a > m.score_b ? m.score_a : m.score_b; winner.roundsLost += m.score_a > m.score_b ? m.score_b : m.score_a }
        }
        if (m.loser_entry_id) {
          const loser = teamInfoMap.get(m.loser_entry_id)
          if (loser) { loser.losses++; loser.roundsWon += m.score_a < m.score_b ? m.score_a : m.score_b; loser.roundsLost += m.score_a < m.score_b ? m.score_b : m.score_a }
        }
      }

      // 重複を除去してユニークなチームリストを作成
      const uniqueTeams = [...new Map([...teamInfoMap.values()].map(t => [t.entryId, t])).values()]

      // 順位付け: 勝利数→得失ラウンド差→平均レート
      uniqueTeams.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins
        const aDiff = a.roundsWon - a.roundsLost
        const bDiff = b.roundsWon - b.roundsLost
        if (bDiff !== aDiff) return bDiff - aDiff
        return b.avgRating - a.avgRating
      })

      // 優勝者を1位に
      const winnerIdx = uniqueTeams.findIndex(t => winnerEntryId && teamInfoMap.get(winnerEntryId)?.entryId === t.entryId)
      if (winnerIdx > 0) {
        const [winner] = uniqueTeams.splice(winnerIdx, 1)
        uniqueTeams.unshift(winner)
      }

      uniqueTeams.forEach((t, i) => { t.placement = i + 1 })
      setTeams(uniqueTeams)
      setLoading(false)
    }
    void load()
  }, [tournamentId, winnerEntryId])

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  const WEAPON_LABEL: Record<string, string> = { ar: 'AR', smg: 'SMG', flex: 'FLEX' }
  const WEAPON_COLOR: Record<string, string> = { ar: 'var(--cyan)', smg: 'var(--magenta)', flex: 'var(--violet, #8b5cf6)' }

  const medalStyle = (p: number | null) => {
    if (p === 1) return { color: 'var(--gold, #ffd700)', borderColor: 'var(--gold, #ffd700)' }
    if (p === 2) return { color: '#c0c0c0', borderColor: '#c0c0c0' }
    if (p === 3) return { color: '#cd7f32', borderColor: '#cd7f32' }
    return {}
  }

  return (
    <main>
      <div className="eyebrow">RESULTS</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', marginTop: 6 }}>
        <em>{tournamentTitle}</em>
      </h1>
      <p className="muted">大会結果・チーム戦績</p>

      <div className="section row" style={{ gap: 8 }}>
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}`)}>← 大会詳細</button>
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}/bracket`)}>ブラケット</button>
      </div>

      {/* 順位表 */}
      <div className="section">
        <p className="sec-title">最終順位</p>
        <div className="stack">
          {teams.map(t => {
            const isChampion = t.placement === 1 && winnerEntryId
            const style = medalStyle(t.placement)
            return (
              <div
                key={t.entryId}
                className="card-strong"
                style={{
                  borderLeft: `4px solid ${style.borderColor ?? 'var(--line)'}`,
                  ...(isChampion ? { boxShadow: '0 0 20px rgba(255,215,0,0.15)' } : {}),
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="row" style={{ gap: 10, marginBottom: 6 }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800,
                        color: style.color ?? 'var(--text-soft)', minWidth: 32,
                      }}>
                        #{t.placement}
                      </span>
                      <div>
                        <div className="row" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{t.teamName}</span>
                          {isChampion && (
                            <span className="badge" style={{ fontSize: 9, background: 'rgba(255,215,0,0.15)', color: 'var(--gold, #ffd700)' }}>CHAMPION</span>
                          )}
                        </div>
                        <span className="mono muted" style={{ fontSize: 11 }}>avg {t.avgRating}</span>
                      </div>
                    </div>

                    {/* メンバー */}
                    {entryMode === 'solo' && t.members.length > 1 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, marginLeft: 42 }}>
                        {t.members.map((m, i) => (
                          <span key={i} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }}>
                            {m.displayName}
                            {m.weaponClass && (
                              <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: WEAPON_COLOR[m.weaponClass] }}>
                                {WEAPON_LABEL[m.weaponClass]}
                              </span>
                            )}
                            <span className="mono" style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-soft)' }}>{m.rating}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 戦績 */}
                  <div className="row" style={{ gap: 16, flexShrink: 0 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div className="muted" style={{ fontSize: 10 }}>勝敗</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
                        <span style={{ color: 'var(--success)' }}>{t.wins}</span>
                        <span className="muted"> - </span>
                        <span style={{ color: 'var(--danger)' }}>{t.losses}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className="muted" style={{ fontSize: 10 }}>勝率</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
                        {t.wins + t.losses > 0 ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className="muted" style={{ fontSize: 10 }}>ラウンド</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {t.roundsWon}-{t.roundsLost}
                        <span className="muted" style={{ fontSize: 11 }}>
                          ({t.roundsWon - t.roundsLost >= 0 ? '+' : ''}{t.roundsWon - t.roundsLost})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 全試合結果 */}
      <div className="section">
        <p className="sec-title">全試合結果（{matches.length}試合）</p>
        <div className="stack">
          {matches.map(m => {
            const teamA = m.entry_a_id ? teams.find(t => t.entryId === m.entry_a_id) ?? (function() { for (const [, v] of [...new Map()]) return v; return null })() : null
            const teamB = m.entry_b_id ? teams.find(t => t.entryId === m.entry_b_id) : null

            // teamMapからも検索
            const nameA = teamA?.teamName ?? '不明'
            const nameB = teamB?.teamName ?? '不明'

            return (
              <div key={m.id} className="card" style={{ padding: '10px 14px' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row" style={{ gap: 12 }}>
                    <span className="muted" style={{ fontSize: 10, minWidth: 60 }}>
                      {m.bracket_side === 'grand_final' ? 'GF' : m.bracket_side === 'losers' ? `L R${m.round}` : `R${m.round}`} #{m.match_number}
                    </span>
                    <span style={{ fontWeight: m.winner_entry_id === m.entry_a_id ? 700 : 400, color: m.winner_entry_id === m.entry_a_id ? 'var(--success)' : undefined, fontSize: 13 }}>
                      {nameA}
                    </span>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{m.score_a} - {m.score_b}</span>
                    <span style={{ fontWeight: m.winner_entry_id === m.entry_b_id ? 700 : 400, color: m.winner_entry_id === m.entry_b_id ? 'var(--success)' : undefined, fontSize: 13 }}>
                      {nameB}
                    </span>
                  </div>
                  {m.completed_at && (
                    <span className="muted mono" style={{ fontSize: 10 }}>
                      {new Date(m.completed_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {matches.length === 0 && <p className="muted">まだ完了した試合はありません</p>}
        </div>
      </div>
    </main>
  )
}
