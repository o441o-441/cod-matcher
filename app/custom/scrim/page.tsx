'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

type ProfileRow = { id: string; display_name: string; current_rating: number; peak_rating: number; is_banned: boolean }
type PartyRow = { id: string; leader_user_id: string; party_type: string; status: string }
type PartyMemberRow = { id: string; party_id: string; user_id: string; profiles?: { id: string; display_name: string; current_rating: number | null; peak_rating: number | null } | null }
type QueueEntryRow = { id: string; party_id: string; status: string; avg_rating: number; created_at: string }
type PendingInviteRow = { invite_id: string; party_id: string; inviter_user_id: string; inviter_display_name: string; created_at: string }
type PartyInviteRow = { id: string; invitee_user_id: string; status: string; created_at: string }

function partyLabel(n: number) { return n === 1 ? 'SOLO' : n === 2 ? 'DUO' : n === 3 ? 'TRIO' : n === 4 ? 'FULL' : '--' }

export default function ScrimQueuePage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [myParty, setMyParty] = useState<PartyRow | null>(null)
  const [members, setMembers] = useState<PartyMemberRow[]>([])
  const [invites, setInvites] = useState<PartyInviteRow[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([])
  const [friends, setFriends] = useState<{ friend_user_id: string; friend_display_name: string | null }[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [waitingEntry, setWaitingEntry] = useState<QueueEntryRow | null>(null)
  const [waitSec, setWaitSec] = useState(0)
  const [myTeam, setMyTeam] = useState<{ id: string; name: string; members: { auth_user_id: string; display_name: string | null }[] } | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [infoText, setInfoText] = useState<string | null>(null)

  const isWaiting = !!waitingEntry
  const isLeader = !!myParty && myParty.leader_user_id === myUserId
  const partySize = members.length

  const loadState = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id ?? null
      setMyUserId(uid)
      if (!uid) { setLoading(false); return }

      const [{ data: prof }, { data: pm }, { data: pendInv }, { data: fr }, { data: membership }] = await Promise.all([
        supabase.from('profiles').select('id,display_name,current_rating,peak_rating,is_banned').eq('id', uid).maybeSingle(),
        supabase.from('party_members').select('party_id').eq('user_id', uid).maybeSingle(),
        opts?.silent ? Promise.resolve({ data: null }) : supabase.rpc('rpc_list_my_pending_party_invites'),
        opts?.silent ? Promise.resolve({ data: null }) : supabase.rpc('rpc_list_my_friends'),
        opts?.silent ? Promise.resolve({ data: null }) : supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle(),
      ])

      setProfile(prof as ProfileRow | null)
      if (!opts?.silent) setPendingInvites((pendInv as PendingInviteRow[] | null) ?? [])
      if (!opts?.silent) setFriends((fr as { friend_user_id: string; friend_display_name: string | null }[] | null) ?? [])

      // Team info
      if (!opts?.silent && (membership as { team_id: string } | null)?.team_id) {
        const tid = (membership as { team_id: string }).team_id
        const [{ data: teamRow }, { data: teamMembers }] = await Promise.all([
          supabase.from('teams').select('id, name').eq('id', tid).maybeSingle(),
          supabase.from('team_members').select('user_id, profiles!inner(id, display_name)').eq('team_id', tid),
        ])
        if (teamRow) {
          const others = ((teamMembers ?? []) as unknown as { user_id: string; profiles: { id: string; display_name: string | null } }[])
            .filter(m => m.user_id !== uid)
            .map(m => ({ auth_user_id: m.user_id, display_name: m.profiles?.display_name ?? null }))
          setMyTeam({ id: (teamRow as { id: string; name: string }).id, name: (teamRow as { id: string; name: string }).name, members: others })
        }
      }

      const partyId = (pm as { party_id: string } | null)?.party_id ?? null
      if (!partyId) {
        // Auto-create solo party
        if (prof && !(prof as ProfileRow).is_banned) {
          await supabase.rpc('rpc_create_party', { p_source_team_id: null })
          if (!opts?.silent) { setLoading(false); void loadState() }
          return
        }
        setMyParty(null); setMembers([]); setWaitingEntry(null)
        if (!opts?.silent) setLoading(false)
        return
      }

      // Check if already in scrim
      const { data: scrim } = await supabase.from('scrim_sessions')
        .select('id').or(`alpha_party_id.eq.${partyId},bravo_party_id.eq.${partyId}`)
        .in('status', ['lobby', 'end_requested']).maybeSingle()
      if (scrim) { router.push(`/custom/scrim/${(scrim as { id: string }).id}`); return }

      const { data: partyData } = await supabase.from('parties').select('id,leader_user_id,party_type,status').eq('id', partyId).maybeSingle()
      setMyParty(partyData as PartyRow | null)

      if (partyData) {
        const [{ data: memData }, { data: invData }, { data: qeData }] = await Promise.all([
          supabase.from('party_members').select('id,party_id,user_id,profiles!party_members_user_id_fkey(id,display_name,current_rating,peak_rating)').eq('party_id', partyId),
          supabase.from('party_invites').select('id,invitee_user_id,status,created_at').eq('party_id', partyId).order('created_at', { ascending: false }),
          supabase.from('queue_entries').select('id,party_id,status,avg_rating,created_at').eq('party_id', partyId).eq('queue_type', 'scrim').eq('status', 'waiting').maybeSingle(),
        ])
        setMembers((memData ?? []) as unknown as PartyMemberRow[])
        setInvites((invData ?? []) as PartyInviteRow[])
        setWaitingEntry(qeData as QueueEntryRow | null)
      }
    } catch (e) { console.error(e); setErrorText('状態の読み込みに失敗しました') }
    finally { if (!opts?.silent) setLoading(false) }
  }, [router])

  useEffect(() => { void loadState() }, [loadState])

  // Realtime
  useEffect(() => {
    if (!myUserId) return
    const ch = supabase.channel(`scrim-q-${myUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => void loadState({ silent: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members' }, () => void loadState({ silent: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_invites' }, () => void loadState({ silent: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, () => void loadState({ silent: true }))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [myUserId, loadState])

  // Wait timer
  useEffect(() => {
    if (!waitingEntry?.created_at) { setWaitSec(0); return }
    const tick = () => setWaitSec(Math.max(0, Math.floor((Date.now() - new Date(waitingEntry.created_at).getTime()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [waitingEntry?.created_at])

  // Heartbeat (15s interval) — same approach as /match page
  useEffect(() => {
    const interval = setInterval(() => {
      void loadState({ silent: true })
      const uid = myUserId
      if (uid) {
        void (async () => {
          const { data: pm } = await supabase.from('party_members').select('party_id').eq('user_id', uid)
          const pids = (pm ?? []).map((r: { party_id: string }) => r.party_id)
          if (pids.length > 0) {
            const { data: qe } = await supabase.from('queue_entries').select('id').in('party_id', pids).eq('status', 'waiting').limit(1).maybeSingle()
            if (qe?.id) {
              await supabase.rpc('rpc_queue_heartbeat', { p_queue_entry_id: qe.id })
            }
          }
        })()
      }
    }, 15000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId])

  // Auto-match poll (5s interval, leader only)
  useEffect(() => {
    if (!isWaiting || !isLeader) return
    const iv = setInterval(async () => {
      await supabase.rpc('rpc_scrim_create_match')
      void loadState({ silent: true })
    }, 5000)
    return () => clearInterval(iv)
  }, [isWaiting, isLeader, loadState])

  const handleCreateParty = async () => {
    setBusy(true); setErrorText(null)
    const { error } = await supabase.rpc('rpc_create_party', { p_source_team_id: null })
    setBusy(false)
    if (error) { setErrorText(error.message); return }
    setInfoText('パーティを作成しました')
    void loadState()
  }

  const handleCreateFromTeam = async () => {
    if (!myTeam) return
    setBusy(true); setErrorText(null)
    const { error } = await supabase.rpc('rpc_create_party', { p_source_team_id: myTeam.id })
    if (error) { setBusy(false); setErrorText(error.message); return }
    // Find new party and invite team members
    const { data: newP } = await supabase.from('parties').select('id').eq('leader_user_id', myUserId!).in('status', ['open']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (newP) {
      for (const m of myTeam.members) {
        await supabase.rpc('rpc_invite_to_party', { p_party_id: (newP as { id: string }).id, p_invitee_user_id: m.auth_user_id })
      }
    }
    setBusy(false)
    setInfoText(`パーティを作成し、${myTeam.members.length}名に招待を送信しました`)
    void loadState()
  }

  const handleInvite = async () => {
    if (!myParty?.id || !selectedFriendId) return
    setBusy(true); setErrorText(null)
    const { error } = await supabase.rpc('rpc_invite_to_party', { p_party_id: myParty.id, p_invitee_user_id: selectedFriendId })
    setBusy(false)
    if (error) { setErrorText(error.message); return }
    setSelectedFriendId(''); setInfoText('招待を送信しました')
    void loadState()
  }

  const handleAcceptInvite = async (id: string) => {
    setBusy(true)
    await supabase.rpc('rpc_accept_party_invite', { p_invite_id: id })
    setBusy(false); void loadState()
  }
  const handleRejectInvite = async (id: string) => {
    setBusy(true)
    await supabase.rpc('rpc_reject_party_invite', { p_invite_id: id })
    setBusy(false); void loadState()
  }

  const handleStartQueue = async () => {
    if (!myParty?.id) return
    setBusy(true); setErrorText(null)
    const { error } = await supabase.rpc('rpc_queue_existing_party', { p_party_id: myParty.id, p_queue_type: 'scrim' })
    setBusy(false)
    if (error) { setErrorText(error.message); return }
    setInfoText('Scrimキューに入りました')
    void loadState()
  }

  const handleCancelQueue = async () => {
    if (!waitingEntry?.id) return
    setBusy(true)
    await supabase.rpc('rpc_cancel_queue', { p_queue_entry_id: waitingEntry.id })
    setBusy(false); setInfoText('キューをキャンセルしました')
    void loadState()
  }

  const handleDisband = async () => {
    if (!myParty?.id) return
    setBusy(true)
    await supabase.rpc('rpc_disband_party', { p_party_id: myParty.id })
    setBusy(false); void loadState()
  }

  const handleLeave = async () => {
    if (!myParty?.id) return
    setBusy(true)
    await supabase.rpc('rpc_leave_party', { p_party_id: myParty.id })
    setBusy(false); void loadState()
  }

  const avgPeak = useMemo(() => {
    if (members.length === 0) return profile?.peak_rating ?? 0
    return Math.round(members.reduce((s, m) => s + (m.profiles?.peak_rating ?? 1500), 0) / members.length)
  }, [members, profile])

  const canQueue = !!myParty && isLeader && !busy && !isWaiting && partySize >= 1 && ['open', 'cancelled'].includes(myParty.status)

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  const slots = Array.from({ length: 4 }, (_, i) => members[i] ?? null)

  return (
    <main>
      <div className="rowx" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">SCRIM MATCHMAKING</span>
          <h1 style={{ marginBottom: 0 }}>Scrim キュー</h1>
          <p className="muted" style={{ marginTop: 4 }}>パーティを組んでScrim相手を探す（ソロ参加OK）</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => router.push('/custom')}>カスタムに戻る</button>
      </div>

      {errorText && <div className="card" style={{ borderColor: 'rgba(255,77,109,0.35)', background: 'var(--danger-soft)', marginBottom: 16 }}><span className="danger" style={{ fontSize: 14 }}>{errorText}</span></div>}
      {infoText && <div className="card" style={{ borderColor: 'rgba(0,245,160,0.35)', background: 'var(--success-soft)', marginBottom: 16 }}><span className="success" style={{ fontSize: 14 }}>{infoText}</span></div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
        {/* LEFT */}
        <div className="stack">
          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <div className="card-strong">
              <div className="sec-title">自分宛の招待</div>
              <div className="stack">
                {pendingInvites.map(inv => (
                  <div key={inv.invite_id} className="card">
                    <div className="rowx">
                      <span style={{ fontWeight: 700 }}>{inv.inviter_display_name}</span>
                      <div className="row">
                        <button onClick={() => handleAcceptInvite(inv.invite_id)} disabled={busy} className="btn-primary btn-sm">承認</button>
                        <button onClick={() => handleRejectInvite(inv.invite_id)} disabled={busy} className="btn-danger btn-sm">拒否</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Party panel */}
          <div className="card-strong">
            <div className="sec-title">パーティ編成</div>
            <div className="rowx" style={{ marginBottom: 16 }}>
              <div className="row">
                <span className="badge"><span className="badge-dot" />{partyLabel(partySize)} {partySize}/4</span>
                {myParty && <span className="badge" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-soft)' }}>{myParty.status === 'open' ? '待機可' : myParty.status === 'queued' ? 'キュー中' : myParty.status}</span>}
              </div>
              <span className="mono muted" style={{ fontSize: 13 }}>PEAK AVG {avgPeak}</span>
            </div>

            {/* 4-slot grid */}
            <div className="g4" style={{ marginBottom: 16 }}>
              {slots.map((m, i) => m ? (
                <div key={m.id} className="card glow-hover" style={{ textAlign: 'center', padding: '16px 8px', cursor: 'pointer' }} onClick={() => router.push(`/users/${m.user_id}`)}>
                  {myParty && m.user_id === myParty.leader_user_id && <div style={{ position: 'absolute', top: 6, left: 8, color: 'var(--amber)', fontSize: 14 }} title="リーダー"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 19h19v2h-19zM22.7 7.3l-4.6 5.2-5.1-7.2L8 12.5 2.3 7.3 4.1 18h15.8z"/></svg></div>}
                  <div className="avatar" style={{ width: 48, height: 48, fontSize: 16, margin: '0 auto 8px' }}>{(m.profiles?.display_name ?? '?')[0].toUpperCase()}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.profiles?.display_name ?? m.user_id.slice(0, 8)}</div>
                  <div className="row" style={{ justifyContent: 'center', marginTop: 6, gap: 6 }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>PEAK {m.profiles?.peak_rating ?? '---'}</span>
                  </div>
                </div>
              ) : (
                <div key={`e-${i}`} className="card" style={{ borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 8px', opacity: 0.6, minHeight: 140 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  <span className="dim" style={{ fontSize: 12, marginTop: 6 }}>招待</span>
                </div>
              ))}
            </div>

            {/* Create / invite / manage */}
            {!myParty && (
              <div className="row" style={{ marginBottom: 12 }}>
                <button onClick={handleCreateParty} disabled={busy} className="btn-primary">パーティ作成</button>
                {myTeam && <button onClick={handleCreateFromTeam} disabled={busy}>チーム「{myTeam.name}」で作成+招待</button>}
              </div>
            )}

            {myParty && isLeader && partySize < 4 && !isWaiting && (
              <div className="card" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'block' }}>メンバー招待</span>
                {friends.length === 0 ? (
                  <span className="muted" style={{ fontSize: 13 }}>招待できるフレンドがいません</span>
                ) : (
                  <div className="row">
                    <select value={selectedFriendId} onChange={e => setSelectedFriendId(e.target.value)} disabled={busy} style={{ flex: 1 }} aria-label="フレンドを選択">
                      <option value="">フレンドを選択...</option>
                      {friends.filter(f => !members.some(m => m.user_id === f.friend_user_id)).map(f => (
                        <option key={f.friend_user_id} value={f.friend_user_id}>{f.friend_display_name ?? f.friend_user_id}</option>
                      ))}
                    </select>
                    <button onClick={handleInvite} disabled={busy || !selectedFriendId} className="btn-primary btn-sm">招待送信</button>
                  </div>
                )}
              </div>
            )}

            {myParty && invites.length > 0 && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="stat-label" style={{ marginBottom: 8 }}>招待履歴</div>
                <div className="stack-sm">
                  {invites.map(inv => (
                    <div key={inv.id} className="rowx" style={{ fontSize: 12 }}>
                      <span className="mono dim">{inv.invitee_user_id.slice(0, 12)}...</span>
                      <span className={`badge ${inv.status === 'accepted' ? 'success' : inv.status === 'rejected' ? 'danger' : ''}`} style={{ fontSize: 9 }}>
                        {inv.status === 'pending' ? '承認待ち' : inv.status === 'accepted' ? '承認済み' : inv.status === 'rejected' ? '拒否' : inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {myParty && (
              <div className="row">
                {canQueue && <button onClick={handleStartQueue} className="btn-primary">Scrim 開始</button>}
                {isLeader && partySize > 1 ? <button onClick={handleDisband} disabled={busy || isWaiting} className="btn-danger">パーティ解散</button>
                  : !isLeader ? <button onClick={handleLeave} disabled={busy || isWaiting} className="btn-danger">パーティ脱退</button> : null}
              </div>
            )}
          </div>

          {/* Searching */}
          {isWaiting && (
            <div className="card-strong">
              <span className="badge magenta" style={{ marginBottom: 16 }}><span className="badge-dot" style={{ animation: 'pulse-glow 1.5s ease-in-out infinite' }} />SEARCHING</span>
              <div className="flicker" style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 800, background: 'linear-gradient(135deg, #fff, var(--magenta))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 16 }}>
                Scrim相手を探索中...
              </div>
              <div className="row" style={{ gap: 24, marginBottom: 16 }}>
                <div className="stat"><span className="stat-label">待機時間</span><span className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--magenta)' }}>{Math.floor(waitSec / 60)}:{String(waitSec % 60).padStart(2, '0')}</span></div>
                <div className="stat"><span className="stat-label">パーティ</span><span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>{partyLabel(partySize)} ({partySize})</span></div>
                <div className="stat"><span className="stat-label">PEAK AVG</span><span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{avgPeak}</span></div>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>PEAK平均が近いパーティを検索しています... ソロの場合は助っ人として合流します</p>
              <div style={{ marginTop: 12 }}><button onClick={handleCancelQueue} disabled={busy} className="btn-danger">待機解除</button></div>
            </div>
          )}

          {!isWaiting && <div className="card" style={{ textAlign: 'center', padding: 32 }}><span className="muted">パーティを作成して「Scrim 開始」を押してください（ソロでもOK）</span></div>}
        </div>

        {/* RIGHT sidebar */}
        <div className="stack">
          <div className="card-strong">
            <div className="sec-title">Scrim キュー情報</div>
            <div className="stack">
              <div className="rowx"><span className="stat-label">ステータス</span><span style={{ fontWeight: 700 }}>{isWaiting ? 'キュー中' : myParty ? '待機可' : '未参加'}</span></div>
              <div className="div" />
              <div className="rowx"><span className="stat-label">パーティ</span><span style={{ fontWeight: 700 }}>{myParty ? `${partyLabel(partySize)} (${partySize}/4)` : '--'}</span></div>
              <div className="div" />
              <div className="rowx"><span className="stat-label">PEAK AVG</span><span className="mono" style={{ fontWeight: 700 }}>{myParty ? avgPeak : '--'}</span></div>
              <div className="div" />
              <div className="rowx"><span className="stat-label">タイプ</span><span className="badge magenta" style={{ fontSize: 9 }}>SCRIM</span></div>
              <div className="div" />
              <div className="rowx"><span className="stat-label">レート変動</span><span style={{ fontWeight: 700, color: 'var(--text-soft)' }}>なし</span></div>
            </div>
          </div>
          <div className="card">
            <div className="sec-title">Scrimについて</div>
            <div className="stack-sm" style={{ fontSize: 13 }}>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>1.</span>パーティを作成（ソロ〜4人）</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>2.</span>「Scrim 開始」でキューイン</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>3.</span>PEAK平均が近い相手と自動マッチ</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>4.</span>ロビーでチャット+ホスト抽選</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>5.</span>HP全マップを実施（バンピックなし）</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>6.</span>レート変動なし</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
