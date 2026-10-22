'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

type Member = {
  user_id: string; display_name: string; peak_rating: number
  weapon_role: string; team_side: string | null
}

const ROLE_COLOR: Record<string, string> = { AR: 'var(--cyan)', SMG: 'var(--magenta)', FLEX: 'var(--violet)' }

// 開催時刻の表示 (例: 10/12 22:00)
const fmtSchedule = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function EightsLobbyPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const lobbyId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [lobby, setLobby] = useState<{ title: string; host_user_id: string; status: string; rate_cap: number | null; scheduled_at: string | null } | null>(null)
  const [schedFuture, setSchedFuture] = useState(false) // 開催時刻が未来か (読込時に判定)
  const [members, setMembers] = useState<Member[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragUser, setDragUser] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  const isHost = myUserId === lobby?.host_user_id
  const isDrafting = lobby?.status === 'drafting'
  const alphaTeam = members.filter(m => m.team_side === 'alpha')
  const bravoTeam = members.filter(m => m.team_side === 'bravo')

  const loadData = useCallback(async () => {
    if (!lobbyId) return
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)
    if (uid) {
      const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle()
      setIsAdmin(!!(prof as { is_admin?: boolean } | null)?.is_admin)
    }

    const [{ data: l }, { data: mData }] = await Promise.all([
      supabase.from('eights_lobbies').select('title, host_user_id, status, rate_cap, scheduled_at').eq('id', lobbyId).maybeSingle(),
      supabase.from('eights_lobby_members').select('user_id, weapon_role, team_side').eq('lobby_id', lobbyId),
    ])
    setLobby(l as typeof lobby)
    const sched = (l as { scheduled_at: string | null } | null)?.scheduled_at
    setSchedFuture(!!sched && new Date(sched).getTime() > Date.now())

    const userIds = ((mData ?? []) as { user_id: string }[]).map(m => m.user_id)
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('id, display_name, peak_rating').in('id', userIds)
      : { data: [] }

    const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null; peak_rating: number | null }) =>
      [p.id, { display_name: p.display_name ?? '不明', peak_rating: p.peak_rating ?? 1500 }]))

    setMembers(((mData ?? []) as { user_id: string; weapon_role: string; team_side: string | null }[]).map(m => ({
      user_id: m.user_id,
      display_name: profileMap.get(m.user_id)?.display_name ?? '不明',
      peak_rating: profileMap.get(m.user_id)?.peak_rating ?? 1500,
      weapon_role: m.weapon_role,
      team_side: m.team_side,
    })))
    setLoading(false)
  }, [lobbyId])

  useEffect(() => { void loadData() }, [loadData])

  // Realtime subscription
  useEffect(() => {
    if (!lobbyId) return
    const ch = supabase.channel(`eights-${lobbyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'eights_lobby_members', filter: `lobby_id=eq.${lobbyId}` }, () => { void loadData() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'eights_lobbies', filter: `id=eq.${lobbyId}` }, () => { void loadData() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [lobbyId, loadData])

  const setRole = async (role: string) => {
    const { error } = await supabase.rpc('rpc_eights_set_role', { p_lobby_id: lobbyId, p_role: role })
    if (error) { showToast(error.message, 'error'); return }
    void loadData()
  }

  const leaveLobby = async () => {
    if (isHost && members.length > 1 && !confirm('あなたはホストです。退出するとホスト権限は残りのメンバー（最古参）に引き継がれます。退出しますか？')) return
    const { error } = await supabase.rpc('rpc_eights_leave_lobby', { p_lobby_id: lobbyId })
    if (error) { showToast(error.message, 'error'); return }
    router.push('/custom')
  }

  // ロビー解散 (ホストのみ)
  const closeLobby = async () => {
    if (!confirm('ロビーを解散します。メンバー全員が退出扱いになります。よろしいですか？')) return
    const { error } = await supabase.rpc('rpc_eights_close_lobby', { p_lobby_id: lobbyId })
    if (error) { showToast(error.message, 'error'); return }
    router.push('/custom')
  }

  // 続行再募集: 残っているメンバーを保持したまま不足分を募集し直す (ホストのみ)
  const reopenLobby = async () => {
    const leavers = 8 - members.length
    const msg = leavers > 0
      ? `残っている${members.length}人を保持したまま、不足${leavers}枠の参加者を再募集します。よろしいですか？`
      : '8人全員が残っています。振り分けをリセットして募集状態に戻します（通知は送信されません）。よろしいですか？'
    if (!confirm(msg)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_eights_reopen_lobby', { p_lobby_id: lobbyId })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    const slots = (data as { slots?: number } | null)?.slots ?? 0
    showToast(slots > 0 ? `再募集を開始しました（残り${slots}枠を通知済み）` : '募集状態に戻しました', 'success')
    void loadData()
  }

  const autoAssign = async (mode: string) => {
    setBusy(true)
    const { error } = await supabase.rpc('rpc_eights_auto_assign', { p_lobby_id: lobbyId, p_mode: mode })
    setBusy(false)
    if (error) showToast(error.message, 'error')
    else void loadData()
  }

  const announceTeams = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('rpc_eights_announce_teams', { p_lobby_id: lobbyId })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    showToast('チーム編成をDiscordとサイト内通知で全員に送信しました', 'success')
  }

  const movePlayer = async (userId: string, toSide: string, swapWith?: string) => {
    const { error } = await supabase.rpc('rpc_eights_move_player', {
      p_lobby_id: lobbyId, p_user_id: userId, p_to_side: toSide, p_swap_with: swapWith ?? null,
    })
    if (error) { showToast(error.message, 'error'); return }
    void loadData()
  }

  const handleDrop = (toSide: string, targetUserId?: string) => {
    if (!dragUser) return
    const fromMember = members.find(m => m.user_id === dragUser)
    if (!fromMember || fromMember.team_side === toSide) { setDragUser(null); return }
    void movePlayer(dragUser, toSide, targetUserId)
    setDragUser(null)
  }

  if (loading) return <main><LoadingSkeleton cards={2} /></main>
  if (!lobby) return <main><p className="danger">ロビーが見つかりません</p></main>

  const myRole = members.find(m => m.user_id === myUserId)?.weapon_role ?? 'FLEX'
  const avgPeak = members.length > 0 ? Math.round(members.reduce((s, m) => s + m.peak_rating, 0) / members.length) : 0
  const roleCounts = { AR: members.filter(m => m.weapon_role === 'AR').length, SMG: members.filter(m => m.weapon_role === 'SMG').length, FLEX: members.filter(m => m.weapon_role === 'FLEX').length }

  const alphaAvg = alphaTeam.length > 0 ? Math.round(alphaTeam.reduce((s, m) => s + m.peak_rating, 0) / alphaTeam.length) : 0
  const bravoAvg = bravoTeam.length > 0 ? Math.round(bravoTeam.reduce((s, m) => s + m.peak_rating, 0) / bravoTeam.length) : 0
  const diff = Math.abs(alphaAvg - bravoAvg)

  // タップ操作 (タッチ端末はHTML5 DnDが効かないためのフォールバック):
  // カードをタップで選択 → 相手チームのパネル/カードをタップで移動・入れ替え
  const handleCardTap = (m: Member) => {
    if (!isHost || !isDrafting) return
    if (!dragUser) { setDragUser(m.user_id); return }
    if (dragUser === m.user_id) { setDragUser(null); return }
    const from = members.find(x => x.user_id === dragUser)
    if (from && from.team_side !== m.team_side) {
      handleDrop(m.team_side as 'alpha' | 'bravo', m.user_id)
    } else {
      setDragUser(m.user_id)
    }
  }

  const renderMemberCard = (m: Member) => (
    <div
      key={m.user_id}
      className="card"
      style={{
        padding: '10px 14px',
        cursor: isHost && isDrafting ? 'grab' : undefined,
        borderColor: dragUser === m.user_id ? 'var(--cyan)' : undefined,
        boxShadow: dragUser === m.user_id ? '0 0 14px rgba(0,229,255,0.25)' : undefined,
      }}
      draggable={isHost && isDrafting}
      onDragStart={() => setDragUser(m.user_id)}
      onClick={() => handleCardTap(m)}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{m.display_name}</span>
          {m.user_id === lobby.host_user_id && <span className="badge" style={{ fontSize: 8, marginLeft: 6 }}>HOST</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: ROLE_COLOR[m.weapon_role], padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }}>
            {m.weapon_role}
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>{m.peak_rating}</span>
        </div>
      </div>
    </div>
  )

  const renderTeamPanel = (side: 'alpha' | 'bravo', team: Member[]) => {
    const sideAvg = team.length > 0 ? Math.round(team.reduce((s, m) => s + m.peak_rating, 0) / team.length) : 0
    const arCount = team.filter(m => m.weapon_role === 'AR').length
    const smgCount = team.filter(m => m.weapon_role === 'SMG').length
    const flexCount = team.filter(m => m.weapon_role === 'FLEX').length

    return (
      <div
        className="card"
        style={{ borderColor: side === 'alpha' ? 'rgba(0,229,255,0.3)' : 'rgba(255,43,214,0.3)' }}
        onDragOver={e => e.preventDefault()}
        onDrop={() => handleDrop(side)}
        onClick={() => {
          // 選択中メンバーがいる状態でパネルの空き領域をタップ → このチームへ移動
          if (!dragUser) return
          const from = members.find(x => x.user_id === dragUser)
          if (from && from.team_side !== side) handleDrop(side)
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className={`side-chip ${side}`}>{side.toUpperCase()}</span>
            <span className="badge">{team.length}/4</span>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <span className="mono" style={{ fontSize: 11 }}>PEAK avg <strong style={{ color: 'var(--text-strong)' }}>{sideAvg}</strong></span>
            <span style={{ fontSize: 11 }}>
              <span style={{ color: ROLE_COLOR.AR }}>AR{arCount}</span>{' '}
              <span style={{ color: ROLE_COLOR.SMG }}>SMG{smgCount}</span>{' '}
              <span style={{ color: ROLE_COLOR.FLEX }}>FLX{flexCount}</span>
            </span>
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {team.map(m => (
            <div key={m.user_id} onDragOver={e => e.preventDefault()} onDrop={e => { e.stopPropagation(); handleDrop(side, m.user_id) }} onClick={e => e.stopPropagation()}>
              {renderMemberCard(m)}
            </div>
          ))}
          {Array.from({ length: 4 - team.length }).map((_, i) => (
            <div key={`empty-${i}`} className="empty" style={{ padding: 14, fontSize: 12 }}>空き</div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main>
      <div className="eyebrow">CUSTOM / 8s</div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)' }}>
          <em>{lobby.title}</em>
        </h1>
        <div className="row" style={{ gap: 8 }}>
          {lobby.scheduled_at && <span className="badge violet">🕙 {fmtSchedule(lobby.scheduled_at)} 開催</span>}
          <span className="badge"><span className="badge-dot" />{members.length}/8</span>
          {lobby.rate_cap ? <span className="badge amber">≤ {lobby.rate_cap}</span> : <span className="badge" style={{ fontSize: 9 }}>制限なし</span>}
          <button className="btn-ghost btn-sm" onClick={leaveLobby}>退出</button>
          {isHost && <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={closeLobby}>解散</button>}
        </div>
      </div>

      {/* 8人成立バナー: VC集合の案内 (予約開催なら開催時刻を表示) */}
      {members.length >= 8 && (
        <div className="card" style={{ borderColor: 'rgba(0,245,160,0.4)', background: 'var(--success-soft)', marginTop: 16, padding: '12px 16px' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>
            {lobby.scheduled_at && schedFuture
              ? <>✅ 8人揃いました！ 開催は 🕙 {fmtSchedule(lobby.scheduled_at)} — 時間になったら<span style={{ color: '#5865F2' }}>ASCENT公式Discordサーバー</span>のボイスチャットに集合してください</>
              : <>✅ 8人揃いました！ <span style={{ color: '#5865F2' }}>ASCENT公式Discordサーバー</span>のボイスチャットに集合してください</>}
          </p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            VCに集合後、ホストがチームを振り分けます（参加メンバーにはDiscordとサイト内通知でも案内が飛びます）
          </p>
        </div>
      )}

      {/* Member roster (pre-draft) */}
      {!isDrafting && (
        <div className="section card-strong">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>参加者</h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 11 }}>あなたのロール</span>
              {['AR', 'SMG', 'FLEX'].map(r => (
                <button key={r} type="button" className={`btn-sm ${myRole === r ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 11, minWidth: 50, color: myRole === r ? undefined : ROLE_COLOR[r] }}
                  onClick={() => setRole(r)}>{r}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {members.map(renderMemberCard)}
            {Array.from({ length: 8 - members.length }).map((_, i) => (
              <div key={`e-${i}`} className="empty" style={{ padding: 14, fontSize: 12 }}>待機中...</div>
            ))}
          </div>

          <div className="div" />

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 16 }}>
              <div><span className="stat-label">PEAK平均</span><div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>{avgPeak}</div></div>
              <div><span className="stat-label">ロール</span><div style={{ fontSize: 13 }}>
                <span style={{ color: ROLE_COLOR.AR }}>AR {roleCounts.AR}</span>{' '}
                <span style={{ color: ROLE_COLOR.SMG }}>SMG {roleCounts.SMG}</span>{' '}
                <span style={{ color: ROLE_COLOR.FLEX }}>FLEX {roleCounts.FLEX}</span>
              </div></div>
            </div>
            {isHost && (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-ghost" onClick={() => autoAssign('random')} disabled={busy || members.length !== 8}>ランダム振り分け</button>
                <button className="btn-primary" onClick={() => autoAssign('considered')} disabled={busy || members.length !== 8}>考慮して振り分け</button>
              </div>
            )}
          </div>
          {members.length < 8 && <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>8人揃うと振り分けボタンが有効になります</p>}
          {isAdmin && members.length < 8 && (
            <button className="btn-ghost btn-sm" style={{ marginTop: 8, fontSize: 11 }} disabled={busy} onClick={async () => {
              setBusy(true)
              const { error } = await supabase.rpc('rpc_eights_fill_test_members', { p_lobby_id: lobbyId })
              setBusy(false)
              if (error) showToast(error.message, 'error')
              else void loadData()
            }}>
              [Admin] テスト用メンバーを追加
            </button>
          )}
        </div>
      )}

      {/* Draft view */}
      {isDrafting && (
        <div className="section">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>チーム振り分け</h2>
            {isHost && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-ghost" onClick={() => autoAssign('random')} disabled={busy}>ランダム振り分け</button>
                <button className="btn-primary" onClick={() => autoAssign('considered')} disabled={busy}>考慮して振り分け</button>
                <button
                  onClick={() => void announceTeams()}
                  disabled={busy || alphaTeam.length + bravoTeam.length < 8}
                  style={{ fontSize: 13, fontWeight: 700, background: 'rgba(0,245,160,0.14)', border: '1px solid rgba(0,245,160,0.4)', color: 'var(--success)' }}>
                  📣 この編成をDiscordに送信
                </button>
                <button
                  onClick={() => void reopenLobby()}
                  disabled={busy}
                  style={{ fontSize: 13, fontWeight: 700, background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.35)', color: 'var(--cyan)' }}>
                  🔁 メンバー再募集
                </button>
              </div>
            )}
          </div>
          {isHost && <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>ドラッグ&ドロップ、またはタップで選択→移動先チームをタップしてプレイヤーを移動できます。編成が決まったら「この編成をDiscordに送信」でメンバー全員に共有できます。試合後に続ける場合は、抜ける人に退出してもらってから「メンバー再募集」で残るメンバーを保持したまま不足分を募集できます。</p>}

          {/* Balance meter */}
          <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><span className="side-chip alpha">ALPHA</span><div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{alphaAvg}</div></div>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-label">バランス</div>
                <div style={{ width: 200, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 99, position: 'relative', margin: '8px auto' }}>
                  <div style={{
                    position: 'absolute', top: -3, width: 12, height: 12, borderRadius: '50%',
                    background: diff < 30 ? 'var(--success)' : diff < 80 ? 'var(--amber)' : 'var(--danger)',
                    boxShadow: `0 0 10px ${diff < 30 ? 'var(--success)' : diff < 80 ? 'var(--amber)' : 'var(--danger)'}`,
                    left: `${50 + Math.max(-50, Math.min(50, (alphaAvg - bravoAvg) / 6))}%`, transform: 'translateX(-50%)',
                  }} />
                </div>
                <div className="mono" style={{ fontSize: 12, color: diff < 30 ? 'var(--success)' : diff < 80 ? 'var(--amber)' : 'var(--danger)' }}>
                  差 {diff}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}><span className="side-chip bravo">BRAVO</span><div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{bravoAvg}</div></div>
            </div>
          </div>

          <div className="grid-2">
            {renderTeamPanel('alpha', alphaTeam)}
            {renderTeamPanel('bravo', bravoTeam)}
          </div>
        </div>
      )}

      {/* ルール要約 (常設) */}
      <div className="section">
        <div className="card" style={{ padding: '16px 18px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="stat-label">8s ルール要約</span>
            <button className="btn-ghost btn-sm" onClick={() => router.push('/rules')}>GAルール詳細を見る</button>
          </div>
          <div className="stack-sm" style={{ fontSize: 12.5 }}>
            <div className="muted">・8人そろったらホストがチームを振り分け（ランダム / レート+ロール考慮）。レート変動はありません</div>
            <div className="muted">・試合後に続ける場合は、抜ける人が「退出」→ ホストが「メンバー再募集」で残るメンバーを保持したまま不足分を募集できます（ホストが退出してもロビーは残り、ホスト権限は引き継がれます）</div>
            <div className="muted">・武器ロール（AR / SMG / FLEX）は各自で選択してください</div>
            <div className="muted">・使用武器・アタッチメント・パークなどはGA（紳士協定）準拠。チート・コンバーター使用禁止</div>
            <div className="muted">・暴言・煽り行為禁止。違反があれば通報機能から報告してください</div>
          </div>
        </div>
      </div>
    </main>
  )
}
