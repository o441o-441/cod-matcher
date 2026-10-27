'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ============================================================
// 交流戦ボード (Scrim Board) — チームの空き時間を出し合い、
// 相手チームの空き枠を選んでその場で対戦を確定するボード。
// STEP1 で1週間分の自分の空きを入力し、STEP2 で日付を
// 切り替えて相手チームの空き枠を見る。
// データは member_availability / scrim_slot_counts /
// scrim_matches / scrim_team_prefs (Supabase) に接続済み。
// ============================================================

type Mode = 'hp' | 'snd' | 'ovl' | 'custom' | 'all'

type TeamRow = { id: string; name: string; rating: number | null }
type PrefsRow = { hp: boolean; snd: boolean; ovl: boolean; range: 'any' | 'similar'; contact: string | null }
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

type RoomRow = {
  id: string
  name: string
  host_user_id: string
  date: string
  slot_start: number
  slot_end: number
  note: string | null
  status: string
  last_notified_at: string | null
}

type RoomMember = { uid: string; name: string; rating: number | null }

const DAYS = 7
const SLOTS = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '24:00', '24:30']
const slotLabel = (i: number) => `${20 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`

// レート → ティア (既存ランキングと同じ閾値)
function getTier(r: number | null): { label: string; idx: number; color: string } {
  if (r == null) return { label: '未計測', idx: 0, color: '#7b84a6' }
  if (r >= 2200) return { label: 'ASCENDANT', idx: 8, color: '#ff2bd6' }
  if (r >= 2000) return { label: 'RAINBOW', idx: 7, color: '#ff2244' }
  if (r >= 1800) return { label: 'CRIMSON', idx: 6, color: '#ff2244' }
  if (r >= 1600) return { label: 'DIAMOND', idx: 5, color: '#b5a8ff' }
  if (r >= 1400) return { label: 'PLATINUM', idx: 4, color: '#7ae1ff' }
  if (r >= 1200) return { label: 'GOLD', idx: 3, color: '#ffd166' }
  if (r >= 1000) return { label: 'SILVER', idx: 2, color: '#c0c7d8' }
  return { label: 'BRONZE', idx: 1, color: '#b87333' }
}

const DOW = ['日', '月', '火', '水', '木', '金', '土']

// マップ数 → 30分枠数への換算。分/マップは scrim_formats テーブルから取得
// ※ サーバー側 (rpc_scrimboard_confirm) にも同じ計算があり、そちらが正
const mapsToSlots = (minutesPerMap: number, maps: number) => Math.ceil((minutesPerMap * maps) / 30)
type FormatMinutes = { hp: number; snd: number; ovl: number }
const DEFAULT_MINUTES: FormatMinutes = { hp: 15, snd: 20, ovl: 15 }
const HP_MAP_OPTIONS = [1, 2, 3, 4, 5, 6]
const SND_MAP_OPTIONS = [1, 2, 3, 4, 5, 6]
const OVL_MAP_OPTIONS = [1, 2, 3, 4]

// 成立レコードの構成ラベル (サーバーの _scrimboard_format_label と同義)
function matchLabel(m: { hp_maps: number; snd_maps: number; ovl_maps: number }) {
  if (m.hp_maps === 6 && m.snd_maps === 0 && m.ovl_maps === 0) return 'ハーポ回し'
  const parts: string[] = []
  if (m.hp_maps > 0) parts.push(`ハーポ${m.hp_maps}`)
  if (m.snd_maps > 0) parts.push(`サーチ${m.snd_maps}`)
  if (m.ovl_maps > 0) parts.push(`オバロ${m.ovl_maps}`)
  return parts.join(' + ')
}

const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekDateStrs = () => {
  const now = new Date()
  return Array.from({ length: DAYS }, (_, i) => fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)))
}

const LINE = 'rgba(140,160,220,0.12)'
const LINE_STRONG = 'rgba(140,160,220,0.28)'

// Discord Webhook URL の形式チェック (SSRF対策: discord.com のみ許可)
const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/
const isValidWebhook = (u: string) => WEBHOOK_RE.test(u.trim())
const WH_LOCAL_KEY = 'scrim-board-webhook'

// AppShell の .page-transition (animation fill: both) が transform を持ち続けるため、
// ページ内の position:fixed はビューポート基準にならない。
// ダイアログ・トーストは body 直下へポータルで逃がす。
function BodyPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}

export default function ScrimBoardPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [teamInfo, setTeamInfo] = useState<{ id: string; name: string; isOwner: boolean } | null>(null)
  const [roster, setRoster] = useState<{ uid: string; name: string }[]>([]) // 自分以外のメンバー
  const [targetUid, setTargetUid] = useState<string | null>(null) // 代理入力の対象 (null = 自分)

  // ボードデータ
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [counts, setCounts] = useState<Record<string, number[]>>({}) // key: `${teamId}|${date}`
  const [ratings, setRatings] = useState<Record<string, { avg: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>>({})
  const [formats, setFormats] = useState<FormatMinutes>(DEFAULT_MINUTES)
  const [prefsMap, setPrefsMap] = useState<Record<string, PrefsRow>>({})
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamStats, setTeamStats] = useState<Record<string, { games: number; cancels: number }>>({})
  const [myMine, setMyMine] = useState<Record<string, number[]>>({}) // date -> 自分の選択スロット

  // 混成ルーム
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [roomMembers, setRoomMembers] = useState<Record<string, RoomMember[]>>({})
  const [roomCreateOpen, setRoomCreateOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomDay, setRoomDay] = useState(0)
  const [roomStart, setRoomStart] = useState(0)
  const [roomEnd, setRoomEnd] = useState(10)
  const [roomNote, setRoomNote] = useState('')
  const [roomBusy, setRoomBusy] = useState(false)
  const [roomNotifyOn, setRoomNotifyOn] = useState(true) // 混成ルーム募集通知の受信設定 (行なし=ON)

  // UI 状態
  const [editDay, setEditDay] = useState(0)
  const [viewDay, setViewDay] = useState(0)
  const [mode, setMode] = useState<Mode>('hp')
  const [sndMaps, setSndMaps] = useState(3)
  const [ovlMaps, setOvlMaps] = useState(3)
  const [combo, setCombo] = useState<{ hp: number; snd: number; ovl: number }>({ hp: 0, snd: 2, ovl: 2 })
  const [near, setNear] = useState(false)
  const [hoverRun, setHoverRun] = useState<string | null>(null)
  const [modal, setModal] = useState<{ side: 'team' | 'room'; targetId: string; day: number; start: number; len: number } | null>(null)
  const [modalAs, setModalAs] = useState<'team' | 'room'>('team') // 自分の立場 (両方持つ場合の選択)
  const [confirming, setConfirming] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [tplSaved, setTplSaved] = useState<number[][] | null>(null) // 保存済みテンプレ (dow(0=日)→スロット。null=未設定)
  const [tplEdit, setTplEdit] = useState<number[][]>(() => Array.from({ length: 7 }, () => [])) // 編集中のテンプレ
  const [tplApplied, setTplApplied] = useState<Set<string>>(new Set()) // 自動反映済みの日付 (scrim_template_applied)
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [whTested, setWhTested] = useState(false)
  const [whBusy, setWhBusy] = useState(false)
  const [whError, setWhError] = useState<string | null>(null)
  const [contactInput, setContactInput] = useState('')
  const [toast, setToast] = useState<{ title: string; sub: string } | null>(null)

  // 現在時刻・週の日付 (SSR とのハイドレーション不一致を避けるためマウント後に設定)
  const [nowMins, setNowMins] = useState<number | null>(null)
  const [dateLabel, setDateLabel] = useState('')
  const [weekDays, setWeekDays] = useState<{ label: string; dow: number; dateStr: string }[]>([])
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowMins(d.getHours() * 60 + d.getMinutes())
      setDateLabel(`${d.getMonth() + 1}月${d.getDate()}日 (${DOW[d.getDay()]})`)
      setWeekDays(Array.from({ length: DAYS }, (_, i) => {
        const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)
        return { label: `${dd.getMonth() + 1}/${dd.getDate()} (${DOW[dd.getDay()]})`, dow: dd.getDay(), dateStr: fmtDate(dd) }
      }))
    }
    tick()
    const iv = setInterval(tick, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(t)
  }, [toast])
  const showToast = (title: string, sub: string) => setToast({ title, sub })

  // ---- 過去の交流戦 (自チームの対戦履歴。今週より前の最新10件) ----
  const [pastMatches, setPastMatches] = useState<MatchRow[]>([])
  const [pastTeamNames, setPastTeamNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!teamInfo) { setPastMatches([]); return }
    let cancelled = false
    void (async () => {
      const today = weekDateStrs()[0]
      const { data } = await supabase
        .from('scrim_matches')
        .select('*')
        .or(`host_team_id.eq.${teamInfo.id},guest_team_id.eq.${teamInfo.id}`)
        .in('status', ['confirmed', 'completed'])
        .lt('date', today)
        .order('date', { ascending: false })
        .order('slot_start', { ascending: false })
        .limit(10)
      if (cancelled) return
      const rows = (data ?? []) as MatchRow[]
      setPastMatches(rows)
      const ids = new Set<string>()
      rows.forEach(m => { if (m.host_team_id) ids.add(m.host_team_id); if (m.guest_team_id) ids.add(m.guest_team_id) })
      if (ids.size > 0) {
        const { data: trs } = await supabase.from('teams').select('id, name').in('id', [...ids])
        if (cancelled) return
        const nm: Record<string, string> = {}
        for (const t of (trs ?? []) as { id: string; name: string }[]) nm[t.id] = t.name
        setPastTeamNames(nm)
      }
    })()
    return () => { cancelled = true }
  }, [teamInfo])

  const dayLabel = (d: number) => (weekDays[d] ? (d === 0 ? `今日 ${weekDays[d].label}` : weekDays[d].label) : d === 0 ? '今日' : `${d}日後`)
  const dateToDay = (dateStr: string) => weekDateStrs().indexOf(dateStr)

  // ---- データ読み込み ----
  const loadBoard = useCallback(async () => {
    const dates = weekDateStrs()
    const [{ data: countRows, error: cErr }, { data: prefRows }, { data: matchRows }, { data: allMatches }, { data: roomRows }] = await Promise.all([
      supabase.from('scrim_slot_counts').select('team_id, date, slot_index, available, avg_rating, min_rating, max_rating').in('date', dates),
      supabase.from('scrim_team_prefs').select('team_id, accept_hp, accept_snd, accept_ovl, accept_range, public_contact'),
      supabase.from('scrim_matches').select('*').in('date', dates).eq('status', 'confirmed'),
      supabase.from('scrim_matches').select('host_team_id, guest_team_id, status'),
      supabase.from('scrim_mixed_rooms').select('*').in('date', dates),
    ])
    if (cErr) { console.error('scrim_slot_counts error:', cErr); return }

    // 混成ルーム + メンバー (名前・レートはボード表示とティア算出に使用)
    const roomList = (roomRows ?? []) as RoomRow[]
    setRooms(roomList)
    if (roomList.length > 0) {
      const { data: rmRows } = await supabase
        .from('scrim_mixed_room_members')
        .select('room_id, user_id, profiles!inner(display_name, current_rating)')
        .in('room_id', roomList.map(r => r.id))
      const rmMap: Record<string, RoomMember[]> = {}
      for (const r of ((rmRows ?? []) as unknown as { room_id: string; user_id: string; profiles: { display_name: string | null; current_rating: number | null } }[])) {
        if (!rmMap[r.room_id]) rmMap[r.room_id] = []
        rmMap[r.room_id].push({ uid: r.user_id, name: r.profiles?.display_name ?? '(名前未設定)', rating: r.profiles?.current_rating ?? null })
      }
      setRoomMembers(rmMap)
    } else {
      setRoomMembers({})
    }

    const cm: Record<string, number[]> = {}
    const rm: Record<string, { avg: (number | null)[]; min: (number | null)[]; max: (number | null)[] }> = {}
    for (const r of (countRows ?? []) as { team_id: string; date: string; slot_index: number; available: number; avg_rating: number | null; min_rating: number | null; max_rating: number | null }[]) {
      const key = `${r.team_id}|${r.date}`
      if (!cm[key]) cm[key] = Array(10).fill(0)
      cm[key][r.slot_index] = r.available
      if (!rm[key]) rm[key] = { avg: Array(10).fill(null), min: Array(10).fill(null), max: Array(10).fill(null) }
      rm[key].avg[r.slot_index] = r.avg_rating
      rm[key].min[r.slot_index] = r.min_rating
      rm[key].max[r.slot_index] = r.max_rating
    }
    setCounts(cm)
    setRatings(rm)

    const pm: Record<string, PrefsRow> = {}
    for (const r of (prefRows ?? []) as { team_id: string; accept_hp: boolean; accept_snd: boolean; accept_ovl: boolean; accept_range: 'any' | 'similar'; public_contact: string | null }[]) {
      pm[r.team_id] = { hp: r.accept_hp, snd: r.accept_snd, ovl: r.accept_ovl, range: r.accept_range, contact: r.public_contact }
    }
    setPrefsMap(pm)

    const mrows = (matchRows ?? []) as MatchRow[]
    setMatches(mrows)

    const stats: Record<string, { games: number; cancels: number }> = {}
    for (const m of (allMatches ?? []) as { host_team_id: string | null; guest_team_id: string | null; status: string }[]) {
      for (const tid of [m.host_team_id, m.guest_team_id]) {
        if (!tid) continue // 混成ルーム側は実績集計の対象外
        if (!stats[tid]) stats[tid] = { games: 0, cancels: 0 }
        if (m.status === 'confirmed' || m.status === 'completed') stats[tid].games++
        if (m.status === 'cancelled') stats[tid].cancels++
      }
    }
    setTeamStats(stats)

    // 表示対象チーム: 週内に空きがある or 成立に関与 or 自チーム
    const ids = new Set<string>()
    Object.keys(cm).forEach(k => ids.add(k.split('|')[0]))
    mrows.forEach(m => { if (m.host_team_id) ids.add(m.host_team_id); if (m.guest_team_id) ids.add(m.guest_team_id) })
    setTeamInfo(prev => { if (prev) ids.add(prev.id); return prev })
    if (ids.size > 0) {
      const { data: teamRows } = await supabase
        .from('teams')
        .select('id, name, rating')
        .in('id', [...ids])
        .eq('is_disbanded', false)
      setTeams((teamRows ?? []) as TeamRow[])
    } else {
      setTeams([])
    }
  }, [])

  const loadMine = useCallback(async (uid: string) => {
    const dates = weekDateStrs()
    const { data } = await supabase
      .from('member_availability')
      .select('date, slot_index')
      .eq('user_id', uid)
      .in('date', dates)
    const mm: Record<string, number[]> = {}
    for (const r of (data ?? []) as { date: string; slot_index: number }[]) {
      if (!mm[r.date]) mm[r.date] = []
      mm[r.date].push(r.slot_index)
    }
    setMyMine(mm)
  }, [])

  // 代理入力: 対象メンバー切替時にその人の空きを読み直す
  useEffect(() => {
    const uid = targetUid ?? myUserId
    if (!uid) return
    void loadMine(uid)
  }, [targetUid, myUserId, loadMine])

  // 自分のテンプレ + 今週分の自動反映済みマーカーを読み込む
  const loadTemplate = useCallback(async (uid: string) => {
    const [{ data }, { data: apRows }] = await Promise.all([
      supabase.from('scrim_templates').select('day_slots').eq('user_id', uid).maybeSingle(),
      supabase.from('scrim_template_applied').select('date').eq('user_id', uid).in('date', weekDateStrs()),
    ])
    const ds = (data as { day_slots: Record<string, number[]> } | null)?.day_slots ?? null
    if (ds) {
      const arr = Array.from({ length: 7 }, (_, i) => [...(ds[String(i)] ?? [])].sort((a, b) => a - b))
      setTplSaved(arr.some(a => a.length > 0) ? arr : null)
      setTplEdit(arr.map(a => [...a]))
    } else {
      setTplSaved(null)
      setTplEdit(Array.from({ length: 7 }, () => []))
    }
    setTplApplied(new Set(((apRows ?? []) as { date: string }[]).map(r => r.date)))
  }, [])

  // 初期化
  useEffect(() => {
    const init = async () => {
      try {
        // モード所要時間 (scrim_formats)
        const { data: fmtRows } = await supabase.from('scrim_formats').select('format, minutes_per_map')
        if (fmtRows && fmtRows.length > 0) {
          const f = { ...DEFAULT_MINUTES }
          for (const r of fmtRows as { format: 'hp' | 'snd' | 'ovl'; minutes_per_map: number }[]) f[r.format] = r.minutes_per_map
          setFormats(f)
        }

        const { data: { session } } = await supabase.auth.getSession()
        const uid = session?.user?.id ?? null
        setMyUserId(uid)

        if (uid) {
          const { data: tm } = await supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle()
          const teamId = (tm as { team_id: string } | null)?.team_id
          if (teamId) {
            const [{ data: teamRow }, { data: members }, { data: st }] = await Promise.all([
              supabase.from('teams').select('id, name, owner_user_id').eq('id', teamId).maybeSingle(),
              supabase.from('team_members').select('user_id, profiles!inner(display_name)').eq('team_id', teamId),
              supabase.from('team_settings').select('discord_webhook_url').eq('team_id', teamId).maybeSingle(),
            ])
            if (teamRow) {
              const tr = teamRow as { id: string; name: string; owner_user_id: string }
              setTeamInfo({ id: tr.id, name: tr.name, isOwner: tr.owner_user_id === uid })
            }
            const names = ((members ?? []) as unknown as { user_id: string; profiles: { display_name: string | null } }[])
              .map(m => ({ uid: m.user_id, name: m.profiles?.display_name ?? '(名前未設定)' }))
            setRoster(names.filter(n => n.uid !== uid))
            const savedWh = (st as { discord_webhook_url: string | null } | null)?.discord_webhook_url
            if (savedWh) { setWebhookUrl(savedWh); setWhTested(true) }
            else { try { const l = localStorage.getItem(WH_LOCAL_KEY); if (l) setWebhookUrl(l) } catch { /* noop */ } }
          } else {
            try { const l = localStorage.getItem(WH_LOCAL_KEY); if (l) setWebhookUrl(l) } catch { /* noop */ }
          }
          // 混成ルーム募集通知の受信設定 (行なし = ON)
          const { data: rnPref } = await supabase
            .from('mixed_room_notify_prefs')
            .select('enabled')
            .eq('user_id', uid)
            .maybeSingle<{ enabled: boolean }>()
          if (rnPref) setRoomNotifyOn(rnPref.enabled)

          await Promise.all([loadMine(uid), loadTemplate(uid)])
        }

        await loadBoard()
      } catch (e) {
        console.error('board init error:', e)
        showToast('読み込みに失敗しました', 'ページを再読み込みしてください')
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [loadBoard, loadMine, loadTemplate])

  // Realtime: 成立の変化は全体購読、自チームの空きはチーム単位で購読
  useEffect(() => {
    const ch = supabase.channel('scrim-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrim_matches' }, () => void loadBoard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrim_mixed_rooms' }, () => void loadBoard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrim_mixed_room_members' }, () => void loadBoard())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [loadBoard])

  useEffect(() => {
    if (!teamInfo?.id) return
    const ch = supabase.channel(`scrim-board-team-${teamInfo.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_availability', filter: `team_id=eq.${teamInfo.id}` }, () => void loadBoard())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [teamInfo?.id, loadBoard])

  // 他チームの空きはポーリング (45秒)
  useEffect(() => {
    const iv = setInterval(() => void loadBoard(), 45000)
    return () => clearInterval(iv)
  }, [loadBoard])

  // ---- 導出値 ----
  const slotsNeeded = () => {
    if (mode === 'hp') return mapsToSlots(formats.hp, 6) // ハーポ回し = 6マップ
    if (mode === 'snd') return mapsToSlots(formats.snd, sndMaps)
    if (mode === 'ovl') return mapsToSlots(formats.ovl, ovlMaps)
    if (mode === 'custom') return mapsToSlots(formats.hp, combo.hp) + mapsToSlots(formats.snd, combo.snd) + mapsToSlots(formats.ovl, combo.ovl)
    return 0 // all
  }
  const comboLabel = () => {
    const parts: string[] = []
    if (combo.hp > 0) parts.push(`ハーポ${combo.hp}`)
    if (combo.snd > 0) parts.push(`サーチ${combo.snd}`)
    if (combo.ovl > 0) parts.push(`オバロ${combo.ovl}`)
    return parts.join(' + ')
  }
  const currentModeLabel = () => (mode === 'custom' ? `複合 (${comboLabel() || '未選択'})` : mode === 'hp' ? 'ハーポ回し' : mode === 'snd' ? `サーチ ${sndMaps}マップ` : mode === 'ovl' ? `オバロ ${ovlMaps}マップ` : 'すべて')
  const currentMaps = () => (
    mode === 'hp' ? { hp: 6, snd: 0, ovl: 0 }
    : mode === 'snd' ? { hp: 0, snd: sndMaps, ovl: 0 }
    : mode === 'ovl' ? { hp: 0, snd: 0, ovl: ovlMaps }
    : { hp: combo.hp, snd: combo.snd, ovl: combo.ovl }
  )
  const need = slotsNeeded()

  const countsFor = (teamId: string, day: number): number[] =>
    counts[`${teamId}|${weekDays[day]?.dateStr ?? ''}`] ?? Array(10).fill(0)

  const matchedSet = (teamId: string, day: number) => {
    const dateStr = weekDays[day]?.dateStr
    const set = new Set<number>()
    matches.forEach(m => {
      if (m.date !== dateStr) return
      if (m.host_team_id !== teamId && m.guest_team_id !== teamId) return
      for (let i = m.slot_start; i < m.slot_end; i++) set.add(i)
    })
    return set
  }
  // 当日かつ開始から30分以上経過した枠 (終了済み) か
  const slotEnded = (day: number, i: number) =>
    day === 0 && nowMins !== null && nowMins >= 1200 + 30 * (i + 1)

  const runs = (teamId: string, day: number) => {
    const a = countsFor(teamId, day)
    const taken = matchedSet(teamId, day)
    const out: [number, number][] = []
    let s = -1
    for (let i = 0; i <= 10; i++) {
      const ok = i < 10 && a[i] >= 4 && !taken.has(i) && !slotEnded(day, i)
      if (ok && s < 0) s = i
      if (!ok && s >= 0) { out.push([s, i - 1]); s = -1 }
    }
    return out
  }
  const prefsFor = (teamId: string): PrefsRow => prefsMap[teamId] ?? { hp: true, snd: true, ovl: true, range: 'any', contact: null }

  // その日の「空いているメンバー」基準のレート集計 (spec 6章: チーム固定レートは持たない)
  const dayRating = (teamId: string, day: number): { avg: number | null; min: number | null; max: number | null } => {
    const key = `${teamId}|${weekDays[day]?.dateStr ?? ''}`
    const r = ratings[key]
    const c = counts[key]
    if (!r || !c) return { avg: null, min: null, max: null }
    const avgs: number[] = []
    let mn: number | null = null
    let mx: number | null = null
    for (let i = 0; i < 10; i++) {
      if (c[i] > 0 && r.avg[i] != null) avgs.push(r.avg[i]!)
      if (c[i] > 0 && r.min[i] != null) mn = mn == null ? r.min[i]! : Math.min(mn, r.min[i]!)
      if (c[i] > 0 && r.max[i] != null) mx = mx == null ? r.max[i]! : Math.max(mx, r.max[i]!)
    }
    return { avg: avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null, min: mn, max: mx }
  }
  const spanRating = (teamId: string, day: number, start: number, len: number): { avg: number | null; min: number | null; max: number | null } => {
    const key = `${teamId}|${weekDays[day]?.dateStr ?? ''}`
    const r = ratings[key]
    if (!r) return { avg: null, min: null, max: null }
    const avgs: number[] = []
    let mn: number | null = null
    let mx: number | null = null
    for (let i = start; i < start + len; i++) {
      if (r.avg[i] != null) avgs.push(r.avg[i]!)
      if (r.min[i] != null) mn = mn == null ? r.min[i]! : Math.min(mn, r.min[i]!)
      if (r.max[i] != null) mx = mx == null ? r.max[i]! : Math.max(mx, r.max[i]!)
    }
    return { avg: avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null, min: mn, max: mx }
  }
  const acceptsMode = (teamId: string) => {
    if (mode === 'all') return true
    const p = prefsFor(teamId)
    const m = currentMaps()
    if (m.hp > 0 && !p.hp) return false
    if (m.snd > 0 && !p.snd) return false
    if (m.ovl > 0 && !p.ovl) return false
    return true
  }
  // 自チーム・相手チームとも「その日の空きメンバー」基準のティアで比較
  const myDayTier = teamInfo ? getTier(dayRating(teamInfo.id, viewDay).avg) : getTier(null)
  const tierGapTo = (teamId: string) => {
    const other = getTier(dayRating(teamId, viewDay).avg)
    if (other.idx === 0 || myDayTier.idx === 0) return null // 未計測扱い
    return Math.abs(other.idx - myDayTier.idx)
  }
  const inRange = (teamId: string) => {
    const g = tierGapTo(teamId)
    return g == null || g <= 1
  }
  // 相手が「同格±1」受付で、自チームが範囲外か (表示のみ。ハードフィルタにはしない)
  const outOfHostRange = (teamId: string) => {
    if (!teamInfo) return false
    if (prefsFor(teamId).range !== 'similar') return false
    const g = tierGapTo(teamId)
    return g != null && g > 1
  }

  // ---- 混成ルーム: 導出値 ----
  const roomMembersOf = (roomId: string) => roomMembers[roomId] ?? []
  const roomAvg = (roomId: string): number | null => {
    const rs = roomMembersOf(roomId).map(m => m.rating).filter((v): v is number => v != null)
    return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null
  }
  const myRoomForDay = (day: number): RoomRow | null => {
    const dateStr = weekDays[day]?.dateStr
    if (!dateStr || !myUserId) return null
    return rooms.find(r => r.date === dateStr && r.status === 'open' && roomMembersOf(r.id).some(m => m.uid === myUserId)) ?? null
  }

  // 自分の側 (自チーム or 参加中の混成ルーム) がその枠でマッチングできるか。
  // 他チーム/ルームの空きを「噛み合う枠だけ明るく表示」するための判定。
  // null = 自分の側が無い (チーム未所属かつルーム不参加) → 判定不能で従来どおり全表示
  const mySideOk = (day: number, i: number): boolean | null => {
    if (teamInfo) {
      const c = countsFor(teamInfo.id, day)
      const taken = matchedSet(teamInfo.id, day)
      return c[i] >= 4 && !taken.has(i)
    }
    const room = myRoomForDay(day)
    if (room) return i >= room.slot_start && i < room.slot_end
    return null
  }
  // ボードに載せるルーム: その日・募集中・4人以上
  const boardRooms = (() => {
    const dateStr = weekDays[viewDay]?.dateStr
    return rooms
      .filter(r => r.date === dateStr && r.status === 'open' && roomMembersOf(r.id).length >= 4)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  })()
  // ルーム一覧 (週内の募集中。人数不問 — 募集掲示板を兼ねる)
  const weekOpenRooms = rooms
    .filter(r => r.status === 'open')
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot_start - b.slot_start)
  const roomTierGap = (roomId: string) => {
    const other = getTier(roomAvg(roomId))
    if (other.idx === 0 || myDayTier.idx === 0) return null
    return Math.abs(other.idx - myDayTier.idx)
  }
  // 成立行の表示名・自分の対戦判定 (チーム/ルーム両対応)
  const sideName = (m: MatchRow, side: 'host' | 'guest') => {
    const tid = side === 'host' ? m.host_team_id : m.guest_team_id
    const rid = side === 'host' ? m.host_room_id : m.guest_room_id
    if (tid) return teams.find(t => t.id === tid)?.name ?? '不明'
    const r = rooms.find(x => x.id === rid)
    return r ? `${r.name}【混成】` : '不明【混成】'
  }
  const isMySide = (m: MatchRow, side: 'host' | 'guest') => {
    const tid = side === 'host' ? m.host_team_id : m.guest_team_id
    const rid = side === 'host' ? m.host_room_id : m.guest_room_id
    if (tid && teamInfo && tid === teamInfo.id) return true
    return !!rid && !!myUserId && roomMembersOf(rid).some(x => x.uid === myUserId)
  }
  const isMyMatch = (m: MatchRow) => isMySide(m, 'host') || isMySide(m, 'guest')

  // 表示行: 自チームを先頭に、その日に空きか成立のあるチーム
  const visibleTeams = (() => {
    const dateStr = weekDays[viewDay]?.dateStr
    const rows = teams.filter(t => {
      if (t.id === teamInfo?.id) return true
      const c = countsFor(t.id, viewDay)
      if (c.some(v => v > 0)) return true
      return matches.some(m => m.date === dateStr && (m.host_team_id === t.id || m.guest_team_id === t.id))
    })
    rows.sort((a, b) => (a.id === teamInfo?.id ? -1 : b.id === teamInfo?.id ? 1 : a.name.localeCompare(b.name, 'ja')))
    return rows
  })()

  const myOpenCount = teamInfo ? countsFor(teamInfo.id, editDay).filter(v => v >= 4).length : 0
  const myStat = teamInfo
    ? (myOpenCount ? `${myOpenCount} 枠が募集中` : '募集に出ている枠はありません')
    : ''

  const modeDurLabel = mode === 'all'
    ? '空き状況の俯瞰 — モードを選ぶと開始マーカーが出ます'
    : mode === 'custom' && need === 0
      ? '複合 — 下の構成からモードを選んでください'
      : `${currentModeLabel()} · 所要 ${need}枠 (${need * 30}分) · 最終開始 ${slotLabel(10 - need)}`

  // now ライン: 今日の表示のみ
  let nowLine: { left: string; label: string } | null = null
  if (nowMins !== null && viewDay === 0 && nowMins >= 1200) {
    const f = Math.min(1, (nowMins - 1200) / 300)
    nowLine = {
      left: `calc(181px + (100% - 181px) * ${f.toFixed(4)})`,
      label: `${Math.floor(nowMins / 60)}:${String(nowMins % 60).padStart(2, '0')} 現在`,
    }
  }

  // ---- 空き入力 (楽観更新 + debounce 保存) ----
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const persistDay = useCallback((dateStr: string, slots: number[]) => {
    const target = targetUid // 保存時点の対象 (null = 自分)
    if (saveTimersRef.current[dateStr]) clearTimeout(saveTimersRef.current[dateStr])
    saveTimersRef.current[dateStr] = setTimeout(async () => {
      const { error } = target
        ? await supabase.rpc('rpc_scrimboard_set_availability_for', { p_target_user_id: target, p_date: dateStr, p_slots: slots })
        : await supabase.rpc('rpc_scrimboard_set_availability', { p_date: dateStr, p_slots: slots })
      if (error) {
        showToast('空き時間の保存に失敗しました', error.message)
        void loadMine(target ?? myUserId ?? '')
        void loadBoard()
      }
    }, 600)
  }, [targetUid, myUserId, loadMine, loadBoard])

  const toggleSlot = (day: number, slot: number) => {
    if (!teamInfo) { showToast('チームに所属すると空き時間を登録できます', 'メニューの「チーム」から作成・参加できます'); return }
    const dateStr = weekDays[day]?.dateStr
    if (!dateStr) return
    const cur = myMine[dateStr] ?? []
    const on = cur.includes(slot)
    const next = on ? cur.filter(s => s !== slot) : [...cur, slot]
    setMyMine(prev => ({ ...prev, [dateStr]: next }))
    // 自チームの集計も楽観更新 (ポーリングで正値に収束)
    setCounts(prev => {
      const key = `${teamInfo.id}|${dateStr}`
      const arr = (prev[key] ?? Array(10).fill(0)).slice()
      arr[slot] = Math.max(0, arr[slot] + (on ? -1 : 1))
      return { ...prev, [key]: arr }
    })
    persistDay(dateStr, next)
  }

  // ---- 受付モード ----
  const myPrefs: PrefsRow = teamInfo ? prefsFor(teamInfo.id) : { hp: true, snd: true, ovl: true, range: 'any', contact: null }
  const savePrefs = async (next: PrefsRow) => {
    if (!teamInfo) return
    setPrefsMap(prev => ({ ...prev, [teamInfo.id]: next }))
    const { error } = await supabase.from('scrim_team_prefs').upsert({
      team_id: teamInfo.id,
      accept_hp: next.hp,
      accept_snd: next.snd,
      accept_ovl: next.ovl,
      accept_range: next.range,
      public_contact: next.contact,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'team_id' })
    if (error) {
      showToast('受付設定の保存に失敗しました', error.message)
      void loadBoard()
    }
  }
  const togglePref = (k: 'hp' | 'snd' | 'ovl') => savePrefs({ ...myPrefs, [k]: !myPrefs[k] })
  const setRange = (r: 'any' | 'similar') => savePrefs({ ...myPrefs, range: r })

  // ---- 成立 / キャンセル ----
  const confirmMatch = async () => {
    if (!modal || confirming) return
    const dateStr = weekDays[modal.day]?.dateStr
    if (!dateStr) return
    const m = currentMaps()
    // 自分の立場: チーム未所属なら自動でルーム、両方あれば modalAs の選択に従う
    const asRoom = myRoomForDay(modal.day)
    const useRoomSide = !!asRoom && (!teamInfo || modalAs === 'room')
    setConfirming(true)
    const { data, error } = await supabase.rpc('rpc_scrimboard_confirm', {
      p_date: dateStr,
      p_slot_start: modal.start,
      p_hp_maps: m.hp,
      p_snd_maps: m.snd,
      p_ovl_maps: m.ovl,
      p_target_team_id: modal.side === 'team' ? modal.targetId : null,
      p_target_room_id: modal.side === 'room' ? modal.targetId : null,
      p_as_room_id: useRoomSide ? asRoom.id : null,
    })
    setConfirming(false)
    if (error) {
      showToast('成立できませんでした', error.message)
      setModal(null)
      void loadBoard()
      return
    }
    setModal(null)
    // 成立後は試合ページへ (連絡・ロビーコード共有はそこで行う)
    const matchIdNew = (data as { match_id?: string } | null)?.match_id
    if (matchIdNew) {
      router.push(`/custom/board/${matchIdNew}`)
      return
    }
    showToast('対戦が成立しました', '参加メンバーに通知しました')
    void loadBoard()
  }

  // ---- 混成ルーム操作 ----
  const roomCreate = async () => {
    if (!myUserId) { showToast('ログインが必要です', '混成ルームの作成にはログインしてください'); return }
    const dateStr = weekDays[roomDay]?.dateStr
    if (!dateStr) return
    if (!roomName.trim()) { showToast('ルーム名を入力してください', '例: 金曜ミックス'); return }
    if (roomEnd <= roomStart) { showToast('時間帯の指定が不正です', '終了は開始より後にしてください'); return }
    setRoomBusy(true)
    const { error } = await supabase.rpc('rpc_scrimboard_room_create', {
      p_name: roomName.trim(), p_date: dateStr, p_slot_start: roomStart, p_slot_end: roomEnd, p_note: roomNote.trim() || null,
    })
    setRoomBusy(false)
    if (error) { showToast('ルームを作成できませんでした', error.message); return }
    setRoomCreateOpen(false); setRoomName(''); setRoomNote('')
    showToast('混成ルームを作成しました', '4人集まるとボードに掲載されます')
    void loadBoard()
  }
  const roomJoin = async (roomId: string) => {
    if (!myUserId) { showToast('ログインが必要です', '混成ルームへの参加にはログインしてください'); return }
    setRoomBusy(true)
    const { error } = await supabase.rpc('rpc_scrimboard_room_join', { p_room_id: roomId })
    setRoomBusy(false)
    if (error) { showToast('参加できませんでした', error.message); return }
    showToast('混成ルームに参加しました', '4人集まるとボードに掲載されます')
    void loadBoard()
  }
  const roomNotify = async (roomId: string) => {
    setRoomBusy(true)
    const { data, error } = await supabase.rpc('rpc_scrimboard_room_notify', { p_room_id: roomId })
    setRoomBusy(false)
    if (error) { showToast('通知を送れませんでした', error.message); return }
    const n = (data as { notified?: number } | null)?.notified ?? 0
    showToast('募集通知を送信しました', `${n}人にサイト内通知とDiscordメンションを送りました（1ルーム1日1回まで）`)
    void loadBoard()
  }
  const roomNotifiedToday = (r: RoomRow) => {
    if (!r.last_notified_at) return false
    const today = weekDays[0]?.dateStr
    return !!today && fmtDate(new Date(r.last_notified_at)) === today
  }
  const toggleRoomNotifyPref = async () => {
    const next = !roomNotifyOn
    setRoomNotifyOn(next)
    const { error } = await supabase.rpc('rpc_scrimboard_room_notify_pref', { p_enabled: next })
    if (error) { setRoomNotifyOn(!next); showToast('設定の保存に失敗しました', error.message) }
  }

  const roomLeave = async (roomId: string) => {
    setRoomBusy(true)
    const { data, error } = await supabase.rpc('rpc_scrimboard_room_leave', { p_room_id: roomId })
    setRoomBusy(false)
    if (error) { showToast('操作に失敗しました', error.message); return }
    const disbanded = (data as { disbanded?: boolean } | null)?.disbanded
    showToast(disbanded ? 'ルームを解散しました' : 'ルームを抜けました', disbanded ? 'ホストが抜けたためルームは解散されました' : '')
    void loadBoard()
  }

  const doCancel = async () => {
    if (!cancelId || cancelling) return
    setCancelling(true)
    const { error } = await supabase.rpc('rpc_scrimboard_cancel', { p_match_id: cancelId })
    setCancelling(false)
    setCancelId(null)
    if (error) { showToast('キャンセルできませんでした', error.message); return }
    showToast('対戦をキャンセルしました', '枠はボードに戻り、相手チームに通知されました')
    void loadBoard()
  }

  // ---- 曜日テンプレ (曜日ごとの時間をDB保存・毎晩自動反映) ----
  const tplHas = tplSaved !== null
  const tplSavedDayNames = tplSaved ? DOW.filter((_, i) => (tplSaved[i]?.length ?? 0) > 0).join('・') : ''
  const tplStatus = !tplHas ? '未設定' : `毎週 ${tplSavedDayNames} に自動反映`

  // スロット配列を「21:00–23:30」のような連続レンジ表記に圧縮する
  const slotsRangeLabel = (slots: number[]): string => {
    if (slots.length === 0) return ''
    const s = [...slots].sort((a, b) => a - b)
    const parts: string[] = []
    let start = s[0]
    let prev = s[0]
    for (let i = 1; i <= s.length; i++) {
      const v = s[i]
      if (v !== prev + 1) {
        parts.push(`${slotLabel(start)}–${slotLabel(prev + 1)}`)
        start = v
      }
      prev = v
    }
    return parts.join(' / ')
  }

  const tplToggleSlot = (dow: number, slot: number) => {
    setTplEdit(prev => prev.map((arr, i) => i === dow
      ? (arr.includes(slot) ? arr.filter(x => x !== slot) : [...arr, slot].sort((a, b) => a - b))
      : arr))
  }
  const tplClearDay = (dow: number) => setTplEdit(prev => prev.map((arr, i) => (i === dow ? [] : arr)))
  const tplDirty = (() => {
    const saved = tplSaved ?? Array.from({ length: 7 }, () => [] as number[])
    return tplEdit.some((arr, i) => arr.join(',') !== (saved[i] ?? []).join(','))
  })()

  const tplSave = async () => {
    const obj: Record<string, number[]> = {}
    tplEdit.forEach((arr, i) => { if (arr.length > 0) obj[String(i)] = arr })
    const { data, error } = await supabase.rpc('rpc_scrimboard_save_template_days', { p_day_slots: obj })
    if (error) { showToast('テンプレの保存に失敗しました', error.message); return }
    const res = data as { applied_days?: number; deleted?: boolean } | null
    if (res?.deleted) {
      showToast('曜日テンプレを削除しました', '自動反映を停止しました')
    } else {
      const applied = res?.applied_days ?? 0
      showToast('曜日テンプレを保存しました', `設定した曜日へ毎週自動で反映します${applied ? `（未入力だった${applied}日分に今すぐ反映済み）` : ''}`)
    }
    if (myUserId) { void loadMine(myUserId); void loadTemplate(myUserId) }
    void loadBoard()
  }
  const tplClear = async () => {
    const { error } = await supabase.rpc('rpc_scrimboard_save_template_days', { p_day_slots: {} })
    if (error) { showToast('テンプレの削除に失敗しました', error.message); return }
    setTplSaved(null)
    setTplEdit(Array.from({ length: 7 }, () => []))
    setTplApplied(new Set())
    showToast('曜日テンプレを削除しました', '自動反映を停止しました')
  }

  // ---- Webhook 設定 ----
  const testWebhook = async () => {
    const url = webhookUrl.trim()
    if (!isValidWebhook(url)) { setWhError('URLの形式が正しくありません。https://discord.com/api/webhooks/... の形式で入力してください'); return }
    setWhBusy(true); setWhError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ASCENT 交流戦ボード', content: '✅ テスト通知です。この通知が見えていれば設定は正常です。' }),
      })
      if (res.ok) { setWhTested(true); showToast('テスト通知を送信しました', 'Discord のチャンネルを確認してください') }
      else if (res.status === 401 || res.status === 403 || res.status === 404) { setWhTested(false); setWhError(`Webhook が見つかりません (HTTP ${res.status})。URLの打ち間違い、または Discord 側で削除されていないか確認してください`) }
      else { setWhTested(false); setWhError(`送信に失敗しました (HTTP ${res.status})。しばらくして再試行してください`) }
    } catch {
      setWhTested(false); setWhError('送信できませんでした。ネットワーク接続を確認してください')
    } finally { setWhBusy(false) }
  }
  const saveWebhook = async () => {
    const url = webhookUrl.trim()
    if (url && !isValidWebhook(url)) { setWhError('URLの形式が正しくありません。https://discord.com/api/webhooks/... の形式で入力してください'); return }
    setWhBusy(true); setWhError(null)
    try {
      if (teamInfo?.isOwner) {
        const { error } = url
          ? await supabase.from('team_settings').upsert({ team_id: teamInfo.id, discord_webhook_url: url, updated_at: new Date().toISOString() }, { onConflict: 'team_id' })
          : await supabase.from('team_settings').delete().eq('team_id', teamInfo.id)
        if (error) { setWhError(error.message); return }
        showToast('通知設定を保存しました', `${teamInfo.name} のチーム設定に保存されました`)
      } else {
        try { if (url) localStorage.setItem(WH_LOCAL_KEY, url); else localStorage.removeItem(WH_LOCAL_KEY) } catch { /* noop */ }
        showToast('通知設定を保存しました', teamInfo ? 'Webhookのチーム保存はオーナーのみのため、この端末にのみ保存されました' : 'この端末に保存されました（チーム所属時はチーム全体に共有されます）')
      }
      // 公開連絡先はメンバー全員が保存できる (scrim_team_prefs)
      if (teamInfo) {
        const trimmedContact = contactInput.trim().slice(0, 200)
        if (trimmedContact !== (myPrefs.contact ?? '')) {
          await savePrefs({ ...myPrefs, contact: trimmedContact || null })
        }
      }
      setWebhookOpen(false)
    } finally { setWhBusy(false) }
  }

  // ---- モーダル用導出値 ----
  const modalIsRoom = modal?.side === 'room'
  const modalTarget = modal
    ? (modal.side === 'team'
      ? (teams.find(x => x.id === modal.targetId) ?? null)
      : ((rooms.find(x => x.id === modal.targetId) as { id: string; name: string } | undefined) ?? null))
    : null
  const modalPool = modal && modalTarget
    ? (modalIsRoom ? roomMembersOf(modal.targetId).length : Math.min(...countsFor(modal.targetId, modal.day).slice(modal.start, modal.start + modal.len)))
    : 0
  const modalSpanRating = modal && modalTarget
    ? (modalIsRoom ? { avg: roomAvg(modal.targetId), min: null, max: null } : spanRating(modal.targetId, modal.day, modal.start, modal.len))
    : { avg: null, min: null, max: null }
  const modalStats = modal && !modalIsRoom && modalTarget ? teamStats[modal.targetId] ?? { games: 0, cancels: 0 } : { games: 0, cancels: 0 }
  const modalPrefs: PrefsRow = modal && !modalIsRoom && modalTarget ? prefsFor(modal.targetId) : { hp: true, snd: true, ovl: true, range: 'any', contact: null }
  const modalMyRoom = modal ? myRoomForDay(modal.day) : null

  const cancelMatch = cancelId !== null ? matches.find(x => x.id === cancelId) ?? null : null
  const cancelOppName = cancelMatch
    ? (isMySide(cancelMatch, 'host') ? sideName(cancelMatch, 'guest') : sideName(cancelMatch, 'host'))
    : ''

  const modeDefs: [Mode, string][] = [['hp', 'ハーポ回し · 90分'], ['snd', 'サーチ'], ['ovl', 'オバロ'], ['custom', '複合'], ['all', 'すべて (俯瞰)']]
  const showMaps = mode === 'snd' || mode === 'ovl'

  // 日付タブ
  const renderDayTabs = (value: number, onChange: (d: number) => void, dots: boolean[]) => (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {weekDays.length === 0 ? (
        <div style={{ height: 34 }} />
      ) : (
        weekDays.map((wd, i) => {
          const on = value === i
          const weekend = wd.dow === 0 || wd.dow === 6
          return (
            <button key={i} type="button" className="mono sb-hoverline" aria-pressed={on} onClick={() => onChange(i)}
              style={{
                position: 'relative', fontSize: 11.5, fontWeight: on ? 700 : 600, padding: '7px 10px', borderRadius: 8,
                cursor: 'pointer', transition: 'all .12s',
                background: on ? 'rgba(0,229,255,0.14)' : 'rgba(6,10,22,0.75)',
                color: on ? '#9df3ff' : weekend ? '#c9b8ff' : 'var(--text-dim)',
                border: `1px solid ${on ? 'rgba(0,229,255,0.5)' : LINE}`,
              }}>
              {i === 0 ? `今日 ${wd.label}` : wd.label}
              {dots[i] && <span style={{ position: 'absolute', top: 3, right: 4, width: 5, height: 5, borderRadius: '50%', background: 'var(--cyan)', boxShadow: '0 0 6px var(--cyan)' }} />}
            </button>
          )
        })
      )}
    </div>
  )
  const editDots = weekDays.map(wd => (myMine[wd.dateStr] ?? []).length > 0)
  const viewDots = weekDays.map(wd => matches.some(m => m.date === wd.dateStr))

  if (loading) {
    return (
      <main>
        <span className="eyebrow">SCRIM BOARD · UNRATED</span>
        <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4.5vw, 3.4rem)', marginTop: 8 }}>交流戦<em>ボード。</em></h1>
        <div className="card" style={{ textAlign: 'center', padding: 40, marginTop: 20 }}><span className="muted">読み込み中...</span></div>
      </main>
    )
  }

  return (
    <main>
      <style>{`
        .sb-hoverline:hover { border-color: rgba(0,229,255,0.6) !important; }
        .sb-link:hover { color: var(--danger) !important; }
      `}</style>

      {/* ===== ページヘッダ ===== */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}>
        <div>
          <span className="eyebrow">SCRIM BOARD · UNRATED</span>
          <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4.5vw, 3.4rem)', marginTop: 8 }}>
            交流戦<em>ボード。</em>
          </h1>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 14, maxWidth: 560 }}>
            1週間分のチームの空き時間を出し合って、対戦相手をその場で確定。成立すると両チームの Discord に通知が届きます。
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <div className="mono" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '0.04em' }}>{dateLabel || ' '}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className="badge"><span className="badge-dot" />MODERN WARFARE 4 · 4v4</span>
            <span className="badge violet">UNRATED — レート変動なし</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => router.push('/rules')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              GAルール
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setContactInput(myPrefs.contact ?? ''); setWebhookOpen(true) }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.6" /></svg>
              通知設定
            </button>
          </div>
        </div>
      </div>

      {/* ===== STEP 1 : 空き入力 ===== */}
      {teamInfo ? (
        <section className="card-strong" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div className="sec-title" style={{ marginBottom: 4 }}>STEP 1</div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}>自分の空き時間を入れる（1週間分）</div>
            </div>
            <div className="mono" style={{ fontSize: 12, color: myOpenCount ? 'var(--success)' : 'var(--text-dim)', paddingTop: 6 }}>
              {dayLabel(editDay)}: {myStat}
            </div>
          </div>

          {/* 代理入力: オーナーはメンバーの空きを入力できる */}
          {teamInfo.isOwner && roster.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>入力対象:</span>
              <button type="button" className="sb-hoverline" aria-pressed={targetUid === null}
                onClick={() => setTargetUid(null)}
                style={{
                  fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', transition: 'all .12s',
                  background: targetUid === null ? 'rgba(255,176,32,0.15)' : 'rgba(6,10,22,0.6)',
                  color: targetUid === null ? 'var(--amber)' : 'var(--text-dim)',
                  border: `1px solid ${targetUid === null ? 'rgba(255,176,32,0.4)' : LINE}`,
                }}>
                自分
              </button>
              {roster.map(m => (
                <button key={m.uid} type="button" className="sb-hoverline" aria-pressed={targetUid === m.uid}
                  onClick={() => setTargetUid(m.uid)}
                  style={{
                    fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', transition: 'all .12s',
                    background: targetUid === m.uid ? 'rgba(0,229,255,0.14)' : 'rgba(6,10,22,0.6)',
                    color: targetUid === m.uid ? '#9df3ff' : 'var(--text-dim)',
                    border: `1px solid ${targetUid === m.uid ? 'rgba(0,229,255,0.5)' : LINE}`,
                  }}>
                  {m.name}
                </button>
              ))}
              {targetUid && (
                <span style={{ fontSize: 11, color: 'var(--amber)' }}>
                  {roster.find(m => m.uid === targetUid)?.name} さんの空きを代理入力中
                </span>
              )}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            {renderDayTabs(editDay, setEditDay, editDots)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 6 }}>
            {SLOTS.map((s, i) => {
              const dateStr = weekDays[editDay]?.dateStr
              const on = dateStr ? (myMine[dateStr] ?? []).includes(i) : false
              return (
                <button key={s} type="button" className="mono sb-hoverline" aria-pressed={on}
                  onClick={() => toggleSlot(editDay, i)}
                  style={{
                    fontSize: 12.5, fontWeight: 600, padding: '12px 0', borderRadius: 8, cursor: 'pointer', transition: 'all .12s',
                    background: on ? 'rgba(0,229,255,0.14)' : 'rgba(6,10,22,0.75)',
                    color: on ? '#9df3ff' : 'var(--text-dim)',
                    border: `1px solid ${on ? 'rgba(0,229,255,0.5)' : LINE}`,
                    boxShadow: on ? '0 0 14px rgba(0,229,255,0.15)' : 'none',
                  }}>
                  {s}
                </button>
              )
            })}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
            日付タブで日を切り替えて、押した時間があなたの空きになります。チームで <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>4人</span> 揃った枠だけが下のボードに募集として公開されます。枠ごとに同じ4人である必要はありません（途中交代OK）。
          </p>

          {/* 曜日テンプレ */}
          <div style={{ marginTop: 16, background: 'rgba(6,10,22,0.5)', border: `1px solid ${tplHas ? 'rgba(0,229,255,0.25)' : LINE}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 2v4M7 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M12 13v4M10 15h4" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" /></svg>
                曜日テンプレ
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>曜日ごとに空き時間を選んで保存すると、毎晩その曜日へ自動で反映されます（手動入力済みの日は上書きしません）</span>
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: tplHas ? '#9df3ff' : 'var(--text-dim)' }}>{tplStatus}</span>
            </div>

            {/* 曜日ごとの入力行 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {DOW.map((label, dow) => {
                const arr = tplEdit[dow] ?? []
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ width: 22, flex: 'none', fontSize: 12, fontWeight: 700, color: arr.length > 0 ? '#9df3ff' : 'var(--text-dim)' }}>{label}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {Array.from({ length: 10 }, (_, s) => {
                        const on = arr.includes(s)
                        return (
                          <button key={s} type="button" className="mono" aria-pressed={on}
                            onClick={() => tplToggleSlot(dow, s)}
                            style={{
                              fontSize: 10.5, padding: '4px 7px', borderRadius: 6, cursor: 'pointer', transition: 'all .1s',
                              background: on ? 'rgba(0,229,255,0.14)' : 'rgba(6,10,22,0.75)',
                              color: on ? '#9df3ff' : 'var(--text-dim)',
                              border: `1px solid ${on ? 'rgba(0,229,255,0.5)' : LINE}`,
                            }}>
                            {slotLabel(s)}
                          </button>
                        )
                      })}
                    </div>
                    {arr.length > 0 && (
                      <button type="button" onClick={() => tplClearDay(dow)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, padding: '2px 4px' }}>
                        クリア
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" onClick={() => void tplSave()} disabled={!tplDirty}
                style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', opacity: tplDirty ? 1 : 0.5, cursor: tplDirty ? 'pointer' : 'default' }}>
                テンプレを保存
              </button>
              {tplDirty && <span style={{ fontSize: 11, color: 'var(--amber)' }}>未保存の変更があります</span>}
              {tplHas && (
                <button type="button" className="sb-link" onClick={() => void tplClear()}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 11.5, padding: '8px 6px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  自動反映を停止
                </button>
              )}
            </div>

            {/* 今週の自動反映状況 (代理入力中は myMine が他人の空きになるため非表示) */}
            {tplHas && !targetUid && weekDays.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 8 }}>今週の自動反映状況</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {weekDays.map((wd, di) => {
                    const daySlots = tplSaved?.[wd.dow] ?? []
                    const target = daySlots.length > 0
                    const applied = tplApplied.has(wd.dateStr)
                    const manual = (myMine[wd.dateStr]?.length ?? 0) > 0
                    const st = !target
                      ? { text: '対象外', color: 'var(--text-dim)', bg: 'rgba(6,10,22,0.5)', border: LINE }
                      : applied
                        ? { text: '反映済み', color: '#9df3ff', bg: 'rgba(0,229,255,0.1)', border: 'rgba(0,229,255,0.4)' }
                        : manual
                          ? { text: '手動入力あり', color: 'var(--amber)', bg: 'var(--amber-soft)', border: 'rgba(255,176,32,0.4)' }
                          : { text: '反映予定', color: 'var(--text-soft)', bg: 'rgba(6,10,22,0.5)', border: LINE_STRONG }
                    return (
                      <div key={wd.dateStr} style={{ minWidth: 92, textAlign: 'center', background: st.bg, border: `1px solid ${st.border}`, borderRadius: 8, padding: '7px 8px' }}>
                        <div className="mono" style={{ fontSize: 10.5, color: di === 0 ? 'var(--cyan)' : 'var(--text-soft)' }}>{di === 0 ? '今日' : wd.label}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: st.color, marginTop: 3 }}>{st.text}</div>
                        {target && <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 2 }}>{slotsRangeLabel(daySlots)}</div>}
                      </div>
                    )
                  })}
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 10.5, color: 'var(--text-dim)' }}>
                  「反映済み」= テンプレで空きを登録済み（その後の手動変更はそのまま残ります）。「手動入力あり」= すでに自分で入力済みのため上書きしません。設定曜日は保存時に2週間先まで即反映され、以降は毎晩自動で追加されます。
                </p>
              </div>
            )}
          </div>

          {/* ロスター + 受付モード */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="stat-label">{teamInfo.name}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--amber-soft)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 6, padding: '3px 9px' }}>あなた</span>
              {roster.map(m => (
                <span key={m.uid} className="mono" style={{ fontSize: 11, color: 'var(--text-soft)', background: 'rgba(6,10,22,0.75)', border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 9px' }}>{m.name}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>受付範囲:</span>
              {([['any', '誰でも歓迎'], ['similar', '同格 ±1帯']] as ['any' | 'similar', string][]).map(([k, label]) => {
                const on = myPrefs.range === k
                return (
                  <button key={k} type="button" aria-pressed={on}
                    onClick={() => void setRange(k)}
                    style={{
                      fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', transition: 'all .12s',
                      background: on ? 'rgba(139,92,246,0.18)' : 'rgba(6,10,22,0.6)',
                      color: on ? '#c9b8ff' : 'var(--text-dim)',
                      border: `1px solid ${on ? 'rgba(139,92,246,0.5)' : LINE}`,
                    }}>
                    {label}
                  </button>
                )
              })}
              <span style={{ width: 1, height: 18, background: LINE_STRONG }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>受けられるモード:</span>
              {([['hp', 'ハーポ'], ['snd', 'サーチ'], ['ovl', 'オバロ']] as ['hp' | 'snd' | 'ovl', string][]).map(([k, label]) => {
                const on = myPrefs[k]
                return (
                  <button key={k} type="button" aria-pressed={on}
                    onClick={() => void togglePref(k)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', transition: 'all .12s',
                      background: on ? 'rgba(0,245,160,0.12)' : 'rgba(6,10,22,0.6)',
                      color: on ? '#8ff5cd' : 'var(--text-dim)',
                      border: `1px solid ${on ? 'rgba(0,245,160,0.35)' : LINE}`,
                    }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'var(--success)' : '#3a4260' }} />{label}
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      ) : (
        <section className="card-strong" style={{ marginBottom: 20 }}>
          <div className="sec-title">STEP 1</div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {myUserId ? 'チームに所属すると空き時間を入力できます' : 'ログインしてチームに所属すると空き時間を入力できます'}
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>ボードの閲覧は誰でもできます。対戦を組むには4人以上のチーム、または下の<span style={{ color: '#c9b8ff', fontWeight: 700 }}>混成ルーム</span>(チーム不要・誰でも参加可)が必要です。</p>
          <div className="row" style={{ marginTop: 12 }}>
            {myUserId ? (
              <>
                <button className="btn-primary btn-sm" onClick={() => router.push('/team/create')}>チームを作成</button>
                <button className="btn-ghost btn-sm" onClick={() => router.push('/team/join')}>チームに参加</button>
              </>
            ) : (
              <button className="btn-primary btn-sm" onClick={() => router.push('/login')}>ログイン</button>
            )}
          </div>
        </section>
      )}

      {/* ===== 混成ルーム (チームの垣根を越えた一時ロスター) ===== */}
      <section className="card-strong" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <div>
            <div className="sec-title" style={{ marginBottom: 4, color: 'var(--violet)' }}>MIXED</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}>混成ルーム — チームの垣根なしで4人を集める</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {myUserId && (
              <button type="button" onClick={() => void toggleRoomNotifyPref()} aria-pressed={roomNotifyOn}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-soft)', background: 'transparent', border: 'none', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ width: 32, height: 18, borderRadius: 9, border: `1px solid ${roomNotifyOn ? 'var(--violet)' : LINE_STRONG}`, background: roomNotifyOn ? 'rgba(139,92,246,0.25)' : 'rgba(22,28,58,0.9)', position: 'relative', display: 'inline-block', transition: 'all .15s' }}>
                  <span style={{ position: 'absolute', top: 2, left: roomNotifyOn ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: roomNotifyOn ? 'var(--violet)' : 'var(--text-dim)', transition: 'all .15s' }} />
                </span>
                募集通知を受け取る
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => { setRoomDay(viewDay); setRoomCreateOpen(true) }}
              style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', padding: '8px 14px' }}>
              + ルームを作る
            </button>
          </div>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)' }}>
          日時を決めてルームを作り、メンバーを募集。チーム所属・無所属を問わず誰でも参加できます。
          4人集まるとその日のボードに「MIXED」として掲載され、チームと同じ流れで対戦を組めます（1ルーム = 1対戦、1人が同じ日に入れるルームは1つ）。
        </p>
        {weekOpenRooms.length === 0 ? (
          <p className="dim" style={{ fontSize: 12, margin: 0 }}>募集中の混成ルームはありません — 最初のルームを作ってみましょう</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {weekOpenRooms.map(r => {
              const ms = roomMembersOf(r.id)
              const mineRoom = !!myUserId && ms.some(m => m.uid === myUserId)
              const day = dateToDay(r.date)
              const tier = getTier(roomAvg(r.id))
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(6,10,22,0.6)', border: `1px solid ${mineRoom ? 'rgba(139,92,246,0.45)' : LINE}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {r.name}{' '}
                      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: '#c9b8ff', border: '1px solid rgba(139,92,246,0.45)', borderRadius: 3, padding: '0 4px', verticalAlign: 2 }}>MIXED</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11.5, letterSpacing: '0.04em', marginTop: 2, color: 'var(--text-soft)' }}>
                      {day >= 0 ? dayLabel(day) : r.date} {slotLabel(r.slot_start)} – {slotLabel(r.slot_end)} · <span style={{ color: tier.color }}>{tier.label}</span>
                    </div>
                    {r.note && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>{r.note}</div>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {ms.map(m => (
                        <span key={m.uid} className="mono" style={{ fontSize: 10.5, color: m.uid === r.host_user_id ? 'var(--amber)' : 'var(--text-soft)', background: 'rgba(6,10,22,0.75)', border: `1px solid ${LINE}`, borderRadius: 6, padding: '2px 8px' }}>
                          {m.name}{m.uid === r.host_user_id ? ' ★' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: ms.length >= 4 ? 'var(--success)' : 'var(--text-dim)' }}>{ms.length}/5</span>
                  {ms.length >= 4
                    ? <span className="badge success" style={{ fontSize: 9 }}><span className="badge-dot" />ボード掲載中</span>
                    : <span className="badge" style={{ fontSize: 9 }}>あと{4 - ms.length}人</span>}
                  {mineRoom ? (
                    <>
                      <button type="button" className="btn-primary btn-sm" disabled={roomBusy || roomNotifiedToday(r)}
                        title={roomNotifiedToday(r) ? '本日は通知済みです（1ルーム1日1回）' : '全ユーザーに募集を通知します'}
                        onClick={() => void roomNotify(r.id)}>
                        {roomNotifiedToday(r) ? '📣 本日通知済み' : '📣 通知を送る'}
                      </button>
                      <button type="button" className="btn-ghost btn-sm" disabled={roomBusy} onClick={() => void roomLeave(r.id)}>
                        {r.host_user_id === myUserId ? '解散' : '抜ける'}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn-primary btn-sm" disabled={roomBusy || ms.length >= 5} onClick={() => void roomJoin(r.id)}>参加</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ===== STEP 2 : ボード ===== */}
      <section className="card-strong" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div className="sec-title" style={{ marginBottom: 4 }}>STEP 2</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}>日付とモードを選んで、相手の ▶ を押す</div>
          </div>
          <button type="button" onClick={() => setNear(v => !v)} aria-pressed={near}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-soft)', background: 'transparent', border: 'none', cursor: 'pointer', userSelect: 'none', paddingTop: 8 }}>
            <span style={{ width: 32, height: 18, borderRadius: 9, border: `1px solid ${near ? 'var(--cyan)' : LINE_STRONG}`, background: near ? 'rgba(0,229,255,0.25)' : 'rgba(22,28,58,0.9)', position: 'relative', display: 'inline-block', transition: 'all .15s' }}>
              <span style={{ position: 'absolute', top: 2, left: near ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: near ? 'var(--cyan)' : 'var(--text-dim)', transition: 'all .15s' }} />
            </span>
            近い帯のみ表示
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          {renderDayTabs(viewDay, d => { setViewDay(d); setHoverRun(null) }, viewDots)}
        </div>

        {/* モードフィルタ */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          {modeDefs.map(([k, label]) => {
            const on = mode === k
            return (
              <button key={k} type="button" className="sb-hoverline" aria-pressed={on}
                onClick={() => { setMode(k); setHoverRun(null) }}
                style={{
                  fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', transition: 'all .12s',
                  background: on ? 'linear-gradient(180deg, rgba(0,229,255,0.22), rgba(0,179,255,0.1))' : 'rgba(6,10,22,0.75)',
                  color: on ? '#e9ffff' : 'var(--text-soft)',
                  border: `1px solid ${on ? 'rgba(0,229,255,0.6)' : LINE}`,
                  boxShadow: on ? '0 0 18px rgba(0,229,255,0.2)' : 'none',
                }}>
                {label}
              </button>
            )
          })}
          {showMaps && (
            <>
              <span style={{ width: 1, height: 22, background: LINE_STRONG, margin: '0 4px' }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>マップ数 ({mode === 'ovl' ? formats.ovl : formats.snd}分/マップ)</span>
              {(mode === 'ovl' ? OVL_MAP_OPTIONS : SND_MAP_OPTIONS).map(n => {
                const on = (mode === 'ovl' ? ovlMaps : sndMaps) === n
                return (
                  <button key={n} type="button" className="mono" aria-pressed={on}
                    onClick={() => (mode === 'ovl' ? setOvlMaps(n) : setSndMaps(n))}
                    style={{
                      fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '7px 13px', cursor: 'pointer', transition: 'all .12s',
                      background: on ? 'rgba(139,92,246,0.2)' : 'rgba(6,10,22,0.75)',
                      color: on ? '#c9b8ff' : 'var(--text-dim)',
                      border: `1px solid ${on ? 'rgba(139,92,246,0.55)' : LINE}`,
                    }}>
                    {n}
                  </button>
                )
              })}
            </>
          )}
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-dim)' }}>{modeDurLabel}</span>
        </div>

        {/* 複合モードの構成ビルダー */}
        {mode === 'custom' && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 6px', background: 'rgba(6,10,22,0.5)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, padding: '12px 16px' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#c9b8ff' }}>構成:</span>
            {([
              ['hp', `ハーポ (${formats.hp}分/マップ)`, HP_MAP_OPTIONS],
              ['snd', `サーチ (${formats.snd}分/マップ)`, SND_MAP_OPTIONS],
              ['ovl', `オバロ (${formats.ovl}分/マップ)`, OVL_MAP_OPTIONS],
            ] as ['hp' | 'snd' | 'ovl', string, number[]][]).map(([key, label, options]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{label}</span>
                {[0, ...options].map(n => {
                  const on = combo[key] === n
                  return (
                    <button key={`${key}-${n}`} type="button" className="mono" aria-pressed={on}
                      onClick={() => setCombo(prev => ({ ...prev, [key]: n }))}
                      style={{
                        fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 11px', cursor: 'pointer', transition: 'all .12s',
                        background: on ? 'rgba(0,229,255,0.14)' : 'rgba(6,10,22,0.75)',
                        color: on ? '#9df3ff' : 'var(--text-dim)',
                        border: `1px solid ${on ? 'rgba(0,229,255,0.5)' : LINE}`,
                      }}>
                      {n === 0 ? 'なし' : n}
                    </button>
                  )
                })}
              </div>
            ))}
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: need > 0 ? '#c9b8ff' : 'var(--danger)' }}>
              {need > 0 ? `合計 ${need}枠 (${need * 30}分)` : 'モードを選んでください'}
            </span>
          </div>
        )}

        {/* ボードグリッド */}
        {visibleTeams.length === 0 && boardRooms.length === 0 ? (
          <div className="empty" style={{ marginTop: 16 }}>
            <p className="muted" style={{ marginBottom: 8 }}>{dayLabel(viewDay)} に募集中のチームはまだありません</p>
            <p className="dim" style={{ fontSize: 12 }}>STEP1 で空き時間を入力すると、4人揃った枠が自動でここに公開されます</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '28px 0 4px' }}>
            <div style={{ minWidth: 920, position: 'relative' }}>
              {/* ヘッダ行 */}
              <div style={{ display: 'grid', gridTemplateColumns: '176px repeat(10, minmax(66px, 1fr))', gap: 5, marginBottom: 9 }}>
                <div style={{ position: 'sticky', left: 0, zIndex: 2 }} />
                {SLOTS.map(s => (
                  <div key={s} className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', letterSpacing: '0.02em' }}>{s}</div>
                ))}
              </div>
              {/* チーム行 */}
              {visibleTeams.map(t => {
                const a = countsFor(t.id, viewDay)
                const taken = matchedSet(t.id, viewDay)
                const runList = runs(t.id, viewDay)
                const runAt = (i: number) => runList.find(r => i >= r[0] && i <= r[1])
                const isMe = t.id === teamInfo?.id
                const tier = getTier(dayRating(t.id, viewDay).avg)
                const dimNear = near && !isMe && !inRange(t.id)
                const dimMode = !isMe && !acceptsMode(t.id) && mode !== 'all'
                const hostRangeOut = !isMe && outOfHostRange(t.id)
                let flag = '', flagCl = 'transparent', flagBd = 'transparent'
                if (dimMode) { flag = `${currentModeLabel().split(' ')[0]} 不可`; flagCl = '#ff8fa5'; flagBd = 'rgba(255,77,109,0.4)' }
                else if (hostRangeOut) { flag = '帯範囲外'; flagCl = '#ffb020'; flagBd = 'rgba(255,176,32,0.4)' }
                return (
                  <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '176px repeat(10, minmax(66px, 1fr))', gap: 5, alignItems: 'center', marginBottom: 5, opacity: dimNear || dimMode ? 0.3 : 1, transition: 'opacity .2s' }}>
                    <div style={{ position: 'sticky', left: 0, zIndex: 2, background: 'linear-gradient(90deg, #0a0e20 82%, transparent)', minWidth: 0, padding: '4px 10px 4px 12px', borderLeft: `2px solid ${isMe ? 'var(--amber)' : 'transparent'}`, borderRadius: 2 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.name}{' '}
                        {flag && <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: flagCl, border: `1px solid ${flagBd}`, borderRadius: 3, padding: '0 4px', verticalAlign: 2 }}>{flag}</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: isMe ? 'var(--amber)' : tier.color }}>
                        {tier.label}{isMe ? ' · あなたのチーム' : ''}
                      </div>
                    </div>
                    {a.map((cnt, i) => {
                      const set = taken.has(i)
                      const r = runAt(i)
                      // 自分の側が噛み合う枠か (自チーム4人+未成立 / 参加中ルームの時間内)。自分の行と判定不能時は常にtrue
                      const mutual = isMe ? true : (mySideOk(viewDay, i) ?? true)
                      const mutualRun = (start: number) => Array.from({ length: need }, (_, k) => (isMe ? true : (mySideOk(viewDay, start + k) ?? true))).every(Boolean)
                      const canStart = !!r && mode !== 'all' && need > 0 && i + need - 1 <= r[1] && i + need <= 10 && mutualRun(i)
                      const inRun = !!r
                      const hatch = inRun && mode !== 'all' && !canStart
                      const lit = !!hoverRun && !!r && hoverRun === `${t.id}-${r[0]}`
                      const clickable = !!(teamInfo || myRoomForDay(viewDay)) && !isMe && !dimMode && inRun && mode !== 'all' && need > 0 && mutual
                      const ended = slotEnded(viewDay, i)
                      let bg: string, border: string, numCl: string, text: string, numSize = 15
                      if (set) {
                        bg = 'rgba(255,176,32,0.15)'; border = '1px solid rgba(255,176,32,0.55)'
                        numCl = '#ffd166'; text = '成立'; numSize = 11
                      } else if (ended) {
                        bg = 'rgba(6,9,20,0.9)'; border = '1px solid transparent'
                        numCl = '#333c52'; text = '–'; numSize = 12
                      } else if (cnt >= 4 && !mutual) {
                        // 相手は募集中だが自分の側と噛み合わない枠 → 淡色
                        bg = 'rgba(0,229,255,0.04)'; border = '1px solid rgba(0,229,255,0.12)'
                        numCl = '#55657f'; text = String(cnt); numSize = 12
                      } else if (cnt >= 4) {
                        bg = hatch
                          ? 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,229,255,0.14) 4px 6px), rgba(0,229,255,0.06)'
                          : 'rgba(0,229,255,0.14)'
                        border = '1px solid rgba(0,229,255,0.5)'
                        numCl = '#bff6ff'; text = String(cnt)
                      } else if (cnt > 0) {
                        bg = 'rgba(6,9,20,0.9)'; border = '1px solid transparent'
                        numCl = '#4a5578'; text = String(cnt); numSize = 12
                      } else {
                        bg = 'rgba(6,9,20,0.9)'; border = '1px solid transparent'
                        numCl = '#333c52'; text = '·'; numSize = 12
                      }
                      const click = clickable ? () => {
                        const open = (start: number) => { setModal({ side: 'team', targetId: t.id, day: viewDay, start, len: need }); setModalAs(teamInfo ? 'team' : 'room') }
                        if (canStart) { open(i); return }
                        // 相手の空きに収まり、かつ自分の側とも噛み合う開始位置を探す
                        let s = Math.min(r![1] - need + 1, 10 - need)
                        while (s >= r![0] && !mutualRun(s)) s--
                        if (s >= r![0]) open(s)
                        else showToast(`この空きには ${currentModeLabel()} が入りません`, '相手の空きと自チームの空きが噛み合う連続枠がありません')
                      } : undefined
                      return (
                        <div key={`${t.id}-${i}`}
                          onClick={click}
                          onMouseEnter={inRun && !set ? () => setHoverRun(`${t.id}-${r![0]}`) : undefined}
                          onMouseLeave={() => { if (hoverRun) setHoverRun(null) }}
                          onKeyDown={click ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click() } } : undefined}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          aria-label={clickable ? `${t.name} ${dayLabel(viewDay)} ${slotLabel(i)} の枠を選択` : undefined}
                          style={{
                            position: 'relative', height: 52, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            transition: 'all .12s', background: bg, border, cursor: clickable ? 'pointer' : 'default',
                            boxShadow: lit && !set ? 'inset 0 0 0 1px rgba(0,229,255,0.6), 0 0 12px rgba(0,229,255,0.15)' : 'none',
                          }}>
                          <span className="mono" style={{ fontSize: numSize, lineHeight: 1, color: numCl, letterSpacing: '0.04em' }}>{text}</span>
                          {canStart && !dimMode && !isMe && !!(teamInfo || myRoomForDay(viewDay)) && (
                            <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)', fontSize: 9, textShadow: '0 0 8px rgba(0,229,255,0.8)' }}>▶</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {/* 混成ルーム行 (4人以上・募集中) */}
              {boardRooms.map(r => {
                const ms = roomMembersOf(r.id)
                const isMineRoom = !!myUserId && ms.some(m => m.uid === myUserId)
                const tier = getTier(roomAvg(r.id))
                const gap = roomTierGap(r.id)
                const dimNear = near && !isMineRoom && !(gap == null || gap <= 1)
                const canAct = !!(teamInfo || myRoomForDay(viewDay)) && !isMineRoom && mode !== 'all' && need > 0
                const openModal = (start: number) => { setModal({ side: 'room', targetId: r.id, day: viewDay, start, len: need }); setModalAs(teamInfo ? 'team' : 'room') }
                return (
                  <div key={`room-${r.id}`} style={{ display: 'grid', gridTemplateColumns: '176px repeat(10, minmax(66px, 1fr))', gap: 5, alignItems: 'center', marginBottom: 5, opacity: dimNear ? 0.3 : 1, transition: 'opacity .2s' }}>
                    <div style={{ position: 'sticky', left: 0, zIndex: 2, background: 'linear-gradient(90deg, #0a0e20 82%, transparent)', minWidth: 0, padding: '4px 10px 4px 12px', borderLeft: `2px solid ${isMineRoom ? 'var(--violet)' : 'transparent'}`, borderRadius: 2 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}{' '}
                        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: '#c9b8ff', border: '1px solid rgba(139,92,246,0.45)', borderRadius: 3, padding: '0 4px', verticalAlign: 2 }}>MIXED</span>
                      </div>
                      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: isMineRoom ? 'var(--violet)' : tier.color }}>
                        {tier.label}{isMineRoom ? ' · 参加中' : ''}
                      </div>
                    </div>
                    {SLOTS.map((_, i) => {
                      const ended = slotEnded(viewDay, i)
                      const inWin = i >= r.slot_start && i < r.slot_end && !ended
                      const mutual = isMineRoom ? true : (mySideOk(viewDay, i) ?? true)
                      const mutualRun = (start: number) => Array.from({ length: need }, (_, k) => (isMineRoom ? true : (mySideOk(viewDay, start + k) ?? true))).every(Boolean)
                      const canStart = inWin && mode !== 'all' && need > 0 && i + need <= r.slot_end && i + need <= 10 && mutualRun(i)
                      const hatch = inWin && mode !== 'all' && !canStart
                      const lit = !!hoverRun && hoverRun === `room-${r.id}` && inWin
                      const clickable = canAct && inWin && mutual
                      let bg: string, border: string, numCl: string, text: string, numSize = 15
                      if (inWin && !mutual) {
                        // 募集中だが自分の側と噛み合わない枠 → 淡色
                        bg = 'rgba(139,92,246,0.05)'; border = '1px solid rgba(139,92,246,0.14)'
                        numCl = '#55657f'; text = String(ms.length); numSize = 12
                      } else if (inWin) {
                        bg = hatch
                          ? 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(139,92,246,0.16) 4px 6px), rgba(139,92,246,0.06)'
                          : 'rgba(139,92,246,0.14)'
                        border = '1px solid rgba(139,92,246,0.5)'
                        numCl = '#d9ccff'; text = String(ms.length)
                      } else {
                        bg = 'rgba(6,9,20,0.9)'; border = '1px solid transparent'
                        numCl = '#333c52'; text = '·'; numSize = 12
                      }
                      const click = clickable ? () => {
                        if (canStart) { openModal(i); return }
                        let s = Math.min(r.slot_end - need, 10 - need)
                        while (s >= r.slot_start && (!mutualRun(s) || slotEnded(viewDay, s))) s--
                        if (s >= r.slot_start) openModal(s)
                        else showToast(`この時間帯には ${currentModeLabel()} が入りません`, '相手の時間と自分の側の空きが噛み合う連続枠がありません')
                      } : undefined
                      return (
                        <div key={`room-${r.id}-${i}`}
                          onClick={click}
                          onMouseEnter={inWin ? () => setHoverRun(`room-${r.id}`) : undefined}
                          onMouseLeave={() => { if (hoverRun) setHoverRun(null) }}
                          onKeyDown={click ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click() } } : undefined}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          aria-label={clickable ? `混成ルーム ${r.name} ${dayLabel(viewDay)} ${slotLabel(i)} の枠を選択` : undefined}
                          style={{
                            position: 'relative', height: 52, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            transition: 'all .12s', background: bg, border, cursor: clickable ? 'pointer' : 'default',
                            boxShadow: lit ? 'inset 0 0 0 1px rgba(139,92,246,0.6), 0 0 12px rgba(139,92,246,0.15)' : 'none',
                          }}>
                          <span className="mono" style={{ fontSize: numSize, lineHeight: 1, color: numCl, letterSpacing: '0.04em' }}>{text}</span>
                          {canStart && canAct && (
                            <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--violet)', fontSize: 9, textShadow: '0 0 8px rgba(139,92,246,0.8)' }}>▶</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {/* now ライン (今日のみ・20:00以降) */}
              {nowLine && (
                <div style={{ position: 'absolute', top: -6, bottom: 0, left: nowLine.left, width: 1, background: 'var(--amber)', opacity: 0.85, pointerEvents: 'none', zIndex: 3 }}>
                  <span style={{ position: 'absolute', top: 0, left: -3, width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse-glow 2.4s ease-in-out infinite' }} />
                  <span className="mono" style={{ position: 'absolute', top: -22, left: 0, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--amber)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{nowLine.label}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 凡例 */}
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(0,229,255,0.14)', border: '1px solid rgba(0,229,255,0.5)' }} />4人以上・募集中</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><span style={{ color: 'var(--cyan)', fontSize: 9 }}>▶</span>このモードで開始可</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,229,255,0.22) 3px 5px)', border: '1px solid rgba(0,229,255,0.25)' }} />空きはあるが入りきらない</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.16)' }} />相手は募集中・自チームの空きと不一致</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(255,176,32,0.15)', border: '1px solid rgba(255,176,32,0.55)' }} />成立済み</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(6,9,20,0.9)', border: `1px solid ${LINE}` }} />人数不足</span>
        </div>
      </section>

      {/* ===== 今週の成立 ===== */}
      {matches.length > 0 && (
        <section style={{ position: 'relative', background: 'rgba(18,24,52,0.86)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 14, padding: '22px 24px', backdropFilter: 'blur(14px)', marginBottom: 20, animation: 'slide-up-fade .3s ease both' }}>
          <div className="sec-title" style={{ color: 'var(--amber)' }}>今週の成立</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...matches].sort((x, y) => x.date.localeCompare(y.date) || x.slot_start - y.slot_start).map(mt => {
              const mine = isMyMatch(mt)
              const day = dateToDay(mt.date)
              return (
                <div key={mt.id} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'rgba(6,10,22,0.6)', border: `1px solid ${mine ? 'rgba(255,176,32,0.35)' : LINE}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--amber-soft)', border: '1px solid rgba(255,176,32,0.4)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: 'var(--amber)' }}>VS</div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                      {sideName(mt, 'host')} <span className="muted" style={{ fontWeight: 400 }}>vs</span> {sideName(mt, 'guest')}
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--amber)', letterSpacing: '0.04em' }}>
                      {day >= 0 ? dayLabel(day) : mt.date} {slotLabel(mt.slot_start)} – {slotLabel(mt.slot_end)} · {matchLabel(mt)}
                    </div>
                  </div>
                  <span className="badge success"><span className="badge-dot" />参加メンバーに通知済み</span>
                  {mine && (
                    <>
                      <button type="button" className="btn-primary" onClick={() => router.push(`/custom/board/${mt.id}`)} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>試合ページ・チャット</button>
                      <button type="button" className="btn-danger" onClick={() => setCancelId(mt.id)} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>キャンセル</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ===== 過去の交流戦 (自チーム) ===== */}
      {teamInfo && pastMatches.length > 0 && (
        <section style={{ position: 'relative', background: 'rgba(18,24,52,0.86)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '22px 24px', backdropFilter: 'blur(14px)', marginBottom: 20 }}>
          <div className="sec-title">過去の交流戦</div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 12 }}>
            自チームの過去の対戦です。試合ページで結果・スタッツ・ヒル保持推移を確認できます。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pastMatches.map(mt => {
              const nameOf = (side: 'host' | 'guest') => {
                const tid = side === 'host' ? mt.host_team_id : mt.guest_team_id
                const rid = side === 'host' ? mt.host_room_id : mt.guest_room_id
                if (tid) return pastTeamNames[tid] ?? '解散済みチーム'
                return rid ? '混成ルーム' : '不明'
              }
              return (
                <div key={mt.id} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(6,10,22,0.6)', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 14px' }}>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-soft)', width: 168, flex: 'none' }}>
                    {mt.date} {slotLabel(mt.slot_start)}–{slotLabel(mt.slot_end)}
                  </div>
                  <div style={{ flex: 1, minWidth: 180, fontSize: 13.5, fontWeight: 600 }}>
                    {nameOf('host')} <span className="muted" style={{ fontWeight: 400 }}>vs</span> {nameOf('guest')}
                    <span className="mono muted" style={{ fontSize: 11, marginLeft: 10 }}>{matchLabel(mt)}</span>
                  </div>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => router.push(`/custom/board/${mt.id}`)} style={{ fontSize: 11 }}>
                    試合ページへ
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ===== 成立ダイアログ ===== */}
      {modal && modalTarget && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="対戦の確認">
          <div onClick={() => { if (!confirming) setModal(null) }} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'rgba(22,28,58,0.96)', border: `1px solid ${LINE_STRONG}`, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
                {modalTarget.name}
                {modalIsRoom && <span className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: '#c9b8ff', border: '1px solid rgba(139,92,246,0.45)', borderRadius: 3, padding: '1px 6px', marginLeft: 8, verticalAlign: 4 }}>MIXED</span>}
              </div>
              <div className="mono" style={{ fontSize: 13, color: 'var(--cyan)', letterSpacing: '0.04em', marginTop: 4 }}>{dayLabel(modal.day)} {slotLabel(modal.start)} – {slotLabel(modal.start + modal.len)} · {currentModeLabel()}</div>
            </div>
            <div style={{ padding: '16px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>{modalIsRoom ? '出場帯 (メンバー平均)' : '出場帯 (この時間の平均)'}</span><span style={{ fontWeight: 600, color: getTier(modalSpanRating.avg).color }}>{getTier(modalSpanRating.avg).label}</span></div>
              {!modalIsRoom && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>帯の幅</span><span>{modalSpanRating.min != null && modalSpanRating.max != null ? `${getTier(modalSpanRating.min).label} 〜 ${getTier(modalSpanRating.max).label}` : '—'}</span></div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>{modalIsRoom ? 'メンバー' : 'この時間の人数'}</span><span className="mono">{modalPool} 人</span></div>
              {modalIsRoom ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}>
                  <span style={{ color: 'var(--text-soft)', flex: 'none' }}>参加者</span>
                  <span style={{ textAlign: 'right' }}>{roomMembersOf(modal.targetId).map(m => m.name).join('・')}</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>交流戦実績</span><span>{modalStats.games ? `${modalStats.games} 戦 / キャンセル ${modalStats.cancels}` : 'なし (新規チーム)'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}>
                    <span style={{ color: 'var(--text-soft)' }}>受付モード</span>
                    <span>{([['hp', 'ハーポ'], ['snd', 'サーチ'], ['ovl', 'オバロ']] as ['hp' | 'snd' | 'ovl', string][]).filter(([k]) => modalPrefs[k]).map(([, l]) => l).join('・') || 'なし'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}>
                    <span style={{ color: 'var(--text-soft)' }}>受付範囲</span>
                    <span>{modalPrefs.range === 'similar' ? '同格 ±1帯' : '誰でも歓迎'}</span>
                  </div>
                  {modalPrefs.contact && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}>
                      <span style={{ color: 'var(--text-soft)' }}>公開連絡先</span>
                      <span style={{ wordBreak: 'break-all', textAlign: 'right' }}>{modalPrefs.contact}</span>
                    </div>
                  )}
                </>
              )}
              {/* 自分の立場: チームとルームの両方を持つ場合に選択 */}
              {teamInfo && modalMyRoom && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'rgba(6,10,22,0.5)', border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', marginTop: 12 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>出る側:</span>
                  {([['team', teamInfo.name], ['room', `${modalMyRoom.name}【混成】`]] as ['team' | 'room', string][]).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={modalAs === k}
                      onClick={() => setModalAs(k)}
                      style={{
                        fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', transition: 'all .12s',
                        background: modalAs === k ? 'rgba(139,92,246,0.18)' : 'rgba(6,10,22,0.6)',
                        color: modalAs === k ? '#c9b8ff' : 'var(--text-dim)',
                        border: `1px solid ${modalAs === k ? 'rgba(139,92,246,0.5)' : LINE}`,
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {modal && !modalIsRoom && outOfHostRange(modal.targetId) && (
                <div style={{ display: 'flex', gap: 9, background: 'rgba(255,176,32,0.12)', border: '1px solid rgba(255,176,32,0.4)', borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 12, color: '#ffe2ae', lineHeight: 1.6 }}>
                  <span>▲</span>
                  <span>相手の受付範囲 (同格±1帯) の外です。成立は可能ですが、相手の想定と異なる可能性があります。</span>
                </div>
              )}
              <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>成立と同時に参加メンバーへ通知が送られ (チームはDiscord・混成ルームはサイト内通知)、試合ページ(チャット)が開きます。ホスト決め・ロビーコード共有はそこで行います。この対戦は unrated — レートは変動しません。対戦は <a href="/rules" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'underline', textUnderlineOffset: 2 }}>GAルール</a> に準拠します(新しいタブで開きます)。</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.18)' }}>
              <button type="button" className="btn-ghost" onClick={() => setModal(null)} disabled={confirming}>閉じる</button>
              <button type="button" className="btn-primary" onClick={() => void confirmMatch()} disabled={confirming}>{confirming ? '成立処理中...' : 'この枠で対戦する'}</button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* ===== キャンセル確認 ===== */}
      {cancelMatch && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="キャンセル確認">
          <div onClick={() => { if (!cancelling) setCancelId(null) }} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', padding: 22 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>対戦をキャンセルしますか?</div>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.7 }}>
              {cancelOppName} との {dateToDay(cancelMatch.date) >= 0 ? dayLabel(dateToDay(cancelMatch.date)) : cancelMatch.date} {slotLabel(cancelMatch.slot_start)} – {slotLabel(cancelMatch.slot_end)} の対戦を取り消します。相手の参加メンバーにキャンセル通知が送られ、枠はボードに戻ります。
            </p>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>キャンセル回数は相手チームから見えるようになります。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="btn-ghost" onClick={() => setCancelId(null)} disabled={cancelling}>戻る</button>
              <button type="button" className="btn-danger" onClick={() => void doCancel()} disabled={cancelling}>{cancelling ? 'キャンセル中...' : 'キャンセルする'}</button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* ===== 混成ルーム作成ダイアログ ===== */}
      {roomCreateOpen && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="混成ルームの作成">
          <div onClick={() => { if (!roomBusy) setRoomCreateOpen(false) }} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'rgba(22,28,58,0.96)', border: `1px solid ${LINE_STRONG}`, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>混成ルームを作る</div>
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>チーム所属・無所属を問わず誰でも参加できます。4人集まるとボードに掲載されます。</div>
            </div>
            <div style={{ padding: '18px 22px' }}>
              <label htmlFor="mr-name" className="stat-label" style={{ display: 'block', marginBottom: 6 }}>ルーム名</label>
              <input id="mr-name" value={roomName} onChange={e => setRoomName(e.target.value)} maxLength={30}
                placeholder="例: 金曜ミックス" style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '10px 14px' }} />

              <label className="stat-label" style={{ display: 'block', margin: '14px 0 6px' }}>日付</label>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {weekDays.map((wd, i) => {
                  const on = roomDay === i
                  return (
                    <button key={i} type="button" className="mono sb-hoverline" aria-pressed={on} onClick={() => setRoomDay(i)}
                      style={{
                        fontSize: 11.5, fontWeight: on ? 700 : 600, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', transition: 'all .12s',
                        background: on ? 'rgba(139,92,246,0.18)' : 'rgba(6,10,22,0.75)',
                        color: on ? '#c9b8ff' : 'var(--text-dim)',
                        border: `1px solid ${on ? 'rgba(139,92,246,0.5)' : LINE}`,
                      }}>
                      {i === 0 ? `今日 ${wd.label}` : wd.label}
                    </button>
                  )
                })}
              </div>

              <label className="stat-label" style={{ display: 'block', margin: '14px 0 6px' }}>参加できる時間帯</label>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <select value={roomStart} onChange={e => setRoomStart(Number(e.target.value))} style={{ width: 110 }}>
                  {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{slotLabel(i)}</option>)}
                </select>
                <span className="muted">〜</span>
                <select value={roomEnd} onChange={e => setRoomEnd(Number(e.target.value))} style={{ width: 110 }}>
                  {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{slotLabel(i + 1)}</option>)}
                </select>
              </div>

              <label htmlFor="mr-note" className="stat-label" style={{ display: 'block', margin: '14px 0 6px' }}>ひとこと (任意)</label>
              <input id="mr-note" value={roomNote} onChange={e => setRoomNote(e.target.value)} maxLength={200}
                placeholder="例: エンジョイ勢歓迎 / サーチ中心希望" style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '10px 14px' }} />

              <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                1ルーム = 1対戦です。成立するとルームは募集終了になり、キャンセルされると募集中に戻ります。ホストが抜けるとルームは解散されます。
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.18)' }}>
              <button type="button" className="btn-ghost" onClick={() => setRoomCreateOpen(false)} disabled={roomBusy}>閉じる</button>
              <button type="button" className="btn-primary" onClick={() => void roomCreate()} disabled={roomBusy}>{roomBusy ? '作成中...' : 'ルームを作成'}</button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* ===== 通知設定ダイアログ ===== */}
      {webhookOpen && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="Discord 通知設定">
          <div onClick={() => setWebhookOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 460, background: 'rgba(22,28,58,0.96)', border: `1px solid ${LINE_STRONG}`, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>チーム設定（通知・連絡先）</div>
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>{teamInfo?.name ?? 'あなたのチーム'}</div>
            </div>
            <div style={{ padding: '18px 22px' }}>
              <label htmlFor="sb-webhook" className="stat-label" style={{ display: 'block', marginBottom: 8 }}>Webhook URL</label>
              <input id="sb-webhook" value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); setWhTested(false); setWhError(null) }}
                placeholder="https://discord.com/api/webhooks/…" spellCheck={false}
                className="mono" style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '11px 14px' }} />
              <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                サーバー設定 → 連携サービス → ウェブフック から発行した URL を貼り付けてください。成立・キャンセルの通知がこのチャンネルに届きます。
                {teamInfo && !teamInfo.isOwner && ' チーム設定への保存はオーナーのみ可能です（あなたの場合はこの端末に保存されます）。'}
              </p>
              {whError && (
                <div style={{ display: 'flex', gap: 8, background: 'rgba(255,77,109,0.13)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 12, color: '#ffd7de', lineHeight: 1.6 }}>
                  <span>▲</span><span>{whError}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, background: 'rgba(6,10,22,0.6)', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: whTested ? 'var(--success)' : 'var(--amber)', boxShadow: `0 0 10px ${whTested ? 'var(--success)' : 'var(--amber)'}`, flex: 'none' }} />
                <span style={{ fontSize: 12, color: 'var(--text-soft)', flex: 1 }}>{whTested ? '接続確認済み — テスト通知の送信に成功しました' : '未テスト — テスト送信で接続を確認してください'}</span>
                <button type="button" onClick={() => void testWebhook()} disabled={whBusy || !webhookUrl.trim()}
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 12px' }}>
                  {whBusy ? '送信中...' : 'テスト送信'}
                </button>
              </div>

              {teamInfo && (
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
                  <label htmlFor="sb-contact" className="stat-label" style={{ display: 'block', marginBottom: 8 }}>公開連絡先（任意）</label>
                  <input id="sb-contact" value={contactInput} onChange={e => setContactInput(e.target.value)}
                    placeholder="例: Discordサーバー https://discord.gg/xxxx"
                    maxLength={200}
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '11px 14px' }} />
                  <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                    <span style={{ color: 'var(--amber)' }}>全チームに公開されます。</span>個人の Discord ID ではなく、チームのサーバー招待リンクや連絡用アカウントを推奨します。
                    未設定でも、成立後は試合ページのチャットで連絡できます。
                  </p>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.18)' }}>
              <button type="button" className="btn-ghost" onClick={() => setWebhookOpen(false)} disabled={whBusy}>閉じる</button>
              <button type="button" className="btn-primary" onClick={() => void saveWebhook()} disabled={whBusy}>{whBusy ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* ===== トースト ===== */}
      {toast && (
        <BodyPortal>
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 32, transform: 'translateX(-50%)', zIndex: 3000, display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(0,229,255,0.35)', borderRadius: 10, color: 'var(--text)', boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 24px rgba(0,229,255,0.12)', animation: 'slide-up-fade .2s ease both', minWidth: 260, maxWidth: 'min(92vw, 560px)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan)', flex: 'none' }} />
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{toast.title}</div>
            {toast.sub && <div style={{ fontSize: 11.5, color: 'var(--text-soft)', marginTop: 1 }}>{toast.sub}</div>}
          </div>
        </div>
        </BodyPortal>
      )}

      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn-ghost btn-sm" onClick={() => router.push('/custom')}>カスタムに戻る</button>
      </div>
    </main>
  )
}
