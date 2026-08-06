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
type PrefsRow = { hp: boolean; snd: boolean; ovl: boolean }
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

// マップ数 → 30分枠数への換算 (ハーポ 15分/マップ、サーチ 20分/マップ、オバロ 15分/マップ)
// ※ サーバー側 (rpc_scrimboard_confirm) にも同じ計算があり、そちらが正
const hpSlots = (maps: number) => Math.ceil((15 * maps) / 30)
const sndSlots = (maps: number) => Math.ceil((20 * maps) / 30)
const ovlSlots = (maps: number) => Math.ceil((15 * maps) / 30)
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
const TPL_DAYS_KEY = 'sb-tpl-days'
const TPL_SLOTS_KEY = 'sb-tpl-slots'

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
  const [rosterNames, setRosterNames] = useState<string[]>([])

  // ボードデータ
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [counts, setCounts] = useState<Record<string, number[]>>({}) // key: `${teamId}|${date}`
  const [prefsMap, setPrefsMap] = useState<Record<string, PrefsRow>>({})
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamStats, setTeamStats] = useState<Record<string, { games: number; cancels: number }>>({})
  const [myMine, setMyMine] = useState<Record<string, number[]>>({}) // date -> 自分の選択スロット

  // UI 状態
  const [editDay, setEditDay] = useState(0)
  const [viewDay, setViewDay] = useState(0)
  const [mode, setMode] = useState<Mode>('hp')
  const [sndMaps, setSndMaps] = useState(3)
  const [ovlMaps, setOvlMaps] = useState(3)
  const [combo, setCombo] = useState<{ hp: number; snd: number; ovl: number }>({ hp: 0, snd: 2, ovl: 2 })
  const [near, setNear] = useState(false)
  const [hoverRun, setHoverRun] = useState<string | null>(null)
  const [modal, setModal] = useState<{ teamId: string; day: number; start: number; len: number } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [tplDays, setTplDays] = useState<boolean[]>(Array(7).fill(false))
  const [tplSlots, setTplSlots] = useState<number[] | null>(null)
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [whTested, setWhTested] = useState(false)
  const [whBusy, setWhBusy] = useState(false)
  const [whError, setWhError] = useState<string | null>(null)
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

  const dayLabel = (d: number) => (weekDays[d] ? (d === 0 ? `今日 ${weekDays[d].label}` : weekDays[d].label) : d === 0 ? '今日' : `${d}日後`)
  const dateToDay = (dateStr: string) => weekDateStrs().indexOf(dateStr)

  // ---- データ読み込み ----
  const loadBoard = useCallback(async () => {
    const dates = weekDateStrs()
    const [{ data: countRows, error: cErr }, { data: prefRows }, { data: matchRows }, { data: allMatches }] = await Promise.all([
      supabase.from('scrim_slot_counts').select('team_id, date, slot_index, available').in('date', dates),
      supabase.from('scrim_team_prefs').select('team_id, accept_hp, accept_snd, accept_ovl'),
      supabase.from('scrim_matches').select('*').in('date', dates).eq('status', 'confirmed'),
      supabase.from('scrim_matches').select('host_team_id, guest_team_id, status'),
    ])
    if (cErr) { console.error('scrim_slot_counts error:', cErr); return }

    const cm: Record<string, number[]> = {}
    for (const r of (countRows ?? []) as { team_id: string; date: string; slot_index: number; available: number }[]) {
      const key = `${r.team_id}|${r.date}`
      if (!cm[key]) cm[key] = Array(10).fill(0)
      cm[key][r.slot_index] = r.available
    }
    setCounts(cm)

    const pm: Record<string, PrefsRow> = {}
    for (const r of (prefRows ?? []) as { team_id: string; accept_hp: boolean; accept_snd: boolean; accept_ovl: boolean }[]) {
      pm[r.team_id] = { hp: r.accept_hp, snd: r.accept_snd, ovl: r.accept_ovl }
    }
    setPrefsMap(pm)

    const mrows = (matchRows ?? []) as MatchRow[]
    setMatches(mrows)

    const stats: Record<string, { games: number; cancels: number }> = {}
    for (const m of (allMatches ?? []) as { host_team_id: string; guest_team_id: string; status: string }[]) {
      for (const tid of [m.host_team_id, m.guest_team_id]) {
        if (!stats[tid]) stats[tid] = { games: 0, cancels: 0 }
        if (m.status === 'confirmed' || m.status === 'completed') stats[tid].games++
        if (m.status === 'cancelled') stats[tid].cancels++
      }
    }
    setTeamStats(stats)

    // 表示対象チーム: 週内に空きがある or 成立に関与 or 自チーム
    const ids = new Set<string>()
    Object.keys(cm).forEach(k => ids.add(k.split('|')[0]))
    mrows.forEach(m => { ids.add(m.host_team_id); ids.add(m.guest_team_id) })
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

  // 初期化
  useEffect(() => {
    const init = async () => {
      try {
        // 曜日テンプレ (この端末に保存)
        try {
          const td = localStorage.getItem(TPL_DAYS_KEY)
          const ts = localStorage.getItem(TPL_SLOTS_KEY)
          if (td) setTplDays(JSON.parse(td))
          if (ts) setTplSlots(JSON.parse(ts))
        } catch { /* 破損時は無視 */ }

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
            setRosterNames(names.filter(n => n.uid !== uid).map(n => n.name))
            const savedWh = (st as { discord_webhook_url: string | null } | null)?.discord_webhook_url
            if (savedWh) { setWebhookUrl(savedWh); setWhTested(true) }
            else { try { const l = localStorage.getItem(WH_LOCAL_KEY); if (l) setWebhookUrl(l) } catch { /* noop */ } }
          } else {
            try { const l = localStorage.getItem(WH_LOCAL_KEY); if (l) setWebhookUrl(l) } catch { /* noop */ }
          }
          await loadMine(uid)
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
  }, [loadBoard, loadMine])

  // Realtime: 成立の変化は全体購読、自チームの空きはチーム単位で購読
  useEffect(() => {
    const ch = supabase.channel('scrim-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrim_matches' }, () => void loadBoard())
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
    if (mode === 'hp') return 3 // ハーポ回し (6マップ×15分 = 90分)
    if (mode === 'snd') return sndSlots(sndMaps)
    if (mode === 'ovl') return ovlSlots(ovlMaps)
    if (mode === 'custom') return hpSlots(combo.hp) + sndSlots(combo.snd) + ovlSlots(combo.ovl)
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
  const runs = (teamId: string, day: number) => {
    const a = countsFor(teamId, day)
    const taken = matchedSet(teamId, day)
    const out: [number, number][] = []
    let s = -1
    for (let i = 0; i <= 10; i++) {
      const ok = i < 10 && a[i] >= 4 && !taken.has(i)
      if (ok && s < 0) s = i
      if (!ok && s >= 0) { out.push([s, i - 1]); s = -1 }
    }
    return out
  }
  const prefsFor = (teamId: string): PrefsRow => prefsMap[teamId] ?? { hp: true, snd: true, ovl: true }
  const acceptsMode = (teamId: string) => {
    if (mode === 'all') return true
    const p = prefsFor(teamId)
    const m = currentMaps()
    if (m.hp > 0 && !p.hp) return false
    if (m.snd > 0 && !p.snd) return false
    if (m.ovl > 0 && !p.ovl) return false
    return true
  }
  const myTier = getTier(teams.find(t => t.id === teamInfo?.id)?.rating ?? null)
  const inRange = (t: TeamRow) => Math.abs(getTier(t.rating).idx - myTier.idx) <= 1

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
    if (saveTimersRef.current[dateStr]) clearTimeout(saveTimersRef.current[dateStr])
    saveTimersRef.current[dateStr] = setTimeout(async () => {
      const { error } = await supabase.rpc('rpc_scrimboard_set_availability', { p_date: dateStr, p_slots: slots })
      if (error) {
        showToast('空き時間の保存に失敗しました', error.message)
        if (myUserId) void loadMine(myUserId)
        void loadBoard()
      }
    }, 600)
  }, [myUserId, loadMine, loadBoard])

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
  const myPrefs = teamInfo ? prefsFor(teamInfo.id) : { hp: true, snd: true, ovl: true }
  const togglePref = async (k: keyof PrefsRow) => {
    if (!teamInfo) return
    const next = { ...myPrefs, [k]: !myPrefs[k] }
    setPrefsMap(prev => ({ ...prev, [teamInfo.id]: next }))
    const { error } = await supabase.from('scrim_team_prefs').upsert({
      team_id: teamInfo.id,
      accept_hp: next.hp,
      accept_snd: next.snd,
      accept_ovl: next.ovl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'team_id' })
    if (error) {
      showToast('受付モードの保存に失敗しました', error.message)
      void loadBoard()
    }
  }

  // ---- 成立 / キャンセル ----
  const confirmMatch = async () => {
    if (!modal || confirming) return
    const dateStr = weekDays[modal.day]?.dateStr
    if (!dateStr) return
    const m = currentMaps()
    setConfirming(true)
    const { error } = await supabase.rpc('rpc_scrimboard_confirm', {
      p_host_team_id: modal.teamId,
      p_date: dateStr,
      p_slot_start: modal.start,
      p_hp_maps: m.hp,
      p_snd_maps: m.snd,
      p_ovl_maps: m.ovl,
    })
    setConfirming(false)
    if (error) {
      showToast('成立できませんでした', error.message)
      setModal(null)
      void loadBoard()
      return
    }
    const t = teams.find(x => x.id === modal.teamId)
    setModal(null)
    showToast('対戦が成立しました', `${t?.name ?? '相手チーム'} · ${dayLabel(modal.day)} ${slotLabel(modal.start)} – ${slotLabel(modal.start + modal.len)} · 両チームの Discord に通知しました`)
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

  // ---- 曜日テンプレ (この端末に保存) ----
  const tplHas = !!tplSlots
  const tplDayNames = DOW.filter((_, i) => tplDays[i]).join('・')
  const tplStatus = !tplHas ? '未設定' : `保存済み (${tplSlots!.length}枠) — ${tplDayNames || '曜日未選択'}`
  const saveTplState = (days: boolean[], slots: number[] | null) => {
    try {
      localStorage.setItem(TPL_DAYS_KEY, JSON.stringify(days))
      if (slots) localStorage.setItem(TPL_SLOTS_KEY, JSON.stringify(slots))
      else localStorage.removeItem(TPL_SLOTS_KEY)
    } catch { /* noop */ }
  }
  const tplSave = () => {
    const dateStr = weekDays[editDay]?.dateStr
    const slots = dateStr ? (myMine[dateStr] ?? []) : []
    if (slots.length === 0) { showToast('空き時間が選ばれていません', '先に上のチップで時間を選んでから保存してください'); return }
    setTplSlots(slots)
    saveTplState(tplDays, slots)
    showToast('曜日テンプレを保存しました', `${slots.length}枠 — 曜日を選んで「対象曜日に反映」を押してください`)
  }
  const tplApply = () => {
    if (!tplSlots || !teamInfo) return
    const targets = weekDays.map((wd, i) => (tplDays[wd.dow] ? i : -1)).filter(i => i >= 0)
    if (targets.length === 0) { showToast('対象の曜日が選ばれていません', '先に曜日チップで反映したい曜日を選んでください'); return }
    for (const d of targets) {
      const dateStr = weekDays[d].dateStr
      setMyMine(prev => ({ ...prev, [dateStr]: tplSlots.slice() }))
      persistDay(dateStr, tplSlots.slice())
    }
    showToast('テンプレを反映しました', `${targets.map(d => dayLabel(d)).join('・')} に ${tplSlots.length}枠を入力しました`)
  }
  const tplToggleDay = (i: number) => {
    setTplDays(prev => { const d = prev.slice(); d[i] = !d[i]; saveTplState(d, tplSlots); return d })
  }
  const tplClear = () => { setTplSlots(null); saveTplState(tplDays, null); showToast('曜日テンプレを削除しました', '') }

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
        showToast('通知設定を保存しました', teamInfo ? 'チーム設定の保存はオーナーのみのため、この端末にのみ保存されました' : 'この端末に保存されました（チーム所属時はチーム全体に共有されます）')
      }
      setWebhookOpen(false)
    } finally { setWhBusy(false) }
  }

  // ---- モーダル用導出値 ----
  const modalTeam = modal ? teams.find(x => x.id === modal.teamId) ?? null : null
  const modalPool = modal && modalTeam ? Math.min(...countsFor(modalTeam.id, modal.day).slice(modal.start, modal.start + modal.len)) : 0
  const modalStats = modalTeam ? teamStats[modalTeam.id] ?? { games: 0, cancels: 0 } : { games: 0, cancels: 0 }
  const modalPrefs = modalTeam ? prefsFor(modalTeam.id) : { hp: true, snd: true, ovl: true }

  const cancelMatch = cancelId !== null ? matches.find(x => x.id === cancelId) ?? null : null
  const cancelOppName = cancelMatch
    ? (teams.find(t => t.id === (cancelMatch.host_team_id === teamInfo?.id ? cancelMatch.guest_team_id : cancelMatch.host_team_id))?.name ?? '相手チーム')
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
            <span className="badge"><span className="badge-dot" />BLACK OPS 7 · 4v4</span>
            <span className="badge violet">UNRATED — レート変動なし</span>
          </div>
          <button type="button" className="btn-ghost" onClick={() => setWebhookOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.6" /></svg>
            通知設定
          </button>
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
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>表示中の日の空き時間を保存し、選んだ曜日へ一括反映できます</span>
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: tplHas ? '#9df3ff' : 'var(--text-dim)' }}>{tplStatus}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {DOW.map((label, i) => {
                  const on = tplDays[i]
                  return (
                    <button key={label} type="button" className="sb-hoverline" aria-pressed={on}
                      onClick={() => tplToggleDay(i)}
                      style={{
                        width: 34, height: 34, padding: 0, fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', transition: 'all .12s',
                        background: on ? 'rgba(0,229,255,0.14)' : 'rgba(6,10,22,0.75)',
                        color: on ? '#9df3ff' : 'var(--text-dim)',
                        border: `1px solid ${on ? 'rgba(0,229,255,0.5)' : LINE}`,
                      }}>
                      {label}
                    </button>
                  )
                })}
              </div>
              <button type="button" onClick={tplSave} style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px' }}>{dayLabel(editDay)}の選択をテンプレに保存</button>
              {tplHas && (
                <>
                  <button type="button" className="btn-ghost" onClick={tplApply} style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px' }}>テンプレを対象曜日に反映</button>
                  <button type="button" className="sb-link" onClick={tplClear}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 11.5, padding: '8px 6px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                    削除
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ロスター + 受付モード */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="stat-label">{teamInfo.name}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--amber-soft)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 6, padding: '3px 9px' }}>あなた</span>
              {rosterNames.map(n => (
                <span key={n} className="mono" style={{ fontSize: 11, color: 'var(--text-soft)', background: 'rgba(6,10,22,0.75)', border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 9px' }}>{n}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>受けられるモード:</span>
              {([['hp', 'ハーポ'], ['snd', 'サーチ'], ['ovl', 'オバロ']] as [keyof PrefsRow, string][]).map(([k, label]) => {
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
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>ボードの閲覧は誰でもできます。対戦を組むには4人以上のチームが必要です。</p>
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
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>マップ数 ({mode === 'ovl' ? '15' : '20'}分/マップ)</span>
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
              ['hp', 'ハーポ (15分/マップ)', HP_MAP_OPTIONS],
              ['snd', 'サーチ (20分/マップ)', SND_MAP_OPTIONS],
              ['ovl', 'オバロ (15分/マップ)', OVL_MAP_OPTIONS],
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
        {visibleTeams.length === 0 ? (
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
                const tier = getTier(t.rating)
                const dimNear = near && !isMe && !inRange(t)
                const dimMode = !isMe && !acceptsMode(t.id) && mode !== 'all'
                let flag = '', flagCl = 'transparent', flagBd = 'transparent'
                if (dimMode) { flag = `${currentModeLabel().split(' ')[0]} 不可`; flagCl = '#ff8fa5'; flagBd = 'rgba(255,77,109,0.4)' }
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
                      const canStart = !!r && mode !== 'all' && need > 0 && i + need - 1 <= r[1] && i + need <= 10
                      const inRun = !!r
                      const hatch = inRun && mode !== 'all' && !canStart
                      const lit = !!hoverRun && !!r && hoverRun === `${t.id}-${r[0]}`
                      const clickable = !!teamInfo && !isMe && !dimMode && inRun && mode !== 'all' && need > 0
                      let bg: string, border: string, numCl: string, text: string, numSize = 15
                      if (set) {
                        bg = 'rgba(255,176,32,0.15)'; border = '1px solid rgba(255,176,32,0.55)'
                        numCl = '#ffd166'; text = '成立'; numSize = 11
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
                        if (canStart) { setModal({ teamId: t.id, day: viewDay, start: i, len: need }); return }
                        const snap = Math.min(r![1] - need + 1, 10 - need)
                        if (snap >= r![0]) setModal({ teamId: t.id, day: viewDay, start: snap, len: need })
                        else showToast(`この空きには ${currentModeLabel()} が入りません`, `空きが ${r![1] - r![0] + 1}枠 (${(r![1] - r![0] + 1) * 30}分) しかありません`)
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
                          {canStart && !dimMode && !isMe && !!teamInfo && (
                            <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)', fontSize: 9, textShadow: '0 0 8px rgba(0,229,255,0.8)' }}>▶</span>
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
              const host = teams.find(x => x.id === mt.host_team_id)
              const guest = teams.find(x => x.id === mt.guest_team_id)
              const mine = teamInfo && (mt.host_team_id === teamInfo.id || mt.guest_team_id === teamInfo.id)
              const day = dateToDay(mt.date)
              return (
                <div key={mt.id} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'rgba(6,10,22,0.6)', border: `1px solid ${mine ? 'rgba(255,176,32,0.35)' : LINE}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--amber-soft)', border: '1px solid rgba(255,176,32,0.4)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: 'var(--amber)' }}>VS</div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                      {host?.name ?? '不明'} <span className="muted" style={{ fontWeight: 400 }}>vs</span> {guest?.name ?? '不明'}
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--amber)', letterSpacing: '0.04em' }}>
                      {day >= 0 ? dayLabel(day) : mt.date} {slotLabel(mt.slot_start)} – {slotLabel(mt.slot_end)} · {matchLabel(mt)}
                    </div>
                  </div>
                  <span className="badge success"><span className="badge-dot" />Discord 通知済み</span>
                  {mine && (
                    <button type="button" className="btn-danger" onClick={() => setCancelId(mt.id)} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>キャンセル</button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ===== 成立ダイアログ ===== */}
      {modal && modalTeam && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="対戦の確認">
          <div onClick={() => { if (!confirming) setModal(null) }} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'rgba(22,28,58,0.96)', border: `1px solid ${LINE_STRONG}`, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{modalTeam.name}</div>
              <div className="mono" style={{ fontSize: 13, color: 'var(--cyan)', letterSpacing: '0.04em', marginTop: 4 }}>{dayLabel(modal.day)} {slotLabel(modal.start)} – {slotLabel(modal.start + modal.len)} · {currentModeLabel()}</div>
            </div>
            <div style={{ padding: '16px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>ティア</span><span style={{ fontWeight: 600, color: getTier(modalTeam.rating).color }}>{getTier(modalTeam.rating).label}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>この時間の人数</span><span className="mono">{modalPool} 人</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>交流戦実績</span><span>{modalStats.games ? `${modalStats.games} 戦 / キャンセル ${modalStats.cancels}` : 'なし (新規チーム)'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}>
                <span style={{ color: 'var(--text-soft)' }}>受付モード</span>
                <span>{([['hp', 'ハーポ'], ['snd', 'サーチ'], ['ovl', 'オバロ']] as [keyof PrefsRow, string][]).filter(([k]) => modalPrefs[k]).map(([, l]) => l).join('・') || 'なし'}</span>
              </div>
              <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>成立と同時に両チームの Discord へ通知が送られます。この対戦は unrated — レートは変動しません。</p>
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
              {cancelOppName} との {dateToDay(cancelMatch.date) >= 0 ? dayLabel(dateToDay(cancelMatch.date)) : cancelMatch.date} {slotLabel(cancelMatch.slot_start)} – {slotLabel(cancelMatch.slot_end)} の対戦を取り消します。相手チームの Discord にキャンセル通知が送られ、枠はボードに戻ります。
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

      {/* ===== 通知設定ダイアログ ===== */}
      {webhookOpen && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="Discord 通知設定">
          <div onClick={() => setWebhookOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 460, background: 'rgba(22,28,58,0.96)', border: `1px solid ${LINE_STRONG}`, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>Discord 通知設定</div>
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>{teamInfo?.name ?? 'あなたのチーム'} · チームの通知先チャンネル</div>
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
