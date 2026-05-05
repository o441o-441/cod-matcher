'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingSkeleton } from '@/components/UIState'

type MatchRow = {
  id: string; round: number; match_number: number
  entry_a_id: string | null; entry_b_id: string | null
  winner_entry_id: string | null; score_a: number; score_b: number
  status: string
}

type EntryInfo = { id: string; name: string; seed: number | null }

export default function BracketPage() {
  const params = useParams()
  const router = useRouter()
  const tournamentId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [entryMap, setEntryMap] = useState<Map<string, EntryInfo>>(new Map())
  const [tournamentTitle, setTournamentTitle] = useState('')
  const [maxRound, setMaxRound] = useState(0)

  useEffect(() => {
    if (!tournamentId) return
    const load = async () => {
      const [{ data: t }, { data: matchData }, { data: entries }] = await Promise.all([
        supabase.from('tournaments').select('title, entry_mode').eq('id', tournamentId).maybeSingle(),
        supabase.from('tournament_matches').select('*').eq('tournament_id', tournamentId).order('round').order('match_number'),
        supabase.from('tournament_entries').select('id, team_id, user_id, assigned_team_name, seed_number').eq('tournament_id', tournamentId),
      ])

      setTournamentTitle((t as { title: string } | null)?.title ?? '')
      setMatches((matchData ?? []) as MatchRow[])

      // エントリー名解決
      const entryRows = (entries ?? []) as { id: string; team_id: string | null; user_id: string | null; assigned_team_name: string | null; seed_number: number | null }[]
      const map = new Map<string, EntryInfo>()

      const teamIds = entryRows.filter(e => e.team_id).map(e => e.team_id!)
      const userIds = entryRows.filter(e => e.user_id && !e.team_id).map(e => e.user_id!)

      const [{ data: teams }, { data: profiles }] = await Promise.all([
        teamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', teamIds) : Promise.resolve({ data: [] }),
        userIds.length > 0 ? supabase.from('profiles').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
      ])

      const teamNameMap = new Map((teams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))
      const profileNameMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]))

      for (const e of entryRows) {
        const name = e.assigned_team_name ?? (e.team_id ? teamNameMap.get(e.team_id) : profileNameMap.get(e.user_id!)) ?? '不明'
        map.set(e.id, { id: e.id, name, seed: e.seed_number })
      }
      setEntryMap(map)

      const mr = (matchData ?? []).reduce((max: number, m: { round: number }) => Math.max(max, m.round), 0)
      setMaxRound(mr)
      setLoading(false)
    }
    void load()
  }, [tournamentId])

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  const roundLabel = (r: number) => {
    if (r === maxRound) return '決勝'
    if (r === maxRound - 1) return '準決勝'
    if (r === maxRound - 2) return '準々決勝'
    return `Round ${r}`
  }

  return (
    <main>
      <div className="eyebrow">BRACKET</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', marginTop: 6 }}>
        <em>{tournamentTitle}</em>
      </h1>

      <div className="section">
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}`)}>← 大会詳細に戻る</button>
      </div>

      <div className="section" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 24, minWidth: maxRound * 280 }}>
          {Array.from({ length: maxRound }, (_, i) => i + 1).map(round => {
            const roundMatches = matches.filter(m => m.round === round)
            return (
              <div key={round} style={{ flex: 1, minWidth: 240 }}>
                <div className="stat-label" style={{ marginBottom: 12, textAlign: 'center' }}>
                  {roundLabel(round)}
                </div>
                <div className="stack" style={{ gap: round === maxRound ? 0 : 8 + (round - 1) * 16 }}>
                  {roundMatches.map(m => {
                    const a = m.entry_a_id ? entryMap.get(m.entry_a_id) : null
                    const b = m.entry_b_id ? entryMap.get(m.entry_b_id) : null
                    const isFinal = round === maxRound
                    return (
                      <div
                        key={m.id}
                        className="card"
                        style={{
                          padding: '8px 12px',
                          border: isFinal ? '2px solid var(--gold, #ffd700)' : m.status === 'live' ? '2px solid var(--magenta)' : undefined,
                          boxShadow: m.status === 'live' ? '0 0 12px var(--magenta)' : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                          <span style={{ fontSize: 13, fontWeight: m.winner_entry_id === m.entry_a_id ? 700 : 400, color: m.winner_entry_id === m.entry_a_id ? 'var(--success)' : undefined }}>
                            {a ? `${a.seed ? `[${a.seed}] ` : ''}${a.name}` : 'TBD'}
                          </span>
                          <span className="mono" style={{ fontSize: 12 }}>{m.status === 'completed' ? m.score_a : '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                          <span style={{ fontSize: 13, fontWeight: m.winner_entry_id === m.entry_b_id ? 700 : 400, color: m.winner_entry_id === m.entry_b_id ? 'var(--success)' : undefined }}>
                            {b ? `${b.seed ? `[${b.seed}] ` : ''}${b.name}` : m.status === 'bye' ? 'BYE' : 'TBD'}
                          </span>
                          <span className="mono" style={{ fontSize: 12 }}>{m.status === 'completed' ? m.score_b : '-'}</span>
                        </div>
                        {m.status === 'live' && <span className="badge" style={{ fontSize: 9, marginTop: 4, background: 'var(--magenta)', color: '#fff' }}>LIVE</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
