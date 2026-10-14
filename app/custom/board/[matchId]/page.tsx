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
}
type GameStatRow = {
  game_id: string; side: 'host' | 'guest'; raw_name: string
  user_id: string | null; kills: number | null; deaths: number | null
  assists: number | null; damage: number | null
}
type RosterEntry = { user_id: string; name: string }
type PendingPlayer = {
  side: 'host' | 'guest'; name: string; user_id: string | null
  kills: number | null; deaths: number | null; assists: number | null; damage: number | null
  stats: Record<string, unknown>
}
type PendingGame = {
  key: string; image_path: string; game_no: number
  mode: 'hp' | 'snd' | 'ovl'; map: string
  host_score: number | null; guest_score: number | null
  duration_seconds: number | null
  players: PendingPlayer[]
  rosters: { host: RosterEntry[]; guest: RosterEntry[] }
}

const GAME_MODE_LABEL: Record<string, string> = { hp: 'ハードポイント', snd: 'サーチ&デストロイ', ovl: 'オーバーロード' }

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
  const [sideNames, setSideNames] = useState<{ host: string; guest: string }>({ host: '不明', guest: '不明' })
  const [contacts, setContacts] = useState<{ host: string | null; guest: string | null }>({ host: null, guest: null })
  const [memberNames, setMemberNames] = useState<Record<string, { name: string; side: 'host' | 'guest' }>>({})
  const [myRoomSide, setMyRoomSide] = useState(false) // 自分が混成ルーム側のメンバーか
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [lobbyCode, setLobbyCode] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const chatBoxRef = useRef<HTMLDivElement | null>(null)
  const chatPrevCountRef = useRef(0)

  // スコアボード提出
  const [games, setGames] = useState<GameRow[]>([])
  const [gameStats, setGameStats] = useState<Record<string, GameStatRow[]>>({})
  const [pending, setPending] = useState<PendingGame[]>([])
  const [parsing, setParsing] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const loadGames = useCallback(async () => {
    if (!matchId) return
    const { data: g } = await supabase.from('scrim_match_games')
      .select('id, game_no, mode, map, host_score, guest_score, duration_seconds, image_path')
      .eq('match_id', matchId).order('game_no')
    const rows = (g ?? []) as GameRow[]
    setGames(rows)
    if (rows.length > 0) {
      const { data: st } = await supabase.from('scrim_game_player_stats')
        .select('game_id, side, raw_name, user_id, kills, deaths, assists, damage')
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

  // 画像を選択 → アップロード → AI解析 → 確認カードに積む
  const handleScoreboardFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || parsing) return
    setParsing(true)
    try {
      let nextNo = Math.max(0, ...games.map(g => g.game_no), ...pending.map(p => p.game_no)) + 1
      for (const file of Array.from(files).slice(0, 8)) {
        if (file.size > 5 * 1024 * 1024) { setToast('画像が大きすぎます (5MBまで): ' + file.name); continue }
        const ext = file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg') ? 'jpg'
          : file.name.toLowerCase().endsWith('.webp') ? 'webp' : 'png'
        const path = `${matchId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from('scoreboards').upload(path, file, { contentType: file.type || 'image/png' })
        if (upErr) { setToast('アップロードに失敗しました: ' + upErr.message); continue }

        const { data, error } = await supabase.functions.invoke('scoreboard-parse', {
          body: { image_path: path, match_id: matchId },
        })
        if (error) { setToast('AI解析に失敗しました。もう一度試すか、別の画像でお試しください'); continue }
        const r = data as {
          ok: boolean; mode: string | null; map: string | null; duration_seconds: number | null
          team_a_score: number | null; team_b_score: number | null; a_is_host: boolean | null
          players: { team: 'A' | 'B'; name: string; kills: number | null; deaths: number | null; assists: number | null; damage: number | null; stats: Record<string, unknown>; side: 'host' | 'guest' | null; matched_user_id: string | null }[]
          rosters: { host: RosterEntry[]; guest: RosterEntry[] }
        }
        const aIsHost = r.a_is_host !== false // 不明時はA=ホスト扱い (入替ボタンで直せる)
        setPending(prev => [...prev, {
          key: path,
          image_path: path,
          game_no: nextNo,
          mode: (r.mode === 'snd' || r.mode === 'ovl') ? r.mode : 'hp',
          map: r.map ?? '',
          host_score: aIsHost ? r.team_a_score : r.team_b_score,
          guest_score: aIsHost ? r.team_b_score : r.team_a_score,
          duration_seconds: r.duration_seconds,
          players: (r.players ?? []).map(p => ({
            side: p.side ?? (((p.team === 'A') === aIsHost) ? 'host' : 'guest'),
            name: p.name,
            user_id: p.matched_user_id,
            kills: p.kills, deaths: p.deaths, assists: p.assists, damage: p.damage,
            stats: p.stats ?? {},
          })),
          rosters: r.rosters,
        }])
        nextNo += 1
      }
    } finally {
      setParsing(false)
    }
  }

  const swapPendingSides = (key: string) => {
    setPending(prev => prev.map(p => p.key !== key ? p : {
      ...p,
      host_score: p.guest_score, guest_score: p.host_score,
      players: p.players.map(pl => ({ ...pl, side: pl.side === 'host' ? 'guest' : 'host', user_id: null })),
    }))
  }

  const updatePendingPlayer = (key: string, idx: number, patch: Partial<PendingPlayer>) => {
    setPending(prev => prev.map(p => p.key !== key ? p : {
      ...p, players: p.players.map((pl, i) => i === idx ? { ...pl, ...patch } : pl),
    }))
  }

  const savePending = async (p: PendingGame) => {
    setSavingKey(p.key)
    const { error } = await supabase.rpc('rpc_scrim_submit_game', {
      p_match_id: matchId,
      p_game_no: p.game_no,
      p_mode: p.mode,
      p_map: p.map || null,
      p_host_score: p.host_score,
      p_guest_score: p.guest_score,
      p_duration_seconds: p.duration_seconds,
      p_image_path: p.image_path,
      p_players: p.players.map(pl => ({
        side: pl.side, raw_name: pl.name, user_id: pl.user_id,
        kills: pl.kills, deaths: pl.deaths, assists: pl.assists, damage: pl.damage, stats: pl.stats,
      })),
    })
    setSavingKey(null)
    if (error) { setToast(error.message); return }
    setPending(prev => prev.filter(x => x.key !== p.key))
    setToast('スコアボードを保存しました')
    void loadGames()
  }

  const imageUrl = (path: string) =>
    supabase.storage.from('scoreboards').getPublicUrl(path).data.publicUrl

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
          const { data: tm } = await supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle()
          const teamId = (tm as { team_id: string } | null)?.team_id ?? null
          setMyTeamId(teamId)
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
        <button className="btn-ghost btn-sm" onClick={() => router.push('/rules')}>GAルールを確認</button>
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
            {isMember && !isCancelled && (
              <label className="btn-primary btn-sm" style={{ cursor: parsing ? 'wait' : 'pointer' }}>
                {parsing ? 'AI解析中...' : '📷 スコアボードを提出'}
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }}
                  disabled={parsing}
                  onChange={e => { void handleScoreboardFiles(e.target.files); e.target.value = '' }} />
              </label>
            )}
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 12 }}>
            配信・録画のスコアボード画像(観戦視点)をそのまま提出してください。AIが自動で読み取り、確認して保存するだけです(日本語・英語・韓国語の画面に対応)。
          </p>

          {/* 確認カード (解析済み・未保存) */}
          {pending.map(p => (
            <div key={p.key} className="card" style={{ padding: 14, marginBottom: 12, borderColor: 'rgba(255,176,32,0.4)' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className="badge amber">確認して保存</span>
                <span className="muted" style={{ fontSize: 11 }}>GAME</span>
                <input type="number" min={1} max={12} value={p.game_no}
                  onChange={e => setPending(prev => prev.map(x => x.key === p.key ? { ...x, game_no: Number(e.target.value) } : x))}
                  style={{ width: 56 }} />
                <select value={p.mode}
                  onChange={e => setPending(prev => prev.map(x => x.key === p.key ? { ...x, mode: e.target.value as 'hp' | 'snd' | 'ovl' } : x))}
                  style={{ width: 150 }}>
                  <option value="hp">ハードポイント</option>
                  <option value="snd">サーチ&デストロイ</option>
                  <option value="ovl">オーバーロード</option>
                </select>
                <input value={p.map} placeholder="マップ"
                  onChange={e => setPending(prev => prev.map(x => x.key === p.key ? { ...x, map: e.target.value } : x))}
                  style={{ width: 140 }} />
                <span className="mono" style={{ fontSize: 13 }}>
                  {hostName} <input type="number" value={p.host_score ?? ''} style={{ width: 70 }}
                    onChange={e => setPending(prev => prev.map(x => x.key === p.key ? { ...x, host_score: e.target.value ? Number(e.target.value) : null } : x))} />
                  {' - '}
                  <input type="number" value={p.guest_score ?? ''} style={{ width: 70 }}
                    onChange={e => setPending(prev => prev.map(x => x.key === p.key ? { ...x, guest_score: e.target.value ? Number(e.target.value) : null } : x))} /> {guestName}
                </span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => swapPendingSides(p.key)}>⇄ サイド入替</button>
              </div>

              {(['host', 'guest'] as const).map(side => (
                <div key={side} style={{ marginBottom: 8 }}>
                  <div className="stat-label" style={{ marginBottom: 4 }}>{side === 'host' ? hostName : guestName}</div>
                  {p.players.map((pl, idx) => pl.side !== side ? null : (
                    <div key={idx} className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4, fontSize: 12 }}>
                      <span className="mono" style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</span>
                      <select value={pl.user_id ?? ''} onChange={e => updatePendingPlayer(p.key, idx, { user_id: e.target.value || null })} style={{ width: 160, fontSize: 12 }}>
                        <option value="">紐付けなし（助っ人等）</option>
                        {p.rosters[side].map(r => <option key={r.user_id} value={r.user_id}>{r.name}</option>)}
                      </select>
                      <input type="number" value={pl.kills ?? ''} placeholder="K" title="キル" style={{ width: 56 }}
                        onChange={e => updatePendingPlayer(p.key, idx, { kills: e.target.value ? Number(e.target.value) : null })} />
                      <input type="number" value={pl.deaths ?? ''} placeholder="D" title="デス" style={{ width: 56 }}
                        onChange={e => updatePendingPlayer(p.key, idx, { deaths: e.target.value ? Number(e.target.value) : null })} />
                      <input type="number" value={pl.assists ?? ''} placeholder="A" title="アシスト" style={{ width: 56 }}
                        onChange={e => updatePendingPlayer(p.key, idx, { assists: e.target.value ? Number(e.target.value) : null })} />
                      <input type="number" value={pl.damage ?? ''} placeholder="DMG" title="ダメージ" style={{ width: 76 }}
                        onChange={e => updatePendingPlayer(p.key, idx, { damage: e.target.value ? Number(e.target.value) : null })} />
                    </div>
                  ))}
                </div>
              ))}

              <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <a href={imageUrl(p.image_path)} target="_blank" rel="noopener noreferrer" className="muted" style={{ fontSize: 11.5, textDecoration: 'underline' }}>元画像を確認</a>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setPending(prev => prev.filter(x => x.key !== p.key))}>破棄</button>
                  <button type="button" className="btn-primary btn-sm" disabled={savingKey === p.key} onClick={() => void savePending(p)}>
                    {savingKey === p.key ? '保存中...' : 'この内容で保存'}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* 保存済みゲーム */}
          {games.length === 0 && pending.length === 0 ? (
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
                  </div>
                  <div className="grid-2" style={{ gap: 10 }}>
                    {(['host', 'guest'] as const).map(side => (
                      <div key={side}>
                        <div className="stat-label" style={{ marginBottom: 4 }}>{side === 'host' ? hostName : guestName}</div>
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

      <ConfirmDialog
        open={cancelOpen}
        title="対戦をキャンセルしますか？"
        message={`${oppName} との対戦を取り消します。相手の参加メンバーにキャンセル通知が送られ、枠はボードに戻ります。キャンセル回数は相手から見えるようになります。`}
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
