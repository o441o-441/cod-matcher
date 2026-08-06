'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ConfirmDialog from '@/components/ConfirmDialog'

// ============================================================
// 交流戦の試合ページ — 成立した対戦の連絡用チャット。
// 両チームのメンバーだけが読める。個人の Discord ID は使わず、
// ホスト決め・ロビーコード共有・時間調整はここで完結させる。
// ============================================================

type MatchRow = {
  id: string
  date: string
  slot_start: number
  slot_end: number
  host_team_id: string
  guest_team_id: string
  hp_maps: number
  snd_maps: number
  ovl_maps: number
  status: string
}

type MessageRow = {
  id: string
  sender_user_id: string | null
  message_type: 'text' | 'lobby_code' | 'system'
  body: string
  created_at: string
}

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const slotLabel = (i: number) => `${20 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`

function matchLabel(m: { hp_maps: number; snd_maps: number; ovl_maps: number }) {
  if (m.hp_maps === 6 && m.snd_maps === 0 && m.ovl_maps === 0) return 'ハーポ回し'
  const parts: string[] = []
  if (m.hp_maps > 0) parts.push(`ハーポ${m.hp_maps}`)
  if (m.snd_maps > 0) parts.push(`サーチ${m.snd_maps}`)
  if (m.ovl_maps > 0) parts.push(`オバロ${m.ovl_maps}`)
  return parts.join(' + ')
}

function dateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dd = new Date(y, m - 1, d)
  return `${m}/${d} (${DOW[dd.getDay()]})`
}

export default function ScrimMatchPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = typeof params.matchId === 'string' ? params.matchId : Array.isArray(params.matchId) ? params.matchId[0] : ''
  const matchId = UUID_RE.test(rawId) ? rawId : ''

  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [contacts, setContacts] = useState<Record<string, string | null>>({})
  const [memberNames, setMemberNames] = useState<Record<string, { name: string; teamId: string }>>({})
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [lobbyCode, setLobbyCode] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const chatBoxRef = useRef<HTMLDivElement | null>(null)
  const chatPrevCountRef = useRef(0)

  const isMember = !!myTeamId && !!match && (match.host_team_id === myTeamId || match.guest_team_id === myTeamId)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const loadMessages = useCallback(async () => {
    if (!matchId) return
    const { data } = await supabase
      .from('scrim_match_messages')
      .select('id, sender_user_id, message_type, body, created_at')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })
      .limit(300)
    setMessages((data ?? []) as MessageRow[])
  }, [matchId])

  const loadMatch = useCallback(async () => {
    if (!matchId) return
    const { data } = await supabase.from('scrim_matches').select('*').eq('id', matchId).maybeSingle()
    setMatch((data as MatchRow | null) ?? null)
  }, [matchId])

  // 初期化
  useEffect(() => {
    const init = async () => {
      try {
        if (!matchId) { setLoading(false); return }
        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id ?? null
        setMyUserId(uid)

        const { data: matchRow } = await supabase.from('scrim_matches').select('*').eq('id', matchId).maybeSingle()
        const m = matchRow as MatchRow | null
        setMatch(m)
        if (!m) { setLoading(false); return }

        const teamIds = [m.host_team_id, m.guest_team_id]
        const [{ data: teamRows }, { data: prefRows }] = await Promise.all([
          supabase.from('teams').select('id, name').in('id', teamIds),
          supabase.from('scrim_team_prefs').select('team_id, public_contact').in('team_id', teamIds),
        ])
        const tn: Record<string, string> = {}
        for (const t of (teamRows ?? []) as { id: string; name: string }[]) tn[t.id] = t.name
        setTeamNames(tn)
        const cm: Record<string, string | null> = {}
        for (const p of (prefRows ?? []) as { team_id: string; public_contact: string | null }[]) cm[p.team_id] = p.public_contact
        setContacts(cm)

        if (uid) {
          const { data: tm } = await supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle()
          const teamId = (tm as { team_id: string } | null)?.team_id ?? null
          setMyTeamId(teamId)

          if (teamId && teamIds.includes(teamId)) {
            // 送信者名の解決用に両チームのメンバー名を取得
            const { data: members } = await supabase
              .from('team_members')
              .select('user_id, team_id, profiles!inner(display_name)')
              .in('team_id', teamIds)
            const mn: Record<string, { name: string; teamId: string }> = {}
            for (const r of ((members ?? []) as unknown as { user_id: string; team_id: string; profiles: { display_name: string | null } }[])) {
              mn[r.user_id] = { name: r.profiles?.display_name ?? '(名前未設定)', teamId: r.team_id }
            }
            setMemberNames(mn)
            await loadMessages()
          }
        }
      } catch (e) {
        console.error('scrim match init error:', e)
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [matchId, loadMessages])

  // チャットのリアルタイム購読 + 10秒ポーリング + 試合状態の購読
  useEffect(() => {
    if (!matchId || !isMember) return
    const ch = supabase.channel(`scrim-match-${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scrim_match_messages', filter: `match_id=eq.${matchId}` }, () => void loadMessages())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scrim_matches', filter: `id=eq.${matchId}` }, () => void loadMatch())
      .subscribe()
    const iv = setInterval(() => void loadMessages(), 10000)
    return () => { void supabase.removeChannel(ch); clearInterval(iv) }
  }, [matchId, isMember, loadMessages, loadMatch])

  // 最新メッセージへ自動スクロール (履歴閲覧中は動かさない)
  useEffect(() => {
    const box = chatBoxRef.current
    if (!box || messages.length === 0) return
    const isFirst = chatPrevCountRef.current === 0
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120
    if (isFirst || nearBottom) box.scrollTop = box.scrollHeight
    chatPrevCountRef.current = messages.length
  }, [messages])

  const send = async (body: string, type: 'text' | 'lobby_code') => {
    if (sending || !body.trim()) return
    setSending(true)
    const { error } = await supabase.rpc('rpc_scrimboard_send_message', { p_match_id: matchId, p_body: body.trim(), p_type: type })
    setSending(false)
    if (error) { setToast(error.message); return }
    if (type === 'text') setInput('')
    else setLobbyCode('')
    void loadMessages()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return // IME変換確定のEnterでは送信しない
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input, 'text')
    }
  }

  const doCancel = async () => {
    if (cancelling) return
    setCancelling(true)
    const { error } = await supabase.rpc('rpc_scrimboard_cancel', { p_match_id: matchId })
    setCancelling(false)
    setCancelOpen(false)
    if (error) { setToast(error.message); return }
    void loadMatch()
  }

  if (loading) {
    return (
      <main>
        <div className="eyebrow">SCRIM MATCH</div>
        <h1 className="display" style={{ marginBottom: 8 }}><em>交流戦</em></h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}><span className="muted">読み込み中...</span></div>
      </main>
    )
  }

  if (!match) {
    return (
      <main>
        <div className="eyebrow">SCRIM MATCH</div>
        <h1 className="display" style={{ marginBottom: 8 }}><em>交流戦</em></h1>
        <div className="card" style={{ padding: 24 }}>
          <p className="danger" style={{ margin: 0 }}>試合が見つかりません</p>
          <button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => router.push('/custom/board')}>ボードに戻る</button>
        </div>
      </main>
    )
  }

  const hostName = teamNames[match.host_team_id] ?? '不明'
  const guestName = teamNames[match.guest_team_id] ?? '不明'
  const oppTeamId = myTeamId === match.host_team_id ? match.guest_team_id : match.host_team_id
  const isCancelled = match.status === 'cancelled'

  return (
    <main>
      <div className="eyebrow">SCRIM MATCH · UNRATED</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.4rem)', marginTop: 6 }}>
        {hostName} <em>vs</em> {guestName}
      </h1>
      <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--amber)' }}>
          {dateLabel(match.date)} {slotLabel(match.slot_start)} – {slotLabel(match.slot_end)}
        </span>
        <span className="badge" style={{ fontSize: 10 }}>{matchLabel(match)}</span>
        {isCancelled
          ? <span className="badge danger"><span className="badge-dot" />キャンセル済み</span>
          : <span className="badge success"><span className="badge-dot" />成立中</span>}
      </div>

      <div className="row mt-s" style={{ gap: 8 }}>
        <button className="btn-ghost btn-sm" onClick={() => router.push('/custom/board')}>← ボードに戻る</button>
        {isMember && !isCancelled && (
          <button className="btn-danger btn-sm" onClick={() => setCancelOpen(true)}>対戦をキャンセル</button>
        )}
      </div>

      {isCancelled && (
        <div className="card" style={{ borderColor: 'rgba(255,77,109,0.35)', background: 'var(--danger-soft)', marginTop: 16, padding: '12px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>この対戦はキャンセルされました。枠はボードに戻っています。</p>
        </div>
      )}

      {/* 公開連絡先 (設定しているチームのみ) */}
      {(contacts[match.host_team_id] || contacts[match.guest_team_id]) && (
        <div className="card" style={{ marginTop: 16, padding: '12px 16px' }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>チームの公開連絡先</div>
          <div className="stack-sm" style={{ fontSize: 13 }}>
            {contacts[match.host_team_id] && <div><span style={{ fontWeight: 700 }}>{hostName}:</span> <span className="muted">{contacts[match.host_team_id]}</span></div>}
            {contacts[match.guest_team_id] && <div><span style={{ fontWeight: 700 }}>{guestName}:</span> <span className="muted">{contacts[match.guest_team_id]}</span></div>}
          </div>
        </div>
      )}

      {/* チャット */}
      <div className="section">
        <div className="card-strong">
          <div className="sec-title">試合チャット</div>

          {!isMember ? (
            <p className="muted" style={{ margin: 0, padding: '16px 0' }}>
              このチャットは両チームのメンバーのみ閲覧できます。
            </p>
          ) : (
            <>
              <div ref={chatBoxRef} style={{ height: 400, overflowY: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'rgba(0,0,0,0.2)', padding: 12 }}>
                <div className="stack-sm">
                  {messages.length === 0 ? (
                    <p className="dim" style={{ fontSize: 13, textAlign: 'center', marginTop: 24 }}>まだメッセージはありません</p>
                  ) : (
                    messages.map(msg => {
                      const isSystem = msg.message_type === 'system'
                      const isCode = msg.message_type === 'lobby_code'
                      const sender = msg.sender_user_id ? memberNames[msg.sender_user_id] : null
                      const senderTeam = sender ? (sender.teamId === match.host_team_id ? hostName : guestName) : null
                      const isMyTeamMsg = sender?.teamId === myTeamId
                      return (
                        <div key={msg.id} className="card" style={{
                          padding: '8px 12px',
                          background: isSystem ? 'rgba(255,255,255,0.03)' : isCode ? 'var(--success-soft)' : isMyTeamMsg ? 'rgba(0,229,255,0.06)' : 'rgba(255,43,214,0.06)',
                          borderColor: isCode ? 'rgba(0,245,160,0.3)' : 'var(--line)',
                        }}>
                          <div className="row" style={{ justifyContent: 'space-between', fontSize: 10.5, opacity: 0.7 }}>
                            <span>
                              {isSystem ? 'システム' : `${sender?.name ?? '不明'} (${senderTeam ?? '—'})`}
                              {isCode && <span style={{ color: 'var(--success)', marginLeft: 6, fontWeight: 700 }}>ロビーコード</span>}
                            </span>
                            <span className="mono">{new Date(msg.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div style={{ marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: isCode ? 16 : 13.5, fontWeight: isCode ? 700 : 400, fontFamily: isCode ? 'var(--font-mono)' : undefined }}>
                            {msg.body}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {!isCancelled && (
                <>
                  <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-start' }}>
                    <textarea
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="メッセージを入力（Enter で送信、Shift+Enter で改行）"
                      rows={2}
                      disabled={sending}
                      style={{ flex: 1 }}
                    />
                    <button className="btn-primary" onClick={() => void send(input, 'text')} disabled={sending || !input.trim()}>
                      送信
                    </button>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <input
                      value={lobbyCode}
                      onChange={e => setLobbyCode(e.target.value)}
                      placeholder="ロビーコード"
                      className="mono"
                      maxLength={20}
                      style={{ width: 180 }}
                    />
                    <button onClick={() => void send(lobbyCode, 'lobby_code')} disabled={sending || !lobbyCode.trim()}
                      style={{ fontSize: 12, fontWeight: 700, padding: '9px 14px' }}>
                      ロビーコードを送信
                    </button>
                    <span className="muted" style={{ fontSize: 11 }}>コードは強調表示で両チームに共有されます</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="対戦をキャンセルしますか？"
        message={`${teamNames[oppTeamId] ?? '相手チーム'} との対戦を取り消します。相手チームの Discord にキャンセル通知が送られ、枠はボードに戻ります。キャンセル回数は相手チームから見えるようになります。`}
        confirmText={cancelling ? 'キャンセル中...' : 'キャンセルする'}
        cancelText="戻る"
        onConfirm={doCancel}
        onCancel={() => { if (!cancelling) setCancelOpen(false) }}
      />

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 32, transform: 'translateX(-50%)', zIndex: 3000, padding: '12px 18px', background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 10, color: 'var(--text)', fontSize: 13 }}>
          {toast}
        </div>
      )}
    </main>
  )
}
