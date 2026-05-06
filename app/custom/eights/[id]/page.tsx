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

export default function EightsLobbyPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const lobbyId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [lobby, setLobby] = useState<{ title: string; host_user_id: string; status: string; rate_cap: number | null } | null>(null)
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
      supabase.from('eights_lobbies').select('title, host_user_id, status, rate_cap').eq('id', lobbyId).maybeSingle(),
      supabase.from('eights_lobby_members').select('user_id, weapon_role, team_side').eq('lobby_id', lobbyId),
    ])
    setLobby(l as typeof lobby)

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
    await supabase.rpc('rpc_eights_set_role', { p_lobby_id: lobbyId, p_role: role })
    void loadData()
  }

  const leaveLobby = async () => {
    await supabase.rpc('rpc_eights_leave_lobby', { p_lobby_id: lobbyId })
    router.push('/custom')
  }

  const autoAssign = async (mode: string) => {
    setBusy(true)
    const { error } = await supabase.rpc('rpc_eights_auto_assign', { p_lobby_id: lobbyId, p_mode: mode })
    setBusy(false)
    if (error) showToast(error.message, 'error')
    else void loadData()
  }

  const movePlayer = async (userId: string, toSide: string, swapWith?: string) => {
    await supabase.rpc('rpc_eights_move_player', {
      p_lobby_id: lobbyId, p_user_id: userId, p_to_side: toSide, p_swap_with: swapWith ?? null,
    })
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

  const renderMemberCard = (m: Member) => (
    <div
      key={m.user_id}
      className="card"
      style={{ padding: '10px 14px', cursor: isHost && isDrafting ? 'grab' : undefined }}
      draggable={isHost && isDrafting}
      onDragStart={() => setDragUser(m.user_id)}
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
            <div key={m.user_id} onDragOver={e => e.preventDefault()} onDrop={e => { e.stopPropagation(); handleDrop(side, m.user_id) }}>
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
          <span className="badge"><span className="badge-dot" />{members.length}/8</span>
          {lobby.rate_cap ? <span className="badge amber">≤ {lobby.rate_cap}</span> : <span className="badge" style={{ fontSize: 9 }}>制限なし</span>}
          <button className="btn-ghost btn-sm" onClick={leaveLobby}>退出</button>
        </div>
      </div>

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
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-ghost" onClick={() => autoAssign('random')} disabled={busy}>ランダム振り分け</button>
                <button className="btn-primary" onClick={() => autoAssign('considered')} disabled={busy}>考慮して振り分け</button>
              </div>
            )}
          </div>
          {isHost && <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>ドラッグ&ドロップでプレイヤーをチーム間で移動できます。</p>}

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
    </main>
  )
}
