'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingSkeleton } from '@/components/UIState'

type StandingRow = {
  id: string; entry_id: string; wins: number; losses: number; draws: number; points: number
  rounds_won: number; rounds_lost: number
  entry_name?: string
}

export default function StandingsPage() {
  const params = useParams()
  const router = useRouter()
  const tournamentId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [tournamentTitle, setTournamentTitle] = useState('')

  useEffect(() => {
    if (!tournamentId) return
    const load = async () => {
      const [{ data: t }, { data: standingsData }, { data: entries }] = await Promise.all([
        supabase.from('tournaments').select('title').eq('id', tournamentId).maybeSingle(),
        supabase.from('league_standings').select('*').eq('tournament_id', tournamentId).order('points', { ascending: false }),
        supabase.from('tournament_entries').select('id, team_id, user_id, assigned_team_name').eq('tournament_id', tournamentId),
      ])

      setTournamentTitle((t as { title: string } | null)?.title ?? '')

      const rows = (standingsData ?? []) as StandingRow[]
      const entryRows = (entries ?? []) as { id: string; team_id: string | null; user_id: string | null; assigned_team_name: string | null }[]

      // 名前解決
      const teamIds = entryRows.filter(e => e.team_id).map(e => e.team_id!)
      const userIds = entryRows.filter(e => e.user_id && !e.team_id).map(e => e.user_id!)

      const [{ data: teams }, { data: profiles }] = await Promise.all([
        teamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', teamIds) : Promise.resolve({ data: [] }),
        userIds.length > 0 ? supabase.from('profiles').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
      ])

      const teamNameMap = new Map((teams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))
      const profileNameMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]))
      const entryNameMap = new Map<string, string>()
      for (const e of entryRows) {
        const name = e.assigned_team_name ?? (e.team_id ? teamNameMap.get(e.team_id) : profileNameMap.get(e.user_id!)) ?? '不明'
        entryNameMap.set(e.id, name)
      }

      for (const s of rows) {
        s.entry_name = entryNameMap.get(s.entry_id)
      }

      setStandings(rows)
      setLoading(false)
    }
    void load()
  }, [tournamentId])

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  const medalColor = (i: number) => {
    if (i === 0) return 'var(--gold, #ffd700)'
    if (i === 1) return '#c0c0c0'
    if (i === 2) return '#cd7f32'
    return undefined
  }

  return (
    <main>
      <div className="eyebrow">LEAGUE STANDINGS</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', marginTop: 6 }}>
        <em>{tournamentTitle}</em>
      </h1>

      <div className="section">
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}`)}>← 大会詳細に戻る</button>
      </div>

      <div className="section card-strong">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              <th style={{ padding: '10px 8px', textAlign: 'left' }}>#</th>
              <th style={{ padding: '10px 8px', textAlign: 'left' }}>チーム/プレイヤー</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>勝</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>敗</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>引</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>勝ち点</th>
              <th style={{ padding: '10px 8px', textAlign: 'center' }}>得失ラウンド</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--line)', background: i < 3 ? 'rgba(255,255,255,0.02)' : undefined }}>
                <td style={{ padding: '10px 8px', fontWeight: 700, color: medalColor(i) }}>{i + 1}</td>
                <td style={{ padding: '10px 8px', fontWeight: 600 }}>{s.entry_name ?? '不明'}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--success)' }}>{s.wins}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--danger)' }}>{s.losses}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>{s.draws}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{s.points}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12 }}>
                  {s.rounds_won}-{s.rounds_lost} ({s.rounds_won - s.rounds_lost >= 0 ? '+' : ''}{s.rounds_won - s.rounds_lost})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {standings.length === 0 && <p className="muted" style={{ padding: 20, textAlign: 'center' }}>まだ試合結果がありません</p>}
      </div>
    </main>
  )
}
