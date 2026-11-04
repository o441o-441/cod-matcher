'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ConfirmDialog from '@/components/ConfirmDialog'
import { SCRIM_CANCEL_REASONS } from '@/lib/scrimCancelReasons'
import MatchPlayerCompare from '@/components/MatchPlayerCompare'
import HpVideoAnalyzer from '@/components/HpVideoAnalyzer'
import HpTimelinePanel from '@/components/HpTimelinePanel'

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
  host_team_id: string | null
  guest_team_id: string | null
  host_room_id: string | null
  guest_room_id: string | null
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

// ---- スコアボード提出 ----
type GameRow = {
  id: string; game_no: number; mode: string; map: string | null
  host_score: number | null; guest_score: number | null
  duration_seconds: number | null; image_path: string
  host_slot: 'team1' | 'team2' | null
}
type GameStatRow = {
  game_id: string; side: 'host' | 'guest'; raw_name: string
  user_id: string | null; kills: number | null; deaths: number | null
  assists: number | null; damage: number | null
  stats: Record<string, unknown> | null
}
const SLOT_LABEL: Record<string, string> = { team1: 'チーム1', team2: 'チーム2' }
const otherSlot = (s: 'team1' | 'team2' | null): 'team1' | 'team2' | null =>
  s === 'team1' ? 'team2' : s === 'team2' ? 'team1' : null

const GAME_MODE_LABEL: Record<string, string> = { hp: 'ハードポイント', snd: 'サーチ&デストロイ', ovl: 'ハイジャック' }

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// スロットは 5:00 基準の48枠 (24h対応。24時以降は 25:00 等の表記)
const slotLabel = (i: number) => `${5 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`

function matchLabel(m: { hp_maps: number; snd_maps: number; ovl_maps: number }) {
  if (m.hp_maps === 6 && m.snd_maps === 0 && m.ovl_maps === 0) return 'ハーポ回し'
  const parts: string[] = []
  if (m.hp_maps > 0) parts.push(`ハーポ${m.hp_maps}`)
  if (m.snd_maps > 0) parts.push(`サーチ${m.snd_maps}`)
  if (m.ovl_maps > 0) parts.push(`ハイジャック${m.ovl_maps}`)
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
  const [sideNames, setSideNames] = useState<{ host: string; guest: string }>({ host: '不明', guest: '不明' })
  const [contacts, setContacts] = useState<{ host: string | null; guest: string | null }>({ host: null, guest: null })
  const [memberNames, setMemberNames] = useState<Record<string, { name: string; side: 'host' | 'guest' }>>({})
  const [myRoomSide, setMyRoomSide] = useState(false) // 自分が混成ルーム側のメンバーか
  const [isAdmin, setIsAdmin] = useState(false)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [lobbyCode, setLobbyCode] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const chatBoxRef = useRef<HTMLDivElement | null>(null)
  const chatPrevCountRef = useRef(0)

  // 試合結果 (LK動画解析で提出)
  const [games, setGames] = useState<GameRow[]>([])
  const [gameStats, setGameStats] = useState<Record<string, GameStatRow[]>>({})
  const [deleteGameTarget, setDeleteGameTarget] = useState<GameRow | null>(null)
  const [deletingGame, setDeletingGame] = useState(false)

  // LK動画解析 (ヒル保持推移)
  const [videoOpen, setVideoOpen] = useState(false)
  const [tlRefresh, setTlRefresh] = useState(0)

  const loadGames = useCallback(async () => {
    if (!matchId) return
    const { data: g } = await supabase.from('scrim_match_games')
      .select('id, game_no, mode, map, host_score, guest_score, duration_seconds, image_path, host_slot')
      .eq('match_id', matchId).order('game_no')
    const rows = (g ?? []) as GameRow[]
    setGames(rows)
    if (rows.length > 0) {
      const { data: st } = await supabase.from('scrim_game_player_stats')
        .select('game_id, side, raw_name, user_id, kills, deaths, assists, damage, stats')
        .in('game_id', rows.map(r => r.id))
      const map: Record<string, GameStatRow[]> = {}
      for (const s of (st ?? []) as GameStatRow[]) {
        if (!map[s.game_id]) map[s.game_id] = []
        map[s.game_id].push(s)
      }
      setGameStats(map)
    } else {
      setGameStats({})
    }
  }, [matchId])

  useEffect(() => { void loadGames() }, [loadGames])

  const handleDeleteGame = async () => {
    if (!deleteGameTarget) return
    setDeletingGame(true)
    const { error } = await supabase.rpc('rpc_scrim_delete_game', { p_game_id: deleteGameTarget.id })
    setDeletingGame(false)
    setDeleteGameTarget(null)
    if (error) { setToast(error.message); return }
    setToast('スコアボードを取り消しました')
    void loadGames()
  }

  const imageUrl = (path: string) =>
    supabase.storage.from('scoreboards').getPublicUrl(path).data.publicUrl

  // 管理者はLK解析・スタッツ登録を代行できる (RPC側にもバイパスあり)
  const canEditData = (!!match && (
    (!!myTeamId && (match.host_team_id === myTeamId || match.guest_team_id === myTeamId)) || myRoomSide
  )) || isAdmin
  const isMember = !!match && (
    (!!myTeamId && (match.host_team_id === myTeamId || match.guest_team_id === myTeamId)) || myRoomSide
  )

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

        const teamIds = [m.host_team_id, m.guest_team_id].filter((v): v is string => !!v)
        const roomIds = [m.host_room_id, m.guest_room_id].filter((v): v is string => !!v)
        const [{ data: teamRows }, { data: prefRows }, { data: roomRows }, { data: roomMemberRows }] = await Promise.all([
          teamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', teamIds) : Promise.resolve({ data: [] }),
          teamIds.length > 0 ? supabase.from('scrim_team_prefs').select('team_id, public_contact').in('team_id', teamIds) : Promise.resolve({ data: [] }),
          roomIds.length > 0 ? supabase.from('scrim_mixed_rooms').select('id, name').in('id', roomIds) : Promise.resolve({ data: [] }),
          roomIds.length > 0 ? supabase.from('scrim_mixed_room_members').select('room_id, user_id, profiles!inner(display_name)').in('room_id', roomIds) : Promise.resolve({ data: [] }),
        ])
        const tn: Record<string, string> = {}
        for (const t of (teamRows ?? []) as { id: string; name: string }[]) tn[t.id] = t.name
        const rn: Record<string, string> = {}
        for (const r of (roomRows ?? []) as { id: string; name: string }[]) rn[r.id] = r.name
        const nameOf = (teamId: string | null, roomId: string | null) =>
          teamId ? (tn[teamId] ?? '不明') : `${rn[roomId ?? ''] ?? '不明'}【混成】`
        setSideNames({
          host: nameOf(m.host_team_id, m.host_room_id),
          guest: nameOf(m.guest_team_id, m.guest_room_id),
        })
        const cm: Record<string, string | null> = {}
        for (const p of (prefRows ?? []) as { team_id: string; public_contact: string | null }[]) cm[p.team_id] = p.public_contact
        setContacts({
          host: m.host_team_id ? (cm[m.host_team_id] ?? null) : null,
          guest: m.guest_team_id ? (cm[m.guest_team_id] ?? null) : null,
        })

        const roomMembersList = ((roomMemberRows ?? []) as unknown as { room_id: string; user_id: string; profiles: { display_name: string | null } }[])

        if (uid) {
          const [{ data: tm }, { data: me }] = await Promise.all([
            supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle(),
            supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle<{ is_admin: boolean | null }>(),
          ])
          const teamId = (tm as { team_id: string } | null)?.team_id ?? null
          setMyTeamId(teamId)
          setIsAdmin(!!me?.is_admin)
          const inRoomSide = roomMembersList.some(r => r.user_id === uid)
          setMyRoomSide(inRoomSide)

          const isTeamSide = !!teamId && teamIds.includes(teamId)
          if (isTeamSide || inRoomSide) {
            // 送信者名の解決用に両サイドのメンバー名を取得
            const mn: Record<string, { name: string; side: 'host' | 'guest' }> = {}
            if (teamIds.length > 0) {
              const { data: members } = await supabase
                .from('team_members')
                .select('user_id, team_id, profiles!inner(display_name)')
                .in('team_id', teamIds)
              for (const r of ((members ?? []) as unknown as { user_id: string; team_id: string; profiles: { display_name: string | null } }[])) {
                mn[r.user_id] = { name: r.profiles?.display_name ?? '(名前未設定)', side: r.team_id === m.host_team_id ? 'host' : 'guest' }
              }
            }
            for (const r of roomMembersList) {
              mn[r.user_id] = { name: r.profiles?.display_name ?? '(名前未設定)', side: r.room_id === m.host_room_id ? 'host' : 'guest' }
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
    if (!cancelReason) { setToast('キャンセル理由を選択してください'); return }
    setCancelling(true)
    const { error } = await supabase.rpc('rpc_scrimboard_cancel', {
      p_match_id: matchId,
      p_reason: cancelReason,
      p_note: cancelNote.trim() || null,
    })
    setCancelling(false)
    setCancelOpen(false)
    if (error) { setToast(error.message); return }
    if (cancelReason === 'conduct') {
      router.push('/reports/new')
      return
    }
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

  const hostName = sideNames.host
  const guestName = sideNames.guest
  const mySide: 'host' | 'guest' | null =
    myUserId && memberNames[myUserId]
      ? memberNames[myUserId].side
      : myTeamId && match.host_team_id === myTeamId
        ? 'host'
        : myTeamId && match.guest_team_id === myTeamId
          ? 'guest'
          : null
  const oppName = mySide === 'host' ? guestName : hostName
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
        <button className="btn-ghost btn-sm" onClick={() => router.push('/rules')}>ルールを確認</button>
        {isMember && !isCancelled && (
          <button className="btn-danger btn-sm" onClick={() => { setCancelOpen(true); setCancelReason(''); setCancelNote('') }}>対戦をキャンセル</button>
        )}
      </div>

      {isCancelled && (
        <div className="card" style={{ borderColor: 'rgba(255,77,109,0.35)', background: 'var(--danger-soft)', marginTop: 16, padding: '12px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>この対戦はキャンセルされました。枠はボードに戻っています。</p>
        </div>
      )}

      {/* 公開連絡先 (設定しているチームのみ) */}
      {(contacts.host || contacts.guest) && (
        <div className="card" style={{ marginTop: 16, padding: '12px 16px' }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>チームの公開連絡先</div>
          <div className="stack-sm" style={{ fontSize: 13 }}>
            {contacts.host && <div><span style={{ fontWeight: 700 }}>{hostName}:</span> <span className="muted">{contacts.host}</span></div>}
            {contacts.guest && <div><span style={{ fontWeight: 700 }}>{guestName}:</span> <span className="muted">{contacts.guest}</span></div>}
          </div>
        </div>
      )}

      {/* 試合結果 (スコアボード提出) */}
      <div className="section">
        <div className="card-strong">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="sec-title" style={{ margin: 0 }}>試合結果・スコアボード</div>
            {canEditData && !isCancelled && (
              <button type="button" className="btn-primary btn-sm" onClick={() => setVideoOpen(v => !v)}>
                🎬 LK動画から解析
              </button>
            )}
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 12 }}>
            LK動画(観戦/配信視点の録画)を読み込んで、各ゲームのスコアボード画面を登録すると、AIがスタッツを読み取って保存します。ハードポイントは地点保持の推移も記録されます。間違っていた場合は「取り消す」で削除して再解析できます。
          </p>

          {videoOpen && canEditData && !isCancelled && (
            <HpVideoAnalyzer
              matchId={matchId}
              games={games}
              hostName={hostName}
              guestName={guestName}
              onSaved={() => { void loadGames(); setTlRefresh(x => x + 1) }}
              onClose={() => setVideoOpen(false)}
            />
          )}

          {/* 保存済みゲーム */}
          {games.length === 0 ? (
            <p className="dim" style={{ fontSize: 12, margin: 0 }}>まだ結果が提出されていません</p>
          ) : (
            games.map(g => {
              const st = gameStats[g.id] ?? []
              return (
                <div key={g.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span className="badge" style={{ fontSize: 9 }}>GAME {g.game_no}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{GAME_MODE_LABEL[g.mode] ?? g.mode}{g.map ? ` · ${g.map}` : ''}</span>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 800 }}>
                      {hostName} <span style={{ color: (g.host_score ?? 0) > (g.guest_score ?? 0) ? 'var(--success)' : 'var(--text)' }}>{g.host_score ?? '-'}</span>
                      {' - '}
                      <span style={{ color: (g.guest_score ?? 0) > (g.host_score ?? 0) ? 'var(--success)' : 'var(--text)' }}>{g.guest_score ?? '-'}</span> {guestName}
                    </span>
                    <a href={imageUrl(g.image_path)} target="_blank" rel="noopener noreferrer" className="muted" style={{ fontSize: 11.5, textDecoration: 'underline', marginLeft: 'auto' }}>📷 画像</a>
                    {canEditData && !isCancelled && (
                      <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 11 }}
                        onClick={() => setDeleteGameTarget(g)}>取り消す</button>
                    )}
                  </div>
                  <div className="grid-2" style={{ gap: 10 }}>
                    {(['host', 'guest'] as const).map(side => (
                      <div key={side}>
                        <div className="stat-label" style={{ marginBottom: 4 }}>
                          {side === 'host' ? hostName : guestName}
                          {g.host_slot && <span className="dim"> ({SLOT_LABEL[side === 'host' ? g.host_slot : otherSlot(g.host_slot)!]})</span>}
                        </div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead><tr className="muted" style={{ fontSize: 10, textAlign: 'right' }}>
                            <th style={{ textAlign: 'left', fontWeight: 600 }}>プレイヤー</th><th>K</th><th>D</th><th>A</th><th>DMG</th>
                          </tr></thead>
                          <tbody>
                            {st.filter(s => s.side === side).map((s, i) => (
                              <tr key={i} style={{ textAlign: 'right' }}>
                                <td style={{ textAlign: 'left', padding: '2px 0' }}>{s.raw_name}{s.user_id ? '' : <span className="dim" title="ASCENT未紐付け"> *</span>}</td>
                                <td className="mono">{s.kills ?? '-'}</td>
                                <td className="mono">{s.deaths ?? '-'}</td>
                                <td className="mono">{s.assists ?? '-'}</td>
                                <td className="mono">{s.damage ?? '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}

          {/* ハードポイント地点保持の推移 (LK動画解析。データが無ければ非表示) */}
          {games.length > 0 && (
            <HpTimelinePanel
              games={games}
              hostName={hostName}
              guestName={guestName}
              mySide={mySide}
              canEdit={canEditData && !isCancelled}
              refresh={tlRefresh}
              onChanged={() => setTlRefresh(x => x + 1)}
            />
          )}

          {/* プレイヤー比較 (この交流戦の累計) */}
          {games.length > 0 && (
            <MatchPlayerCompare
              games={games}
              stats={Object.values(gameStats).flat()}
              hostName={hostName}
              guestName={guestName}
            />
          )}
        </div>
      </div>

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
                      const senderTeam = sender ? sideNames[sender.side] : null
                      const isMyTeamMsg = !!sender && !!mySide && sender.side === mySide
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

      {cancelOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="キャンセル確認">
          <div onClick={() => { if (!cancelling) setCancelOpen(false) }} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', padding: 22 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>対戦をキャンセルしますか？</div>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.7 }}>
              {oppName} との対戦を取り消します。相手の参加メンバーにキャンセル通知が送られ、枠はボードに戻ります。
            </p>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>キャンセル回数は相手から見えるようになります。</p>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>キャンセル理由 (必須)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {SCRIM_CANCEL_REASONS.map(r => (
                  <label key={r.value} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
                    <input type="radio" name="match-cancel-reason" checked={cancelReason === r.value} onChange={() => setCancelReason(r.value)} />
                    {r.label}
                  </label>
                ))}
              </div>
              {cancelReason === 'other' && (
                <input
                  value={cancelNote}
                  onChange={e => setCancelNote(e.target.value)}
                  placeholder="理由 (任意・相手への通知に記載されます)"
                  maxLength={200}
                  style={{ marginTop: 8 }}
                />
              )}
              {cancelReason === 'conduct' && (
                <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--amber)', lineHeight: 1.6 }}>
                  この理由は相手への通知には記載されず、運営への記録として保存されます。キャンセル後に通報ページへ移動するので、問題行動の内容を報告してください。
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="btn-ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>戻る</button>
              <button type="button" className="btn-danger" onClick={() => void doCancel()} disabled={cancelling || !cancelReason}>{cancelling ? 'キャンセル中...' : 'キャンセルする'}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteGameTarget}
        title="スコアボードを取り消しますか？"
        message={deleteGameTarget ? `GAME ${deleteGameTarget.game_no}${deleteGameTarget.map ? ` (${deleteGameTarget.map})` : ''} の結果とスタッツを削除します。削除後にLK動画から再解析できます。` : ''}
        confirmText={deletingGame ? '取り消し中...' : '取り消す'}
        cancelText="戻る"
        onConfirm={handleDeleteGame}
        onCancel={() => { if (!deletingGame) setDeleteGameTarget(null) }}
      />

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 32, transform: 'translateX(-50%)', zIndex: 3000, padding: '12px 18px', background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 10, color: 'var(--text)', fontSize: 13 }}>
          {toast}
        </div>
      )}
    </main>
  )
}
