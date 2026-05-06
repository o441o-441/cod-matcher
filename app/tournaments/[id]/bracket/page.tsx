'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'
import { VictoryEffect, ChampionEffect } from '@/components/CelebrationEffects'

type MatchRow = {
  id: string; round: number; match_number: number
  entry_a_id: string | null; entry_b_id: string | null
  winner_entry_id: string | null; score_a: number; score_b: number
  status: string; bracket_side: string
}

type TeamInfo = {
  entryId: string
  teamName: string
  members: { displayName: string; weaponClass: string | null; rating: number | null }[]
  avgRating: number
}

export default function BracketPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const tournamentId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamMap, setTeamMap] = useState<Map<string, TeamInfo>>(new Map())
  const [tournamentTitle, setTournamentTitle] = useState('')
  const [entryMode, setEntryMode] = useState('team')
  const [maxRound, setMaxRound] = useState(0)
  const [eliminationType, setEliminationType] = useState('single')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reportMatchId, setReportMatchId] = useState<string | null>(null)
  const [reportWinner, setReportWinner] = useState<string | null>(null)
  const [reportScoreA, setReportScoreA] = useState(0)
  const [reportScoreB, setReportScoreB] = useState(0)
  const [showVictory, setShowVictory] = useState(false)
  const [showChampion, setShowChampion] = useState(false)
  const [championInfo, setChampionInfo] = useState({ name: '', title: '' })

  const loadData = useCallback(async () => {
    if (!tournamentId) return
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)

    const [{ data: t }, { data: matchData }, { data: entries }] = await Promise.all([
      supabase.from('tournaments').select('title, entry_mode, elimination_type, host_user_id').eq('id', tournamentId).maybeSingle(),
      supabase.from('tournament_matches').select('*').eq('tournament_id', tournamentId).order('round').order('match_number'),
      supabase.from('tournament_entries').select('id, team_id, user_id, assigned_team_name, assigned_team_index, seed_number, weapon_class, rating_at_entry').eq('tournament_id', tournamentId),
    ])

    const tData = t as { title: string; entry_mode: string; elimination_type: string; host_user_id: string } | null
    setTournamentTitle(tData?.title ?? '')
    setEntryMode(tData?.entry_mode ?? 'team')
    setEliminationType(tData?.elimination_type ?? 'single')
    setIsHost(uid === tData?.host_user_id)
    setMatches((matchData ?? []) as MatchRow[])

    // チーム情報を構築
    const entryRows = (entries ?? []) as { id: string; team_id: string | null; user_id: string | null; assigned_team_name: string | null; assigned_team_index: number | null; seed_number: number | null; weapon_class: string | null; rating_at_entry: number | null }[]

    // ユーザー名を取得
    const allUserIds = entryRows.filter(e => e.user_id).map(e => e.user_id!)
    const allTeamIds = entryRows.filter(e => e.team_id).map(e => e.team_id!)

    const [{ data: profiles }, { data: teams }] = await Promise.all([
      allUserIds.length > 0 ? supabase.from('profiles').select('id, display_name').in('id', allUserIds) : Promise.resolve({ data: [] }),
      allTeamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', allTeamIds) : Promise.resolve({ data: [] }),
    ])

    const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? '不明']))
    const teamNameMap = new Map((teams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))

    const map = new Map<string, TeamInfo>()

    if (tData?.entry_mode === 'solo') {
      // 個人エントリー: assigned_team_indexでグループ化
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
        const teamInfo: TeamInfo = {
          entryId: rep.id,
          teamName: rep.assigned_team_name ?? `Team ${rep.assigned_team_index}`,
          members,
          avgRating,
        }
        // 全メンバーのIDをキーとして登録（どのメンバーのIDでも引けるように）
        for (const e of group) {
          map.set(e.id, teamInfo)
        }
      }
    } else {
      // チームエントリー
      for (const e of entryRows) {
        const name = e.team_id ? teamNameMap.get(e.team_id) ?? '不明' : profileMap.get(e.user_id!) ?? '不明'
        map.set(e.id, {
          entryId: e.id,
          teamName: name,
          members: [{ displayName: name, weaponClass: null, rating: e.rating_at_entry }],
          avgRating: e.rating_at_entry ?? 0,
        })
      }
    }

    setTeamMap(map)
    const mr = ((matchData ?? []) as { round: number; bracket_side: string }[]).filter(m => m.bracket_side === 'winners').reduce((max, m) => Math.max(max, m.round), 0)
    setMaxRound(mr)
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

    // Check if tournament just completed (champion effect)
    const { data: tCheck } = await supabase.from('tournaments').select('status, title, winner_info').eq('id', tournamentId!).maybeSingle()
    const tData = tCheck as { status: string; title: string; winner_info: { entry_id?: string } | null } | null
    if (tData?.status === 'completed' && tData.winner_info?.entry_id) {
      const winnerTeam = teamMap.get(tData.winner_info.entry_id)
      setChampionInfo({ name: winnerTeam?.teamName ?? 'CHAMPION', title: tData.title })
      setShowChampion(true)
    } else {
      setShowVictory(true)
    }

    setReportMatchId(null)
    setReportWinner(null)
    void loadData()
  }

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  const WEAPON_LABEL: Record<string, string> = { ar: 'AR', smg: 'SMG', flex: 'FLEX' }
  const WEAPON_COLOR: Record<string, string> = { ar: 'var(--cyan)', smg: 'var(--magenta)', flex: 'var(--violet, #8b5cf6)' }

  const roundLabel = (r: number, side: string) => {
    if (side === 'losers') return `L Round ${r}`
    if (r === maxRound) return '決勝'
    if (r === maxRound - 1 && maxRound >= 3) return '準決勝'
    if (r === maxRound - 2 && maxRound >= 4) return '準々決勝'
    return `Round ${r}`
  }

  const renderTeamCard = (entryId: string | null, isWinner: boolean) => {
    if (!entryId) return <span className="muted" style={{ fontSize: 13 }}>TBD</span>
    const team = teamMap.get(entryId)
    if (!team) return <span className="muted" style={{ fontSize: 13 }}>不明</span>

    return (
      <div>
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: isWinner ? 'var(--success)' : undefined }}>
            {team.teamName}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>avg {team.avgRating}</span>
        </div>
        {entryMode === 'solo' && team.members.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {team.members.map((m, i) => (
              <span key={i} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }}>
                {m.displayName}
                {m.weaponClass && (
                  <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, color: WEAPON_COLOR[m.weaponClass] ?? 'var(--text-soft)' }}>
                    {WEAPON_LABEL[m.weaponClass] ?? m.weaponClass}
                  </span>
                )}
                <span className="mono" style={{ marginLeft: 4, fontSize: 9, color: 'var(--text-soft)' }}>{m.rating}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderMatch = (m: MatchRow, isFinal: boolean) => {
    const canReport = m.status === 'pending' && m.entry_a_id && m.entry_b_id && (isHost || myUserId)
    const isReporting = reportMatchId === m.id

    return (
      <div
        key={m.id}
        className="card-strong"
        style={{
          padding: '14px 16px',
          border: isFinal ? '2px solid var(--gold, #ffd700)' : m.status === 'live' ? '2px solid var(--magenta)' : undefined,
          boxShadow: isFinal ? '0 0 16px rgba(255,215,0,0.15)' : m.status === 'live' ? '0 0 12px var(--magenta)' : undefined,
        }}
      >
        {/* ステータスバッジ */}
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 10 }}>MATCH {m.match_number}</span>
          {m.status === 'completed' && <span className="badge success" style={{ fontSize: 9 }}>完了</span>}
          {m.status === 'live' && <span className="badge" style={{ fontSize: 9, background: 'var(--magenta)', color: '#fff' }}>LIVE</span>}
          {m.status === 'pending' && <span className="badge" style={{ fontSize: 9 }}>待機中</span>}
          {m.status === 'bye' && <span className="badge" style={{ fontSize: 9 }}>BYE</span>}
        </div>

        {/* チームA */}
        <div style={{
          padding: '8px 10px', borderRadius: 'var(--r-sm)', marginBottom: 6,
          background: m.winner_entry_id === m.entry_a_id ? 'rgba(0,245,160,0.06)' : 'rgba(255,255,255,0.02)',
          borderLeft: m.winner_entry_id === m.entry_a_id ? '3px solid var(--success)' : '3px solid transparent',
        }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {renderTeamCard(m.entry_a_id, m.winner_entry_id === m.entry_a_id)}
            <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{m.status === 'completed' ? m.score_a : '-'}</span>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-soft)', margin: '2px 0' }}>VS</div>

        {/* チームB */}
        <div style={{
          padding: '8px 10px', borderRadius: 'var(--r-sm)',
          background: m.winner_entry_id === m.entry_b_id ? 'rgba(0,245,160,0.06)' : 'rgba(255,255,255,0.02)',
          borderLeft: m.winner_entry_id === m.entry_b_id ? '3px solid var(--success)' : '3px solid transparent',
        }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {m.status === 'bye'
              ? <span className="muted" style={{ fontSize: 13 }}>BYE</span>
              : renderTeamCard(m.entry_b_id, m.winner_entry_id === m.entry_b_id)
            }
            <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{m.status === 'completed' ? m.score_b : '-'}</span>
          </div>
        </div>

        {/* バンピック/結果報告ボタン */}
        {m.status === 'pending' && m.entry_a_id && m.entry_b_id && (
          <button
            className="btn-primary btn-sm btn-block"
            style={{ marginTop: 10, fontSize: 12 }}
            onClick={() => router.push(`/tournaments/${tournamentId}/match/${m.id}`)}
          >
            バンピック → 試合
          </button>
        )}
        {canReport && !isReporting && (
          <button
            className="btn-ghost btn-sm btn-block"
            style={{ marginTop: 6, fontSize: 12 }}
            onClick={() => { setReportMatchId(m.id); setReportWinner(null); setReportScoreA(0); setReportScoreB(0) }}
          >
            結果を報告
          </button>
        )}

        {/* 結果報告フォーム */}
        {isReporting && (
          <div style={{ marginTop: 10, padding: 12, background: 'rgba(0,229,255,0.03)', borderRadius: 'var(--r-sm)' }}>
            <p className="stat-label" style={{ marginBottom: 8 }}>勝者を選択</p>
            <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
              <button
                className={reportWinner === m.entry_a_id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => setReportWinner(m.entry_a_id)}
              >
                {teamMap.get(m.entry_a_id!)?.teamName ?? 'A'}
              </button>
              <button
                className={reportWinner === m.entry_b_id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => setReportWinner(m.entry_b_id)}
              >
                {teamMap.get(m.entry_b_id!)?.teamName ?? 'B'}
              </button>
            </div>
            <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 11 }}>{teamMap.get(m.entry_a_id!)?.teamName ?? 'A'} のスコア</label>
                <input type="number" value={reportScoreA || ''} onChange={e => setReportScoreA(e.target.value === '' ? 0 : Number(e.target.value))} onFocus={e => e.target.select()} min={0} inputMode="numeric" />
              </div>
              <div>
                <label style={{ fontSize: 11 }}>{teamMap.get(m.entry_b_id!)?.teamName ?? 'B'} のスコア</label>
                <input type="number" value={reportScoreB || ''} onChange={e => setReportScoreB(e.target.value === '' ? 0 : Number(e.target.value))} onFocus={e => e.target.select()} min={0} inputMode="numeric" />
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn-primary btn-sm" onClick={handleReport} disabled={busy || !reportWinner}>
                {busy ? '送信中...' : '報告する'}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setReportMatchId(null)}>キャンセル</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const winnersMatches = matches.filter(m => m.bracket_side === 'winners')
  const losersMatches = matches.filter(m => m.bracket_side === 'losers')
  const grandFinalMatches = matches.filter(m => m.bracket_side === 'grand_final').sort((a, b) => a.round - b.round)
  const grandFinal = grandFinalMatches[0] ?? null
  const grandFinalReset = grandFinalMatches[1] ?? null
  const losersMaxRound = losersMatches.reduce((max, m) => Math.max(max, m.round), 0)

  return (
    <main>
      <div className="eyebrow">BRACKET</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', marginTop: 6 }}>
        <em>{tournamentTitle}</em>
      </h1>

      <div className="section row" style={{ gap: 8 }}>
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}`)}>← 大会詳細に戻る</button>
        {eliminationType === 'double' && (
          <span className="badge" style={{ fontSize: 10, background: 'var(--cyan-dim)', color: 'var(--cyan)' }}>DOUBLE ELIMINATION</span>
        )}
      </div>

      {/* Winners Bracket */}
      <div className="section">
        {eliminationType === 'double' && <h2 style={{ margin: '0 0 12px', color: 'var(--cyan)' }}>Winners Bracket</h2>}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 20, minWidth: maxRound * 320 }}>
            {Array.from({ length: maxRound }, (_, i) => i + 1).map(round => {
              const roundMs = winnersMatches.filter(m => m.round === round)
              return (
                <div key={round} style={{ flex: 1, minWidth: 300 }}>
                  <div className="stat-label" style={{ marginBottom: 12, textAlign: 'center', fontSize: 13 }}>
                    {roundLabel(round, 'winners')}
                  </div>
                  <div className="stack" style={{ gap: 12 }}>
                    {roundMs.map(m => renderMatch(m, round === maxRound && eliminationType === 'single'))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Losers Bracket */}
      {eliminationType === 'double' && losersMatches.length > 0 && (
        <div className="section">
          <h2 style={{ margin: '0 0 12px', color: 'var(--magenta)' }}>Losers Bracket</h2>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 20, minWidth: losersMaxRound * 320 }}>
              {Array.from({ length: losersMaxRound }, (_, i) => i + 1).map(round => {
                const roundMs = losersMatches.filter(m => m.round === round)
                return (
                  <div key={round} style={{ flex: 1, minWidth: 300 }}>
                    <div className="stat-label" style={{ marginBottom: 12, textAlign: 'center', fontSize: 13 }}>
                      L Round {round}
                    </div>
                    <div className="stack" style={{ gap: 12 }}>
                      {roundMs.map(m => renderMatch(m, false))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Grand Final */}
      {eliminationType === 'double' && grandFinal && (
        <div className="section">
          <h2 style={{ margin: '0 0 12px', color: 'var(--gold, #ffd700)' }}>Grand Final</h2>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 300, maxWidth: 400, flex: 1 }}>
              <div className="stat-label" style={{ marginBottom: 8, textAlign: 'center', fontSize: 13 }}>GF</div>
              {renderMatch(grandFinal, !grandFinalReset || grandFinalReset.status === 'bye')}
            </div>
            {grandFinalReset && grandFinalReset.status !== 'bye' && (
              <div style={{ minWidth: 300, maxWidth: 400, flex: 1 }}>
                <div className="stat-label" style={{ marginBottom: 8, textAlign: 'center', fontSize: 13 }}>GF RESET</div>
                {renderMatch(grandFinalReset, true)}
              </div>
            )}
          </div>
          {grandFinalReset && grandFinalReset.status !== 'bye' && grandFinal.status !== 'completed' && (
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Losers側がGFに勝った場合、リセットマッチが行われます</p>
          )}
        </div>
      )}

      {showVictory && <VictoryEffect onClose={() => setShowVictory(false)} />}
      {showChampion && (
        <ChampionEffect
          tournamentName={championInfo.title}
          winnerName={championInfo.name}
          onClose={() => setShowChampion(false)}
        />
      )}
    </main>
  )
}
