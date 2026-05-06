'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

const PHASE_POOLS: Record<string, string[]> = {
  hp: ['酒', 'コロッサス', 'デン', 'スカー', 'グリッドロック'],
  snd: ['プラザ', 'デン', 'グリッドロック', 'レイド', 'スカー', 'フリンジ'],
  ovl: ['デン', 'エクスポージャー', 'スカー'],
}

const MODE_LABEL: Record<string, string> = { hp: 'HARDPOINT', snd: 'SEARCH & DESTROY', ovl: 'OVERLOAD' }

type GameRecord = { game: number; mode: string; map: string; bans: string[]; side: string }

type MatchData = {
  id: string; entry_a_id: string; entry_b_id: string
  selected_mode: string | null; selected_map: string | null
  bans: string[]; side_choice: string | null
  banpick_status: string; banpick_turn_entry_id: string | null; banpick_action: string | null
  score_a: number; score_b: number; status: string; bracket_side: string
  match_format: string; current_game: number; games: GameRecord[]
}

type TeamInfo = { entryId: string; teamName: string; members: { displayName: string }[] }

export default function TournamentMatchPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const tournamentId = typeof params.id === 'string' ? params.id : null
  const matchId = typeof params.matchId === 'string' ? params.matchId : null

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<MatchData | null>(null)
  const [teamA, setTeamA] = useState<TeamInfo | null>(null)
  const [teamB, setTeamB] = useState<TeamInfo | null>(null)
  const [myEntryId, setMyEntryId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadData = useCallback(async () => {
    if (!matchId || !tournamentId) return

    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null

    const [{ data: m }, { data: tData }] = await Promise.all([
      supabase.from('tournament_matches').select('*').eq('id', matchId).maybeSingle(),
      supabase.from('tournaments').select('host_user_id').eq('id', tournamentId).maybeSingle(),
    ])
    if (!m) { setLoading(false); return }
    setIsHost(uid === (tData as { host_user_id: string } | null)?.host_user_id)
    const mData = m as MatchData
    mData.bans = Array.isArray(mData.bans) ? mData.bans : []
    mData.games = Array.isArray(mData.games) ? mData.games : []
    setMatch(mData)

    // エントリー情報を取得
    const { data: entries } = await supabase.from('tournament_entries')
      .select('id, user_id, assigned_team_name, assigned_team_index')
      .eq('tournament_id', tournamentId)

    const entryRows = (entries ?? []) as { id: string; user_id: string | null; assigned_team_name: string | null; assigned_team_index: number | null }[]

    // 自分のエントリーIDを特定
    if (uid) {
      const myEntry = entryRows.find(e => e.user_id === uid)
      if (myEntry) {
        // 自分のチームのエントリー（a or b）を特定
        const myTeamIdx = myEntry.assigned_team_index
        const aEntry = entryRows.find(e => e.id === mData.entry_a_id)
        const bEntry = entryRows.find(e => e.id === mData.entry_b_id)
        if (aEntry && aEntry.assigned_team_index === myTeamIdx) setMyEntryId(mData.entry_a_id)
        else if (bEntry && bEntry.assigned_team_index === myTeamIdx) setMyEntryId(mData.entry_b_id)
        else if (myEntry.id === mData.entry_a_id || myEntry.id === mData.entry_b_id) setMyEntryId(myEntry.id)
      }
    }

    // チーム名解決
    const userIds = entryRows.filter(e => e.user_id).map(e => e.user_id!)
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] }
    const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? '不明']))

    const buildTeam = (entryId: string): TeamInfo => {
      const entry = entryRows.find(e => e.id === entryId)
      if (!entry) return { entryId, teamName: '不明', members: [] }
      const teamIdx = entry.assigned_team_index
      const teamMembers = teamIdx
        ? entryRows.filter(e => e.assigned_team_index === teamIdx)
        : [entry]
      return {
        entryId,
        teamName: entry.assigned_team_name ?? profileMap.get(entry.user_id!) ?? '不明',
        members: teamMembers.map(e => ({ displayName: profileMap.get(e.user_id!) ?? '不明' })),
      }
    }

    setTeamA(buildTeam(mData.entry_a_id))
    setTeamB(buildTeam(mData.entry_b_id))
    setLoading(false)
  }, [matchId, tournamentId])

  useEffect(() => { void loadData() }, [loadData])

  // ポーリング
  useEffect(() => {
    const id = setInterval(() => void loadData(), 5000)
    return () => clearInterval(id)
  }, [loadData])

  const handleStartBanpick = async () => {
    if (!matchId) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_tournament_start_banpick', { p_tournament_match_id: matchId })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    void loadData()
  }

  const handleAction = async (action: string, target: string) => {
    if (!matchId) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_tournament_banpick_action', {
      p_tournament_match_id: matchId, p_action: action, p_target: target,
    })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    void loadData()
  }

  if (loading) return <main><LoadingSkeleton cards={2} /></main>
  if (!match) return <main><p className="danger">試合が見つかりません</p></main>

  const isMyTurn = isHost || myEntryId === match.banpick_turn_entry_id
  const turnTeamName = match.banpick_turn_entry_id === match.entry_a_id ? teamA?.teamName : teamB?.teamName
  const pool = match.selected_mode ? PHASE_POOLS[match.selected_mode] ?? [] : []
  const bannedMaps = match.bans ?? []
  const availableMaps = pool.filter(m => !bannedMaps.includes(m))

  return (
    <main>
      <div className="eyebrow">TOURNAMENT BANPICK</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', marginTop: 6 }}>
        <em>{teamA?.teamName ?? 'A'} vs {teamB?.teamName ?? 'B'}</em>
      </h1>

      <div className="section row" style={{ gap: 8 }}>
        <button className="btn-ghost" onClick={() => router.push(`/tournaments/${tournamentId}/bracket`)}>← ブラケットに戻る</button>
      </div>

      {/* バンピック開始前 */}
      {match.banpick_status === 'waiting' && (isHost || myEntryId) && (
        <div className="section card-strong" style={{ textAlign: 'center', padding: 32 }}>
          <h2 style={{ marginTop: 0 }}>バンピックを開始</h2>
          <p className="muted">対戦相手が揃っています。バンピックを開始すると先行チームが抽選されます。</p>
          <button className="btn-primary" onClick={handleStartBanpick} disabled={busy}>
            {busy ? '開始中...' : 'バンピック開始（先行抽選）'}
          </button>
        </div>
      )}

      {/* 完了済みゲーム一覧 */}
      {match.games.length > 0 && (
        <div className="section">
          <p className="sec-title">確定済みゲーム</p>
          <div className="stack-sm">
            {match.games.map((g, i) => (
              <div key={i} className="card" style={{ padding: '8px 14px' }}>
                <div className="row" style={{ gap: 12, fontSize: 13 }}>
                  <span className="badge" style={{ fontSize: 9 }}>GAME {g.game}</span>
                  <span style={{ fontWeight: 700 }}>{MODE_LABEL[g.mode] ?? g.mode}</span>
                  <span style={{ color: 'var(--success)' }}>{g.map}</span>
                  <span className="muted">{g.side}</span>
                  <span className="muted" style={{ fontSize: 11 }}>BAN: {g.bans.join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* バンピック進行中 */}
      {match.banpick_status === 'in_progress' && match.selected_mode && (
        <div className="section">
          {/* ゲーム進行状況 */}
          {match.match_format !== 'bo1' && (
            <div className="card" style={{ padding: '8px 14px', marginBottom: 16, textAlign: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {match.match_format.toUpperCase()} — GAME {match.current_game} / {match.match_format === 'bo3' ? 3 : match.match_format === 'bo5' ? 5 : 1}
              </span>
            </div>
          )}

          {/* モード表示 */}
          <div className="card-strong" style={{ textAlign: 'center', padding: 20, marginBottom: 16 }}>
            <div className="muted" style={{ fontSize: 11 }}>GAME {match.current_game} モード</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--cyan)', marginTop: 4 }}>
              {MODE_LABEL[match.selected_mode] ?? match.selected_mode}
            </div>
          </div>

          {/* ターン表示 */}
          <div className="card-strong" style={{ textAlign: 'center', padding: 16, marginBottom: 16, borderLeft: isMyTurn ? '4px solid var(--cyan)' : '4px solid var(--text-soft)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isMyTurn ? 'var(--cyan)' : 'var(--text-soft)' }}>
              {isHost && myEntryId !== match.banpick_turn_entry_id
                ? `${turnTeamName ?? '不明'} のターン（主催者操作可能）`
                : isMyTurn ? 'あなたのターンです' : `${turnTeamName ?? '相手'} のターン — 待機中`}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {match.banpick_action === 'ban' && 'マップを1つBANしてください'}
              {match.banpick_action === 'pick_map' && 'マップを1つ選択してください'}
              {match.banpick_action === 'pick_side' && 'サイドを選択してください (JSOC / ギルド)'}
            </div>
          </div>

          {/* BAN済みマップ */}
          {bannedMaps.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: '10px 14px' }}>
              <span className="stat-label">BAN済み: </span>
              {bannedMaps.map(b => (
                <span key={b} style={{ marginLeft: 8, textDecoration: 'line-through', color: 'var(--danger)', fontSize: 13 }}>{b}</span>
              ))}
            </div>
          )}

          {/* 選択済みマップ */}
          {match.selected_map && (
            <div className="card" style={{ marginBottom: 16, padding: '10px 14px', borderLeft: '3px solid var(--success)' }}>
              <span className="stat-label">選択マップ: </span>
              <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--success)', fontSize: 14 }}>{match.selected_map}</span>
            </div>
          )}

          {/* アクションUI */}
          {isMyTurn && match.banpick_action === 'ban' && (
            <div className="card-strong">
              <p className="stat-label" style={{ marginBottom: 8 }}>BANするマップを選択</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {availableMaps.map(map => (
                  <button key={map} className="card" style={{ padding: '14px 12px', cursor: 'pointer', textAlign: 'center', fontSize: 14, fontWeight: 600 }}
                    onClick={() => handleAction('ban', map)} disabled={busy}>
                    {map}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isMyTurn && match.banpick_action === 'pick_map' && (
            <div className="card-strong">
              <p className="stat-label" style={{ marginBottom: 8 }}>プレイするマップを選択</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {availableMaps.map(map => (
                  <button key={map} className="card" style={{ padding: '14px 12px', cursor: 'pointer', textAlign: 'center', fontSize: 14, fontWeight: 600, border: '2px solid var(--cyan)' }}
                    onClick={() => handleAction('pick_map', map)} disabled={busy}>
                    {map}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isMyTurn && match.banpick_action === 'pick_side' && (
            <div className="card-strong">
              <p className="stat-label" style={{ marginBottom: 8 }}>サイドを選択</p>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <button className="card" style={{ padding: 20, cursor: 'pointer', textAlign: 'center', border: '2px solid var(--cyan)' }}
                  onClick={() => handleAction('pick_side', 'JSOC')} disabled={busy}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--cyan)' }}>チーム1</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>JSOC</div>
                </button>
                <button className="card" style={{ padding: 20, cursor: 'pointer', textAlign: 'center', border: '2px solid var(--magenta)' }}
                  onClick={() => handleAction('pick_side', 'ギルド')} disabled={busy}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--magenta)' }}>チーム2</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>ギルド</div>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* バンピック完了 */}
      {match.banpick_status === 'completed' && (
        <div className="section card-strong" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0, color: 'var(--success)' }}>バンピック完了 — {match.match_format.toUpperCase()}</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            {match.games.map((g, i) => (
              <div key={i} className="card" style={{ padding: 16 }}>
                <div className="row" style={{ gap: 12, marginBottom: 4 }}>
                  <span className="badge" style={{ fontSize: 10 }}>GAME {g.game}</span>
                </div>
                <div className="grid grid-3" style={{ gap: 8 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div className="muted" style={{ fontSize: 10 }}>モード</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{MODE_LABEL[g.mode] ?? g.mode}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div className="muted" style={{ fontSize: 10 }}>マップ</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, color: 'var(--success)' }}>{g.map}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div className="muted" style={{ fontSize: 10 }}>サイド</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{g.side}</div>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>BAN: {g.bans.join(', ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* チーム情報 */}
      <div className="section grid-2">
        {[teamA, teamB].map((team, i) => (
          <div key={i} className="card-strong">
            <h3 style={{ marginTop: 0, color: i === 0 ? 'var(--cyan)' : 'var(--magenta)' }}>{team?.teamName ?? '不明'}</h3>
            <div className="stack-sm">
              {team?.members.map((m, j) => (
                <div key={j} style={{ fontSize: 13, padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                  {m.displayName}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
