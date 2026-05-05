'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

type TournamentRow = {
  id: string; title: string; description: string | null; format: string; entry_mode: string
  match_format: string; status: string; capacity: number; rate_cap: number | null
  seeding_method: string; entry_deadline: string | null; event_start: string | null
  host_user_id: string; prize: string | null; rules: string | null
  winner_info: { name?: string } | null; created_at: string
}

type EntryRow = {
  id: string; tournament_id: string; team_id: string | null; user_id: string | null
  weapon_class: string | null; rating_at_entry: number | null; status: string
  display_name?: string; team_name?: string
}

export default function TournamentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const tournamentId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [tournament, setTournament] = useState<TournamentRow | null>(null)
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myEntry, setMyEntry] = useState<EntryRow | null>(null)
  const [hostName, setHostName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // エントリーフォーム
  const [weaponClass, setWeaponClass] = useState('ar')
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myTeamName, setMyTeamName] = useState<string | null>(null)
  const [myRating, setMyRating] = useState<number>(1500)
  const [myPeakRating, setMyPeakRating] = useState<number>(1500)

  useEffect(() => {
    if (!tournamentId) return
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id ?? null
      setMyUserId(uid)

      // 大会情報
      const { data: t } = await supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle()
      if (!t) { setLoading(false); return }
      setTournament(t as TournamentRow)

      // 主催者名
      const { data: host } = await supabase.from('profiles').select('display_name').eq('id', (t as TournamentRow).host_user_id).maybeSingle()
      setHostName((host as { display_name: string | null } | null)?.display_name ?? null)

      // エントリー一覧
      const { data: entryData } = await supabase.from('tournament_entries').select('*').eq('tournament_id', tournamentId)
      const entryRows = (entryData ?? []) as EntryRow[]

      // 名前を解決
      const userIds = entryRows.filter(e => e.user_id).map(e => e.user_id!)
      const teamIds = entryRows.filter(e => e.team_id).map(e => e.team_id!)

      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', userIds)
        const nameMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]))
        for (const e of entryRows) {
          if (e.user_id) e.display_name = nameMap.get(e.user_id) ?? undefined
        }
      }
      if (teamIds.length > 0) {
        const { data: teams } = await supabase.from('teams').select('id, name').in('id', teamIds)
        const nameMap = new Map((teams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))
        for (const e of entryRows) {
          if (e.team_id) e.team_name = nameMap.get(e.team_id) ?? undefined
        }
      }

      setEntries(entryRows)

      // 自分のエントリー確認
      if (uid) {
        const mine = entryRows.find(e => e.user_id === uid || (e.team_id && teamIds.includes(e.team_id)))
        setMyEntry(mine ?? null)

        // 自分の情報
        const { data: prof } = await supabase.from('profiles').select('current_rating, peak_rating').eq('id', uid).maybeSingle()
        if (prof) {
          setMyRating((prof as { current_rating: number }).current_rating)
          setMyPeakRating((prof as { peak_rating: number }).peak_rating)
        }

        // 自分のチーム
        const { data: tm } = await supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle()
        if (tm) {
          setMyTeamId((tm as { team_id: string }).team_id)
          const { data: teamRow } = await supabase.from('teams').select('name').eq('id', (tm as { team_id: string }).team_id).maybeSingle()
          setMyTeamName((teamRow as { name: string } | null)?.name ?? null)
        }
      }

      setLoading(false)
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId])

  const handleEntry = async () => {
    if (!tournamentId || !myUserId || !tournament) return
    setBusy(true)

    // レート制限チェック
    if (tournament.rate_cap && myPeakRating > tournament.rate_cap) {
      showToast(`ピークレートが制限(≤${tournament.rate_cap})を超えています`, 'error')
      setBusy(false)
      return
    }

    const insertData: Record<string, unknown> = {
      tournament_id: tournamentId,
      rating_at_entry: myRating,
      status: 'registered',
    }

    if (tournament.entry_mode === 'solo') {
      insertData.user_id = myUserId
      insertData.weapon_class = weaponClass
    } else {
      if (!myTeamId) { showToast('チームに所属していません', 'error'); setBusy(false); return }
      insertData.team_id = myTeamId
      insertData.user_id = myUserId
    }

    const { error } = await supabase.from('tournament_entries').insert(insertData)
    setBusy(false)

    if (error) {
      if (error.code === '23505') showToast('既にエントリー済みです', 'error')
      else showToast(error.message || 'エントリーに失敗しました', 'error')
      return
    }

    showToast('エントリーしました！', 'success')
    router.refresh()
  }

  if (!tournamentId) return <main><p className="danger">大会IDが見つかりません</p></main>
  if (loading) return <main><LoadingSkeleton cards={3} /></main>
  if (!tournament) return <main><p className="danger">大会が見つかりません</p></main>

  const isHost = myUserId === tournament.host_user_id
  const canEntry = tournament.status === 'recruit' && !myEntry

  return (
    <main>
      <div className="eyebrow">TOURNAMENT DETAIL</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', marginTop: 6 }}>
        <em>{tournament.title}</em>
      </h1>

      <div className="section row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge" style={{ fontSize: 10 }}>{tournament.format === 'tournament' ? 'TOURNAMENT' : 'LEAGUE'}</span>
        <span className="badge" style={{ fontSize: 10 }}>{tournament.entry_mode === 'team' ? 'TEAM 4v4' : 'SOLO → 4v4'}</span>
        <span className="badge" style={{ fontSize: 10 }}>{tournament.match_format.toUpperCase()}</span>
        {tournament.rate_cap && <span className="badge amber" style={{ fontSize: 10 }}>≤ {tournament.rate_cap}</span>}
        {tournament.prize && <span className="badge" style={{ fontSize: 10, background: 'rgba(255,215,0,0.15)', color: 'var(--gold, #ffd700)' }}>{tournament.prize}</span>}
      </div>

      <div className="section grid-2">
        {/* 左: 情報 */}
        <div className="stack">
          <div className="card-strong">
            <h2 style={{ marginTop: 0 }}>大会情報</h2>
            {tournament.description && <p style={{ whiteSpace: 'pre-wrap' }}>{tournament.description}</p>}
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ fontSize: 11 }}>エントリー</p>
                <h3>{entries.length}/{tournament.capacity}</h3>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ fontSize: 11 }}>シード方式</p>
                <h3 style={{ fontSize: 14 }}>{tournament.seeding_method === 'random' ? 'ランダム' : tournament.seeding_method === 'rating' ? 'レート考慮' : '手動'}</h3>
              </div>
            </div>
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ fontSize: 11 }}>エントリー締切</p>
                <p style={{ fontSize: 13 }}>{tournament.entry_deadline ? new Date(tournament.entry_deadline).toLocaleString('ja-JP') : '未定'}</p>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ fontSize: 11 }}>開始日時</p>
                <p style={{ fontSize: 13 }}>{tournament.event_start ? new Date(tournament.event_start).toLocaleString('ja-JP') : '未定'}</p>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>主催: {hostName ?? '不明'}</p>
            {tournament.rules && (
              <div style={{ marginTop: 12 }}>
                <p className="stat-label">追加ルール</p>
                <p className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{tournament.rules}</p>
              </div>
            )}
          </div>

          {/* エント��ーフォーム */}
          {canEntry && (
            <div className="card-strong" style={{ borderLeft: '3px solid var(--cyan)' }}>
              <h2 style={{ marginTop: 0 }}>エントリー</h2>
              {tournament.entry_mode === 'solo' ? (
                <div className="stack">
                  <div>
                    <div className="stat-label">武器種</div>
                    <select value={weaponClass} onChange={e => setWeaponClass(e.target.value)} style={{ marginTop: 6 }}>
                      <option value="ar">AR</option>
                      <option value="smg">SMG</option>
                      <option value="flex">FLEX</option>
                    </select>
                  </div>
                  <p className="muted" style={{ fontSize: 12 }}>あなたのレート: {myRating} / ピーク: {myPeakRating}</p>
                  {tournament.rate_cap && myPeakRating > tournament.rate_cap && (
                    <p className="danger" style={{ fontSize: 12 }}>ピークレートが制限を超えています（≤{tournament.rate_cap}）</p>
                  )}
                  <button className="btn-primary" onClick={handleEntry} disabled={busy || (!!tournament.rate_cap && myPeakRating > tournament.rate_cap)}>
                    {busy ? 'エントリー中...' : 'エントリーする'}
                  </button>
                </div>
              ) : (
                <div className="stack">
                  {myTeamId ? (
                    <>
                      <p>チーム: <strong>{myTeamName}</strong></p>
                      <p className="muted" style={{ fontSize: 12 }}>あなたのレート: {myRating} / ピーク: {myPeakRating}</p>
                      {tournament.rate_cap && myPeakRating > tournament.rate_cap && (
                        <p className="danger" style={{ fontSize: 12 }}>ピークレートが制限を超えています</p>
                      )}
                      <button className="btn-primary" onClick={handleEntry} disabled={busy || (!!tournament.rate_cap && myPeakRating > tournament.rate_cap)}>
                        {busy ? 'エントリー中...' : 'チームでエントリー'}
                      </button>
                    </>
                  ) : (
                    <p className="muted">チームに所属していないためエントリーできません。先にチームを作成してください。</p>
                  )}
                </div>
              )}
            </div>
          )}

          {myEntry && (
            <div className="card-strong" style={{ borderLeft: '3px solid var(--success)' }}>
              <p style={{ fontWeight: 700, color: 'var(--success)', margin: 0 }}>エントリー済み</p>
              {myEntry.weapon_class && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>武器種: {myEntry.weapon_class.toUpperCase()}</p>}
            </div>
          )}
        </div>

        {/* 右: エントリー一覧 */}
        <div className="card-strong">
          <h2 style={{ marginTop: 0 }}>参加者（{entries.length}/{tournament.capacity}）</h2>
          {entries.length === 0 ? (
            <p className="muted">まだエントリーはありません</p>
          ) : (
            <div className="stack">
              {entries.map(e => (
                <div key={e.id} className="card" style={{ padding: '10px 14px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {e.team_name ?? e.display_name ?? '不明'}
                      </span>
                      {e.weapon_class && (
                        <span className="badge" style={{ fontSize: 9, marginLeft: 8 }}>{e.weapon_class.toUpperCase()}</span>
                      )}
                    </div>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
                      {e.rating_at_entry ?? '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 進行中リンク */}
      {(tournament.status === 'live' || tournament.status === 'seeding') && (
        <div className="section row" style={{ gap: 8 }}>
          {tournament.format === 'tournament' && (
            <button className="btn-primary" onClick={() => router.push(`/tournaments/${tournamentId}/bracket`)}>
              ブラケットを見る
            </button>
          )}
          {tournament.format === 'league' && (
            <button className="btn-primary" onClick={() => router.push(`/tournaments/${tournamentId}/standings`)}>
              星取表を見る
            </button>
          )}
        </div>
      )}

      {/* 主催者アクション */}
      {isHost && (
        <div className="section card-strong">
          <h2 style={{ marginTop: 0 }}>主催者メニュー</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {tournament.status === 'recruit' && (
              <button className="btn-primary" onClick={async () => {
                setBusy(true)
                const { data, error } = await supabase.rpc('rpc_tournament_execute_seeding', { p_tournament_id: tournamentId })
                if (error) { showToast(error.message, 'error'); setBusy(false); return }
                showToast('シードを実行しました', 'success')
                // ブラケット or リーグ初期化
                if (tournament.format === 'tournament') {
                  const { error: e2 } = await supabase.rpc('rpc_tournament_generate_bracket', { p_tournament_id: tournamentId })
                  if (e2) showToast(e2.message, 'error')
                  else { showToast('ブラケットを生成しました', 'success'); router.push(`/tournaments/${tournamentId}/bracket`) }
                } else {
                  const { error: e2 } = await supabase.rpc('rpc_tournament_init_league', { p_tournament_id: tournamentId })
                  if (e2) showToast(e2.message, 'error')
                  else { showToast('リーグを開始しました', 'success'); router.push(`/tournaments/${tournamentId}/standings`) }
                }
                setBusy(false)
              }} disabled={busy}>
                {busy ? '処理中...' : 'エントリー締切 → 大会開始'}
              </button>
            )}
            <button className="btn-ghost" onClick={() => router.push('/tournaments')}>
              一覧に戻る
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
