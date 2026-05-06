'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

type ScrimSession = {
  id: string; status: string; alpha_party_id: string; bravo_party_id: string
  host_side: string | null; end_requested_by: string | null; started_at: string
}

type PartyMember = { user_id: string; display_name: string; peak_rating: number }
type ChatMsg = { id: string; sender_user_id: string | null; message_type: string; body: string; created_at: string; sender_name?: string }

const HP_MAPS = ['Rewind', 'Skyline', 'Vault', 'Dealership', 'Hideout']
const SCRIM_TIMEOUT_MS = 90 * 60 * 1000 // 1.5 hours

export default function ScrimLobbyPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const scrimId = typeof params.id === 'string' ? params.id : null

  const [loading, setLoading] = useState(true)
  const [scrim, setScrim] = useState<ScrimSession | null>(null)
  const [alphaMembers, setAlphaMembers] = useState<PartyMember[]>([])
  const [bravoMembers, setBravoMembers] = useState<PartyMember[]>([])
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [mySide, setMySide] = useState<'alpha' | 'bravo' | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showTimeout, setShowTimeout] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    if (!scrimId) return
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)

    const { data: s } = await supabase.from('scrim_sessions').select('*').eq('id', scrimId).maybeSingle()
    if (!s) { setLoading(false); return }
    const scrimData = s as ScrimSession
    setScrim(scrimData)

    // Load both parties' members
    const loadParty = async (partyId: string) => {
      const { data: pm } = await supabase.from('party_members').select('user_id').eq('party_id', partyId)
      const uids = ((pm ?? []) as { user_id: string }[]).map(m => m.user_id)
      if (uids.length === 0) return []
      const { data: profiles } = await supabase.from('profiles').select('id, display_name, peak_rating').in('id', uids)
      return (profiles ?? []).map((p: { id: string; display_name: string | null; peak_rating: number | null }) => ({
        user_id: p.id, display_name: p.display_name ?? '不明', peak_rating: p.peak_rating ?? 1500,
      }))
    }

    const [alpha, bravo] = await Promise.all([loadParty(scrimData.alpha_party_id), loadParty(scrimData.bravo_party_id)])
    setAlphaMembers(alpha)
    setBravoMembers(bravo)

    // Determine my side
    if (uid && alpha.some(m => m.user_id === uid)) setMySide('alpha')
    else if (uid && bravo.some(m => m.user_id === uid)) setMySide('bravo')

    // Load messages
    const { data: msgs } = await supabase.from('scrim_messages').select('*').eq('scrim_id', scrimId).order('created_at')
    const msgRows = (msgs ?? []) as ChatMsg[]
    // Resolve sender names
    const senderIds = [...new Set(msgRows.filter(m => m.sender_user_id).map(m => m.sender_user_id!))]
    const { data: senderProfiles } = senderIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', senderIds)
      : { data: [] }
    const nameMap = new Map((senderProfiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? '不明']))
    setMessages(msgRows.map(m => ({ ...m, sender_name: m.sender_user_id ? nameMap.get(m.sender_user_id) ?? '不明' : undefined })))
    setLoading(false)
  }, [scrimId])

  useEffect(() => { void loadData() }, [loadData])

  // Realtime chat
  useEffect(() => {
    if (!scrimId) return
    const ch = supabase.channel(`scrim-${scrimId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scrim_messages', filter: `scrim_id=eq.${scrimId}` }, () => { void loadData() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrim_sessions', filter: `id=eq.${scrimId}` }, () => { void loadData() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [scrimId, loadData])

  // Scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Timeout check (1.5 hours)
  useEffect(() => {
    if (!scrim) return
    const startTime = new Date(scrim.started_at).getTime()
    const remaining = SCRIM_TIMEOUT_MS - (Date.now() - startTime)
    if (remaining <= 0) { setShowTimeout(true); return }
    const t = setTimeout(() => setShowTimeout(true), remaining)
    return () => clearTimeout(t)
  }, [scrim])

  const sendMessage = async () => {
    if (!chatInput.trim()) return
    await supabase.rpc('rpc_scrim_send_message', { p_scrim_id: scrimId, p_body: chatInput })
    setChatInput('')
  }

  const lotteryHost = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_scrim_lottery_host', { p_scrim_id: scrimId })
    setBusy(false)
    if (error) showToast(error.message, 'error')
    else void loadData()
  }

  const requestEnd = async () => {
    if (!mySide) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_scrim_request_end', { p_scrim_id: scrimId, p_side: mySide })
    setBusy(false)
    if (error) showToast(error.message, 'error')
    else void loadData()
  }

  const acceptEnd = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('rpc_scrim_accept_end', { p_scrim_id: scrimId })
    setBusy(false)
    if (error) showToast(error.message, 'error')
    else { showToast('scrimが終了しました', 'success'); router.push('/custom') }
  }

  if (loading) return <main><LoadingSkeleton cards={2} /></main>
  if (!scrim) return <main><p className="danger">scrimが見つかりません</p></main>

  const alphaAvg = alphaMembers.length > 0 ? Math.round(alphaMembers.reduce((s, m) => s + m.peak_rating, 0) / alphaMembers.length) : 0
  const bravoAvg = bravoMembers.length > 0 ? Math.round(bravoMembers.reduce((s, m) => s + m.peak_rating, 0) / bravoMembers.length) : 0
  const isCompleted = scrim.status === 'completed'
  const endRequested = scrim.status === 'end_requested'
  const otherSideRequested = endRequested && scrim.end_requested_by !== mySide

  const renderTeam = (side: 'alpha' | 'bravo', members: PartyMember[], avg: number) => (
    <div className="card" style={{ borderColor: side === 'alpha' ? 'rgba(0,229,255,0.3)' : 'rgba(255,43,214,0.3)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className={`side-chip ${side}`}>{side.toUpperCase()}</span>
        <span className="mono" style={{ fontSize: 12 }}>PEAK avg <strong>{avg}</strong></span>
      </div>
      {scrim.host_side === side && <span className="badge success" style={{ marginBottom: 8 }}><span className="badge-dot" />HOST</span>}
      <div className="stack" style={{ gap: 6 }}>
        {members.map(m => (
          <div key={m.user_id} className="row" style={{ gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{m.display_name}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>{m.peak_rating}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <main>
      <div className="eyebrow">CUSTOM / SCRIM LOBBY</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', marginTop: 6 }}>
        <em>Scrim ロビー</em>
      </h1>

      {isCompleted && (
        <div className="section card" style={{ borderLeft: '3px solid var(--success)', padding: '14px 18px' }}>
          <p style={{ fontWeight: 700, color: 'var(--success)', margin: 0 }}>scrim終了 — レート変動なし</p>
          <button className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => router.push('/custom')}>カスタムに戻る</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 16 }}>
        {/* Left: teams + actions */}
        <div className="stack" style={{ gap: 16 }}>
          <div className="grid-2" style={{ gap: 12 }}>
            {renderTeam('alpha', alphaMembers, alphaAvg)}
            {renderTeam('bravo', bravoMembers, bravoAvg)}
          </div>

          {/* Actions */}
          {!isCompleted && (
            <div className="card-strong">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-primary btn-sm" onClick={lotteryHost} disabled={busy || !!scrim.host_side}>
                  {scrim.host_side ? `ホスト: ${scrim.host_side.toUpperCase()}` : 'ホスト抽選'}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setShowRules(true)}>ルール一覧</button>
                <button className="btn-ghost btn-sm" onClick={() => router.push('/reports/new')} style={{ color: 'var(--danger)' }}>通報</button>
                {!endRequested && (
                  <button className="btn-danger btn-sm" onClick={requestEnd} disabled={busy}>scrimを終了する</button>
                )}
                {otherSideRequested && (
                  <button className="btn-primary btn-sm" onClick={acceptEnd} disabled={busy}>終了を承諾する</button>
                )}
                {endRequested && scrim.end_requested_by === mySide && (
                  <span className="muted" style={{ fontSize: 12 }}>相手の承諾を待っています...</span>
                )}
              </div>
            </div>
          )}

          {/* HP Map Pool */}
          <div className="card">
            <div className="stat-label" style={{ marginBottom: 10 }}>HARDPOINT マッププール</div>
            <div className="row" style={{ gap: 10 }}>
              {HP_MAPS.map(m => (
                <div key={m} style={{
                  flex: 1, padding: '16px 10px', textAlign: 'center', borderRadius: 'var(--r-md)',
                  background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)',
                }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>{m}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>HARDPOINT</div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>ホストがマップを選択してください。バンピックは行いません。</p>
          </div>
        </div>

        {/* Right: Chat */}
        <div className="card-strong" style={{ display: 'flex', flexDirection: 'column', maxHeight: 500 }}>
          <div className="stat-label" style={{ marginBottom: 8 }}>CHAT</div>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
            {messages.map(m => (
              <div key={m.id} style={{ marginBottom: 8 }}>
                {m.message_type === 'system' ? (
                  <div style={{ fontSize: 11, color: 'var(--cyan)', fontStyle: 'italic', padding: '4px 0' }}>{m.body}</div>
                ) : (
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-strong)' }}>{m.sender_name}</span>
                    <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>{new Date(m.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
                    <div style={{ fontSize: 13, marginTop: 2 }}>{m.body}</div>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {!isCompleted && (
            <div className="row" style={{ gap: 8 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void sendMessage() }}
                placeholder="メッセージを送信..."
                style={{ flex: 1 }}
                aria-label="チャットメッセージ"
              />
              <button className="btn-primary btn-sm" onClick={() => void sendMessage()}>送信</button>
            </div>
          )}
        </div>
      </div>

      {/* Rules modal */}
      {showRules && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}
          onClick={() => setShowRules(false)}>
          <div className="card-strong markdown-body" style={{ maxWidth: 600, width: '100%', maxHeight: '80vh', overflowY: 'auto', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Scrim ルール</h2>
            <ul>
              <li>モード: Hardpoint のみ</li>
              <li>マッププール: {HP_MAPS.join(', ')}</li>
              <li>バンピックなし（ホストがマップ選択）</li>
              <li>GA（紳士協定）準拠</li>
              <li>チート・コンバーター使用禁止</li>
              <li>暴言・煽り行為禁止</li>
              <li>レート変動なし</li>
            </ul>
            <button className="btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setShowRules(false)}>閉じる</button>
          </div>
        </div>
      )}

      {/* Timeout dialog */}
      {showTimeout && !isCompleted && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <div className="card-strong" style={{ maxWidth: 420, width: '100%', textAlign: 'center', overflow: 'visible' }}>
            <h2 style={{ marginTop: 0, color: 'var(--amber)' }}>scrim開始から1時間半経過しました</h2>
            <p>scrimを終了しますか？</p>
            <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn-ghost" onClick={() => setShowTimeout(false)}>続ける</button>
              <button className="btn-danger" onClick={requestEnd}>終了する</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
