'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'
import { VictoryEffect } from '@/components/CelebrationEffects'

type StandingRow = {
  id: string; entry_id: string; wins: number; losses: number; draws: number; points: number
  rounds_won: number; rounds_lost: number
  entry_name?: string
}

type MatchRow = {
  id: string; round: number; match_number: number
  entry_a_id: string | null; entry_b_id: string | null
  winner_entry_id: string | null; score_a: number; score_b: number
  status: string
}

export default function StandingsPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const tournamentId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [entryNameMap, setEntryNameMap] = useState<Map<string, string>>(new Map())
  const [tournamentTitle, setTournamentTitle] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)

  // Report form
  const [reportMatchId, setReportMatchId] = useState<string | null>(null)
  const [reportWinner, setReportWinner] = useState<string | null>(null)
  const [reportScoreA, setReportScoreA] = useState(0)
  const [reportScoreB, setReportScoreB] = useState(0)
  const [busy, setBusy] = useState(false)
  const [showVictory, setShowVictory] = useState(false)

  const loadData = useCallback(async () => {
    if (!tournamentId) return
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)

    const [{ data: t }, { data: standingsData }, { data: matchData }, { data: entries }] = await Promise.all([
      supabase.from('tournaments').select('title, host_user_id').eq('id', tournamentId).maybeSingle(),
      supabase.from('league_standings').select('*').eq('tournament_id', tournamentId).order('points', { ascending: false }),
      supabase.from('tournament_matches').select('*').eq('tournament_id', tournamentId).order('round').order('match_number'),
      supabase.from('tournament_entries').select('id, team_id, user_id, assigned_team_name').eq('tournament_id', tournamentId),
    ])

    const tData = t as { title: string; host_user_id: string } | null
    setTournamentTitle(tData?.title ?? '')
    setIsHost(uid === tData?.host_user_id)

    const rows = (standingsData ?? []) as StandingRow[]
    const entryRows = (entries ?? []) as { id: string; team_id: string | null; user_id: string | null; assigned_team_name: string | null }[]

    // Resolve names
    const teamIds = entryRows.filter(e => e.team_id).map(e => e.team_id!)
    const userIds = entryRows.filter(e => e.user_id && !e.team_id).map(e => e.user_id!)

    const [{ data: teams }, { data: profiles }] = await Promise.all([
      teamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', teamIds) : Promise.resolve({ data: [] }),
      userIds.length > 0 ? supabase.from('profiles').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
    ])

    const teamNameMap = new Map((teams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))
    const profileNameMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]))
    const nameMap = new Map<string, string>()
    for (const e of entryRows) {
      const name = e.assigned_team_name ?? (e.team_id ? teamNameMap.get(e.team_id) : profileNameMap.get(e.user_id!)) ?? '不明'
      nameMap.set(e.id, name)
    }

    for (const s of rows) {
      s.entry_name = nameMap.get(s.entry_id)
    }

    setStandings(rows)
    setMatches((matchData ?? []) as MatchRow[])
    setEntryNameMap(nameMap)
    setLoading(false)
  }, [tournamentId])

  useEffect(() => { void loadData() }, [loadData])

  const handleReport = async () => {
    if (!reportMatchId || !reportWinner) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_tournament_report_result', {
      p_tournament_match_id: reportMatchId,
      p_winner_entry_id: reportWinner,
      p_score_a: reportScoreA,
      p_score_b: reportScoreB,
    })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    showToast('結果を報告しました', 'success')
    setShowVictory(true)

    setReportMatchId(null)
    setReportWinner(null)
    void loadData()
  }

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  const medalColor = (i: number) => {
    if (i === 0) return 'var(--gold, #ffd700)'
    if (i === 1) return '#c0c0c0'
    if (i === 2) return '#cd7f32'
    return undefined
  }

  const maxRound = matches.reduce((max, m) => Math.max(max, m.round), 0)
  const pendingCount = matches.filter(m => m.status === 'pending').length
  const completedCount = matches.filter(m => m.status === 'completed').length

  return (
    <main>
      <div className="eyebrow">LEAGUE STANDINGS</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', marginTop: 6 }}>
        <em>{tournamentTitle}</em>
      </h1>

      <div className="section row" style={{ gap: 8 }}>
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}`)}>← 大会詳細に戻る</button>
        <span className="badge" style={{ fontSize: 10 }}>
          {completedCount}/{completedCount + pendingCount} 試合完了
        </span>
      </div>

      {/* 順位表 */}
      <div className="section card-strong">
        <h2 style={{ marginTop: 0 }}>順位表</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 480 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                <th style={{ padding: '10px 8px', textAlign: 'left' }}>#</th>
                <th style={{ padding: '10px 8px', textAlign: 'left' }}>チーム</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>勝</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>敗</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>勝ち点</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>得失R</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--line)', background: i < 3 ? 'rgba(255,255,255,0.02)' : undefined }}>
                  <td style={{ padding: '10px 8px', fontWeight: 700, color: medalColor(i) }}>{i + 1}</td>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{s.entry_name ?? '不明'}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--success)' }}>{s.wins}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--danger)' }}>{s.losses}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{s.points}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12 }}>
                    {s.rounds_won}-{s.rounds_lost} ({s.rounds_won - s.rounds_lost >= 0 ? '+' : ''}{s.rounds_won - s.rounds_lost})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {standings.length === 0 && <p className="muted" style={{ padding: 20, textAlign: 'center' }}>まだデータがありません</p>}
      </div>

      {/* 対戦カード */}
      <div className="section">
        <h2>対戦カード</h2>
        {Array.from({ length: maxRound }, (_, i) => i + 1).map(round => {
          const roundMs = matches.filter(m => m.round === round)
          return (
            <div key={round} style={{ marginBottom: 20 }}>
              <div className="stat-label" style={{ marginBottom: 8 }}>ROUND {round}</div>
              <div className="stack" style={{ gap: 10 }}>
                {roundMs.map(m => {
                  const nameA = m.entry_a_id ? entryNameMap.get(m.entry_a_id) ?? '不明' : 'TBD'
                  const nameB = m.entry_b_id ? entryNameMap.get(m.entry_b_id) ?? '不明' : 'TBD'
                  const isReporting = reportMatchId === m.id
                  const canReport = m.status === 'pending' && m.entry_a_id && m.entry_b_id && (isHost || myUserId)

                  return (
                    <div key={m.id} className="card" style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        {/* Team A */}
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{
                            fontWeight: 700, fontSize: 14,
                            color: m.winner_entry_id === m.entry_a_id ? 'var(--success)' : undefined,
                          }}>
                            {nameA}
                          </div>
                        </div>

                        {/* Score */}
                        <div style={{ textAlign: 'center', minWidth: 70 }}>
                          {m.status === 'completed' ? (
                            <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                              {m.score_a} - {m.score_b}
                            </span>
                          ) : (
                            <span className="badge" style={{ fontSize: 9 }}>未実施</span>
                          )}
                        </div>

                        {/* Team B */}
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{
                            fontWeight: 700, fontSize: 14,
                            color: m.winner_entry_id === m.entry_b_id ? 'var(--success)' : undefined,
                          }}>
                            {nameB}
                          </div>
                        </div>
                      </div>

                      {/* Report button */}
                      {canReport && !isReporting && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm btn-block"
                          style={{ marginTop: 10, fontSize: 12 }}
                          onClick={() => { setReportMatchId(m.id); setReportWinner(null); setReportScoreA(0); setReportScoreB(0) }}
                        >
                          結果を報告
                        </button>
                      )}

                      {/* Report form */}
                      {isReporting && (
                        <div style={{ marginTop: 10, padding: 12, background: 'rgba(0,229,255,0.03)', borderRadius: 'var(--r-sm)' }}>
                          <p className="stat-label" style={{ marginBottom: 8 }}>勝者を選択</p>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <button
                              type="button"
                              className={reportWinner === m.entry_a_id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                              onClick={() => setReportWinner(m.entry_a_id)}
                            >
                              {nameA}
                            </button>
                            <button
                              type="button"
                              className={reportWinner === m.entry_b_id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                              onClick={() => setReportWinner(m.entry_b_id)}
                            >
                              {nameB}
                            </button>
                          </div>
                          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
                            <div>
                              <label htmlFor={`sa-${m.id}`} style={{ fontSize: 11 }}>{nameA} のスコア</label>
                              <input id={`sa-${m.id}`} type="number" value={reportScoreA || ''} onChange={e => setReportScoreA(e.target.value === '' ? 0 : Number(e.target.value))} onFocus={e => e.target.select()} min={0} inputMode="numeric" />
                            </div>
                            <div>
                              <label htmlFor={`sb-${m.id}`} style={{ fontSize: 11 }}>{nameB} のスコア</label>
                              <input id={`sb-${m.id}`} type="number" value={reportScoreB || ''} onChange={e => setReportScoreB(e.target.value === '' ? 0 : Number(e.target.value))} onFocus={e => e.target.select()} min={0} inputMode="numeric" />
                            </div>
                          </div>
                          <div className="row" style={{ gap: 8 }}>
                            <button type="button" className="btn-primary btn-sm" onClick={handleReport} disabled={busy || !reportWinner}>
                              {busy ? '送信中...' : '報告する'}
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setReportMatchId(null)}>キャンセル</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {matches.length === 0 && <p className="muted">対戦カードがまだ生成されていません</p>}
      </div>

      {showVictory && <VictoryEffect onClose={() => setShowVictory(false)} />}
    </main>
  )
}
