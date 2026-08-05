'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

// ============================================================
// 交流戦ボード (Scrim Board) — チームの空き時間を出し合い、
// 相手チームの空き枠を選んでその場で対戦を確定するボード。
// 現在はプレビュー版: 相手チーム・ロスターはデモデータ。
// ============================================================

type Mode = 'hp' | 'snd' | 'ovl' | 'all'
type Pref = 'hp' | 'snd' | 'ovl'

type DemoTeam = {
  id: string
  name: string
  tag: string
  tier: string
  span: string
  games: number
  ns: number
  accept: 'similar' | 'any'
  unr: boolean
  prefs: Record<Pref, boolean>
  av: number[] | null
}

type BoardMatch = { id: number; teamId: string; start: number; len: number; mode: Mode; maps: number }

const SLOTS = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '24:00', '24:30']
const slotLabel = (i: number) => `${20 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`

const TIER_COLORS: Record<string, string> = {
  BRONZE: '#b87333', SILVER: '#c0c7d8', GOLD: '#ffd166', PLATINUM: '#7ae1ff',
  DIAMOND: '#b5a8ff', CRIMSON: '#ff2244', ASCENDANT: '#ff2bd6', 未計測: '#7b84a6',
}
const TIER_IDX: Record<string, number> = { 未計測: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, DIAMOND: 5, CRIMSON: 6, ASCENDANT: 8 }
const MY_TIER = 'PLATINUM'

const OTHERS = [
  { n: 'canon_taka', s: [0, 1, 1, 1, 1, 1, 0, 0, 0, 0] },
  { n: 'REN', s: [0, 0, 1, 1, 1, 0, 0, 0, 1, 1] },
  { n: 'shiba', s: [0, 0, 1, 1, 1, 1, 1, 0, 0, 0] },
  { n: 'yuki', s: [0, 0, 1, 0, 1, 1, 1, 1, 1, 0] },
  { n: 'KAI', s: [0, 0, 1, 1, 0, 0, 0, 0, 1, 1] },
  { n: 'tora', s: [0, 0, 0, 1, 1, 0, 0, 0, 1, 0] },
]

const TEAMS: DemoTeam[] = [
  { id: 'me', name: 'Kunitachi FC', tag: 'KNT', tier: 'PLATINUM', span: 'GOLD 〜 DIAMOND', games: 12, ns: 0, accept: 'similar', unr: true, prefs: { hp: true, snd: true, ovl: true }, av: null },
  { id: 't1', name: 'Zeta Riders', tag: 'ZTR', tier: 'DIAMOND', span: 'PLATINUM 〜 CRIMSON', games: 24, ns: 1, accept: 'similar', unr: false, prefs: { hp: true, snd: true, ovl: true }, av: [0, 4, 5, 6, 6, 5, 0, 0, 0, 0] },
  { id: 't2', name: 'Nocturne', tag: 'NCT', tier: 'GOLD', span: 'GOLD 〜 DIAMOND', games: 18, ns: 0, accept: 'similar', unr: true, prefs: { hp: true, snd: false, ovl: true }, av: [0, 0, 0, 7, 7, 6, 5, 4, 4, 0] },
  { id: 't3', name: 'Aoyama Pulse', tag: 'AOP', tier: 'SILVER', span: 'SILVER 〜 PLATINUM', games: 9, ns: 2, accept: 'any', unr: true, prefs: { hp: true, snd: true, ovl: true }, av: [4, 4, 0, 0, 4, 5, 5, 0, 0, 0] },
  { id: 't4', name: 'Meridian', tag: 'MRD', tier: 'CRIMSON', span: 'DIAMOND 〜 ASCENDANT', games: 41, ns: 0, accept: 'similar', unr: false, prefs: { hp: true, snd: true, ovl: false }, av: [0, 0, 6, 6, 6, 6, 4, 4, 0, 0] },
  { id: 't5', name: '立川 Vanguard', tag: 'TCV', tier: '未計測', span: '—', games: 0, ns: 0, accept: 'any', unr: true, prefs: { hp: true, snd: true, ovl: true }, av: [0, 0, 4, 4, 4, 4, 0, 0, 0, 0] },
  { id: 't6', name: 'Frostbite', tag: 'FRB', tier: 'PLATINUM', span: 'GOLD 〜 DIAMOND', games: 15, ns: 0, accept: 'any', unr: true, prefs: { hp: true, snd: true, ovl: true }, av: [0, 0, 0, 0, 0, 5, 5, 6, 6, 5] },
]

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function modeName(m: Mode, maps: number) {
  return m === 'hp' ? 'ハーポ回し' : m === 'snd' ? `サーチ ${maps}マップ` : m === 'ovl' ? `オバロ ${maps}マップ` : 'すべて'
}

const LINE = 'rgba(140,160,220,0.12)'
const LINE_STRONG = 'rgba(140,160,220,0.28)'

// AppShell の .page-transition (animation fill: both) が transform を持ち続けるため、
// ページ内の position:fixed はビューポート基準にならない。
// ダイアログ・トーストは body 直下へポータルで逃がす。
function BodyPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}

export default function ScrimBoardPage() {
  const router = useRouter()

  const [mine, setMine] = useState<number[]>([0, 0, 1, 1, 1, 1, 1, 0, 1, 1])
  const [mode, setMode] = useState<Mode>('hp')
  const [maps, setMaps] = useState(3)
  const [near, setNear] = useState(false)
  const [prefs, setPrefs] = useState<Record<Pref, boolean>>({ hp: true, snd: true, ovl: true })
  const [hoverRun, setHoverRun] = useState<string | null>(null)
  const [matches, setMatches] = useState<BoardMatch[]>([])
  const [modal, setModal] = useState<{ teamId: string; start: number; len: number } | null>(null)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [tplDays, setTplDays] = useState<boolean[]>([false, false, true, false, true, false, false])
  const [tplSlots, setTplSlots] = useState<number[] | null>(null)
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [whTested, setWhTested] = useState(false)
  const [toast, setToast] = useState<{ title: string; sub: string } | null>(null)

  // 現在時刻 (SSR とのハイドレーション不一致を避けるためマウント後に設定)
  const [nowMins, setNowMins] = useState<number | null>(null)
  const [todayDow, setTodayDow] = useState(3)
  const [dateLabel, setDateLabel] = useState('')
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowMins(d.getHours() * 60 + d.getMinutes())
      setTodayDow(d.getDay())
      setDateLabel(`${d.getMonth() + 1}月${d.getDate()}日 (${DOW[d.getDay()]})`)
    }
    tick()
    const iv = setInterval(tick, 30000)
    return () => clearInterval(iv)
  }, [])

  // トーストの自動クローズ (新しいトーストが出るたびタイマーを張り直す)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const showToast = (title: string, sub: string) => setToast({ title, sub })

  // ---- 導出値 (デザインのロジックをそのまま移植) ----
  const slotsNeeded = () => {
    if (mode === 'hp') return 3
    if (mode === 'snd') return maps
    if (mode === 'ovl') return Math.ceil((25 * maps) / 30)
    return 0 // all
  }
  const myAv = () => SLOTS.map((_, i) => mine[i] + OTHERS.reduce((a, m) => a + m.s[i], 0))
  const av = (t: DemoTeam) => (t.id === 'me' ? myAv() : t.av!)
  const matchedSet = (teamId: string) => {
    const set = new Set<number>()
    matches.forEach(m => {
      const hit = teamId === 'me' || m.teamId === teamId
      if (hit) for (let i = m.start; i < m.start + m.len; i++) set.add(i)
    })
    return set
  }
  const runs = (t: DemoTeam) => {
    const a = av(t)
    const taken = matchedSet(t.id)
    const out: [number, number][] = []
    let s = -1
    for (let i = 0; i <= 10; i++) {
      const ok = i < 10 && a[i] >= 4 && !taken.has(i)
      if (ok && s < 0) s = i
      if (!ok && s >= 0) { out.push([s, i - 1]); s = -1 }
    }
    return out
  }
  const gap = (t: DemoTeam) => (t.tier === '未計測' ? null : Math.abs(TIER_IDX[t.tier] - TIER_IDX[MY_TIER]))
  const inRange = (t: DemoTeam) => {
    const g = gap(t)
    if (g === null) return t.unr
    return t.accept === 'any' || g <= 1
  }
  const acceptsMode = (t: DemoTeam) => (mode === 'all' ? true : t.prefs[mode])
  const need = slotsNeeded()

  const openCount = myAv().filter(v => v >= 4).length
  const myStat = openCount ? `${openCount} 枠が募集中` : '募集に出ている枠はありません'

  const tplHas = !!tplSlots
  const tplDayNames = DOW.filter((_, i) => tplDays[i]).join('・')
  const tplSlotCount = tplSlots ? tplSlots.filter(Boolean).length : 0
  const tplStatus = !tplHas
    ? '未設定'
    : tplDays[todayDow]
      ? `毎週 ${tplDayNames} に自動反映 · 今日は対象日`
      : `毎週 ${tplDayNames} に自動反映 (${tplSlotCount}枠)`
  const tplStatCl = !tplHas ? 'var(--text-dim)' : tplDays[todayDow] ? 'var(--success)' : '#9df3ff'

  const modeDurLabel = mode === 'all'
    ? '空き状況の俯瞰 — モードを選ぶと開始マーカーが出ます'
    : `${modeName(mode, maps)} · 所要 ${need}枠 (${need * 30}分) · 最終開始 ${slotLabel(10 - need)}`

  // now ライン: 20:00 前はデモ表示 (21:15)
  let nowLine: { left: string; label: string } | null = null
  if (nowMins !== null) {
    let mins = nowMins
    let demo = false
    if (mins < 1200) { mins = 1275; demo = true }
    const f = Math.min(1, (mins - 1200) / 300)
    nowLine = {
      left: `calc(181px + (100% - 181px) * ${f.toFixed(4)})`,
      label: `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}${demo ? ' (デモ)' : ' 現在'}`,
    }
  }

  // ---- ハンドラ ----
  const confirmMatch = () => {
    if (!modal) return
    const t = TEAMS.find(x => x.id === modal.teamId)!
    const id = matches.reduce((m, x) => Math.max(m, x.id), 0) + 1
    setMatches(prev => [...prev, { id, teamId: modal.teamId, start: modal.start, len: modal.len, mode, maps }])
    setModal(null)
    showToast('対戦が成立しました', `${t.name} · ${slotLabel(modal.start)} – ${slotLabel(modal.start + modal.len)} · 両チームの Discord に通知しました`)
  }
  const doCancel = () => {
    setMatches(prev => prev.filter(x => x.id !== cancelId))
    setCancelId(null)
    showToast('対戦をキャンセルしました', '枠はボードに戻り、相手チームに通知されました')
  }
  const tplSave = () => {
    if (!mine.some(Boolean)) { showToast('空き時間が選ばれていません', '先に上のチップで時間を選んでから保存してください'); return }
    setTplSlots(mine.slice())
    showToast('曜日テンプレを保存しました', `毎週 ${tplDayNames || '(曜日未選択)'} · ${mine.filter(Boolean).length}枠を自動反映します`)
  }
  const tplApply = () => {
    if (!tplSlots) return
    setMine(tplSlots.slice())
    showToast('テンプレを反映しました', `${tplSlots.filter(Boolean).length}枠を今日の空きに入力しました`)
  }

  // ---- モーダル用導出値 ----
  const modalTeam = modal ? TEAMS.find(x => x.id === modal.teamId)! : null
  const modalPool = modal && modalTeam ? Math.min(...av(modalTeam).slice(modal.start, modal.start + modal.len)) : 0
  const modalBad = modalTeam ? !inRange(modalTeam) : false
  const modalGap = modalTeam ? gap(modalTeam) : null

  const cancelMatch = cancelId !== null ? matches.find(x => x.id === cancelId) ?? null : null
  const cancelTeam = cancelMatch ? TEAMS.find(x => x.id === cancelMatch.teamId)! : null

  const prefDefs: [Pref, string][] = [['hp', 'ハーポ回し'], ['snd', 'サーチ'], ['ovl', 'オバロ']]
  const modeDefs: [Mode, string][] = [['hp', 'ハーポ回し · 90分'], ['snd', 'サーチ'], ['ovl', 'オバロ'], ['all', 'すべて (俯瞰)']]
  const showMaps = mode === 'snd' || mode === 'ovl'

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
            チームの空き時間を出し合って、今晩の相手をその場で確定。成立すると両チームの Discord に通知が届きます。
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <div className="mono" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '0.04em' }}>{dateLabel || ' '}</div>
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
      <section className="card-strong" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div className="sec-title" style={{ marginBottom: 4 }}>STEP 1</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}>自分の空き時間を入れる</div>
          </div>
          <div className="mono" style={{ fontSize: 12, color: openCount ? 'var(--success)' : 'var(--text-dim)', paddingTop: 6 }}>{myStat}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 6 }}>
          {SLOTS.map((s, i) => {
            const on = !!mine[i]
            return (
              <button key={s} type="button" className="mono sb-hoverline" aria-pressed={on}
                onClick={() => setMine(prev => { const next = prev.slice(); next[i] = next[i] ? 0 : 1; return next })}
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
          押した時間があなたの空きになります。チームで <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>4人</span> 揃った枠だけが下のボードに募集として公開されます。枠ごとに同じ4人である必要はありません（途中交代OK）。
        </p>

        {/* 曜日テンプレ */}
        <div style={{ marginTop: 16, background: 'rgba(6,10,22,0.5)', border: `1px solid ${tplHas ? 'rgba(0,229,255,0.25)' : LINE}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 2v4M7 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M12 13v4M10 15h4" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" /></svg>
              曜日テンプレ
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>選んだ曜日に、今の空き時間を毎週自動で反映します — 毎日入力し直す必要はありません</span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: tplStatCl }}>{tplStatus}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {DOW.map((label, i) => {
                const on = tplDays[i]
                return (
                  <button key={label} type="button" className="sb-hoverline" aria-pressed={on}
                    onClick={() => setTplDays(prev => { const d = prev.slice(); d[i] = !d[i]; return d })}
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
            <button type="button" onClick={tplSave} style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px' }}>今の選択をテンプレに保存</button>
            {tplHas && (
              <>
                <button type="button" className="btn-ghost" onClick={tplApply} style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px' }}>テンプレを今日に反映</button>
                <button type="button" className="sb-link" onClick={() => { setTplSlots(null); showToast('曜日テンプレを削除しました', '') }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 11.5, padding: '8px 6px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  削除
                </button>
              </>
            )}
          </div>
        </div>

        {/* ロスター + モード希望 */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="stat-label">Roster</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--amber-soft)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 6, padding: '3px 9px' }}>o441o (あなた)</span>
            {OTHERS.map(o => (
              <span key={o.n} className="mono" style={{ fontSize: 11, color: 'var(--text-soft)', background: 'rgba(6,10,22,0.75)', border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 9px' }}>{o.n}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>今日受けられるモード:</span>
            {prefDefs.map(([k, label]) => {
              const on = prefs[k]
              return (
                <button key={k} type="button" aria-pressed={on}
                  onClick={() => setPrefs(prev => ({ ...prev, [k]: !prev[k] }))}
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

      {/* ===== STEP 2 : ボード ===== */}
      <section className="card-strong" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div className="sec-title" style={{ marginBottom: 4 }}>STEP 2</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}>モードを選んで、相手の ▶ を押す</div>
          </div>
          <button type="button" onClick={() => setNear(v => !v)} aria-pressed={near}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-soft)', background: 'transparent', border: 'none', cursor: 'pointer', userSelect: 'none', paddingTop: 8 }}>
            <span style={{ width: 32, height: 18, borderRadius: 9, border: `1px solid ${near ? 'var(--cyan)' : LINE_STRONG}`, background: near ? 'rgba(0,229,255,0.25)' : 'rgba(22,28,58,0.9)', position: 'relative', display: 'inline-block', transition: 'all .15s' }}>
              <span style={{ position: 'absolute', top: 2, left: near ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: near ? 'var(--cyan)' : 'var(--text-dim)', transition: 'all .15s' }} />
            </span>
            近い帯のみ表示
          </button>
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
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>マップ数</span>
              {[2, 3, 4].map(n => {
                const on = maps === n
                return (
                  <button key={n} type="button" className="mono" aria-pressed={on} onClick={() => setMaps(n)}
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

        {/* ボードグリッド */}
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
            {TEAMS.map(t => {
              const a = av(t)
              const taken = matchedSet(t.id)
              const runList = runs(t)
              const runAt = (i: number) => runList.find(r => i >= r[0] && i <= r[1])
              const isMe = t.id === 'me'
              const dimNear = near && !isMe && !inRange(t)
              const dimMode = !isMe && !acceptsMode(t) && mode !== 'all'
              const tierCl = TIER_COLORS[t.tier]
              let flag = '', flagCl = 'transparent', flagBd = 'transparent'
              if (t.tier === '未計測') { flag = '未計測'; flagCl = 'var(--text-dim)'; flagBd = LINE_STRONG }
              else if (dimMode) { flag = `${modeName(mode, maps).split(' ')[0]} 不可`; flagCl = '#ff8fa5'; flagBd = 'rgba(255,77,109,0.4)' }
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '176px repeat(10, minmax(66px, 1fr))', gap: 5, alignItems: 'center', marginBottom: 5, opacity: dimNear || dimMode ? 0.3 : 1, transition: 'opacity .2s' }}>
                  <div style={{ position: 'sticky', left: 0, zIndex: 2, background: 'linear-gradient(90deg, #0a0e20 82%, transparent)', minWidth: 0, padding: '4px 10px 4px 12px', borderLeft: `2px solid ${isMe ? 'var(--amber)' : 'transparent'}`, borderRadius: 2 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.name}{' '}
                      {flag && <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: flagCl, border: `1px solid ${flagBd}`, borderRadius: 3, padding: '0 4px', verticalAlign: 2 }}>{flag}</span>}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: isMe ? 'var(--amber)' : tierCl }}>
                      {t.tag} · {t.tier}{isMe ? ' · あなたのチーム' : ''}
                    </div>
                  </div>
                  {a.map((cnt, i) => {
                    const set = taken.has(i)
                    const r = runAt(i)
                    const canStart = !!r && mode !== 'all' && need > 0 && i + need - 1 <= r[1] && i + need <= 10
                    const inRun = !!r
                    const hatch = inRun && mode !== 'all' && !canStart
                    const lit = !!hoverRun && !!r && hoverRun === `${t.id}-${r[0]}`
                    const clickable = !isMe && !dimMode && inRun && mode !== 'all'
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
                    } else {
                      bg = 'rgba(6,9,20,0.9)'; border = '1px solid transparent'
                      numCl = '#333c52'; text = '·'; numSize = 12
                    }
                    const click = clickable ? () => {
                      if (canStart) { setModal({ teamId: t.id, start: i, len: need }); return }
                      const snap = Math.min(r![1] - need + 1, 10 - need)
                      if (snap >= r![0]) setModal({ teamId: t.id, start: snap, len: need })
                      else showToast(`この空きには ${modeName(mode, maps)} が入りません`, `空きが ${r![1] - r![0] + 1}枠 (${(r![1] - r![0] + 1) * 30}分) しかありません`)
                    } : undefined
                    return (
                      <div key={`${t.id}-${i}`}
                        onClick={click}
                        onMouseEnter={inRun && !set ? () => setHoverRun(`${t.id}-${r![0]}`) : undefined}
                        onMouseLeave={() => { if (hoverRun) setHoverRun(null) }}
                        onKeyDown={click ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click() } } : undefined}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        aria-label={clickable ? `${t.name} ${slotLabel(i)} の枠を選択` : undefined}
                        style={{
                          position: 'relative', height: 52, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                          transition: 'all .12s', background: bg, border, cursor: clickable ? 'pointer' : 'default',
                          boxShadow: lit && !set ? 'inset 0 0 0 1px rgba(0,229,255,0.6), 0 0 12px rgba(0,229,255,0.15)' : 'none',
                        }}>
                        <span className="mono" style={{ fontSize: numSize, lineHeight: 1, color: numCl, letterSpacing: '0.04em' }}>{text}</span>
                        {canStart && !dimMode && !isMe && (
                          <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)', fontSize: 9, textShadow: '0 0 8px rgba(0,229,255,0.8)' }}>▶</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {/* now ライン */}
            {nowLine && (
              <div style={{ position: 'absolute', top: -6, bottom: 0, left: nowLine.left, width: 1, background: 'var(--amber)', opacity: 0.85, pointerEvents: 'none', zIndex: 3 }}>
                <span style={{ position: 'absolute', top: 0, left: -3, width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse-glow 2.4s ease-in-out infinite' }} />
                <span className="mono" style={{ position: 'absolute', top: -22, left: 0, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--amber)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{nowLine.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* 凡例 */}
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(0,229,255,0.14)', border: '1px solid rgba(0,229,255,0.5)' }} />4人以上・募集中</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><span style={{ color: 'var(--cyan)', fontSize: 9 }}>▶</span>このモードで開始可</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,229,255,0.22) 3px 5px)', border: '1px solid rgba(0,229,255,0.25)' }} />空きはあるが入りきらない</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(255,176,32,0.15)', border: '1px solid rgba(255,176,32,0.55)' }} />成立済み</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-soft)' }}><i style={{ width: 13, height: 13, borderRadius: 3, flex: 'none', background: 'rgba(6,9,20,0.9)', border: `1px solid ${LINE}` }} />人数不足</span>
        </div>
      </section>

      {/* ===== 今日の成立 ===== */}
      {matches.length > 0 && (
        <section style={{ position: 'relative', background: 'rgba(18,24,52,0.86)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 14, padding: '22px 24px', backdropFilter: 'blur(14px)', marginBottom: 20, animation: 'slide-up-fade .3s ease both' }}>
          <div className="sec-title" style={{ color: 'var(--amber)' }}>今日の成立</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {matches.map(mt => {
              const t = TEAMS.find(x => x.id === mt.teamId)!
              return (
                <div key={mt.id} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'rgba(6,10,22,0.6)', border: `1px solid ${LINE}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--amber-soft)', border: '1px solid rgba(255,176,32,0.4)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: 'var(--amber)' }}>VS</div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name} <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.tag}</span></div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--amber)', letterSpacing: '0.04em' }}>{slotLabel(mt.start)} – {slotLabel(mt.start + mt.len)} · {modeName(mt.mode, mt.maps)}</div>
                  </div>
                  <span className="badge success"><span className="badge-dot" />Discord 通知済み</span>
                  <button type="button" className="btn-danger" onClick={() => setCancelId(mt.id)} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 14px' }}>キャンセル</button>
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
          <div onClick={() => setModal(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'rgba(22,28,58,0.96)', border: `1px solid ${LINE_STRONG}`, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', overflow: 'hidden' }}>
            <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{modalTeam.name} <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{modalTeam.tag}</span></div>
              <div className="mono" style={{ fontSize: 13, color: 'var(--cyan)', letterSpacing: '0.04em', marginTop: 4 }}>{slotLabel(modal.start)} – {slotLabel(modal.start + modal.len)} · {modeName(mode, maps)}</div>
            </div>
            <div style={{ padding: '16px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>出場可能帯</span><span style={{ fontWeight: 600, color: TIER_COLORS[modalTeam.tier] }}>{modalTeam.tier}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>帯の幅</span><span>{modalTeam.span}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>この時間の人数</span><span className="mono">{modalPool} 人</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>交流戦実績</span><span>{modalTeam.games ? `${modalTeam.games} 戦 / 無断キャンセル ${modalTeam.ns}` : 'なし (新規チーム)'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0' }}><span style={{ color: 'var(--text-soft)' }}>受付</span><span>{modalTeam.accept === 'any' ? '誰でも歓迎 · 未計測OK' : `同格 ±1帯${modalTeam.unr ? ' · 未計測OK' : ' · 未計測NG'}`}</span></div>
              {modalBad && (
                <div style={{ display: 'flex', gap: 9, background: 'rgba(255,77,109,0.13)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 12, color: '#ffd7de', lineHeight: 1.6 }}>
                  <span>▲</span>
                  <span>{modalGap === null
                    ? '相手は未計測チームの受付を許可していません。申請は送れますが断られる可能性があります。'
                    : `あなたのチームは受付範囲外です (${modalGap}帯差)。申請は送れます。`}</span>
                </div>
              )}
              <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>成立と同時に両チームの Discord へ通知が送られます。この対戦は unrated — レートは変動しません。</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.18)' }}>
              <button type="button" className="btn-ghost" onClick={() => setModal(null)}>閉じる</button>
              <button type="button" className="btn-primary" onClick={confirmMatch}>この枠で対戦する</button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* ===== キャンセル確認 ===== */}
      {cancelMatch && cancelTeam && (
        <BodyPortal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'grid', placeItems: 'center', padding: 24 }} role="dialog" aria-modal="true" aria-label="キャンセル確認">
          <div onClick={() => setCancelId(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'modal-card-in 180ms ease-out', padding: 22 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>対戦をキャンセルしますか?</div>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.7 }}>
              {cancelTeam.name} との {slotLabel(cancelMatch.start)} – {slotLabel(cancelMatch.start + cancelMatch.len)} の対戦を取り消します。相手チームの Discord にキャンセル通知が送られ、枠はボードに戻ります。
            </p>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>キャンセル回数は相手チームから見えるようになります。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="btn-ghost" onClick={() => setCancelId(null)}>戻る</button>
              <button type="button" className="btn-danger" onClick={doCancel}>キャンセルする</button>
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
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>Kunitachi FC · チームの通知先チャンネル</div>
            </div>
            <div style={{ padding: '18px 22px' }}>
              <label htmlFor="sb-webhook" className="stat-label" style={{ display: 'block', marginBottom: 8 }}>Webhook URL</label>
              <input id="sb-webhook" value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); setWhTested(false) }}
                placeholder="https://discord.com/api/webhooks/…" spellCheck={false}
                className="mono" style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '11px 14px' }} />
              <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                サーバー設定 → 連携サービス → ウェブフック から発行した URL を貼り付けてください。成立・キャンセルの通知がこのチャンネルに届きます。DM ではなくチャンネル通知を使うことで到達率を確保します。
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, background: 'rgba(6,10,22,0.6)', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: whTested ? 'var(--success)' : 'var(--amber)', boxShadow: `0 0 10px ${whTested ? 'var(--success)' : 'var(--amber)'}`, flex: 'none' }} />
                <span style={{ fontSize: 12, color: 'var(--text-soft)', flex: 1 }}>{whTested ? '接続確認済み — テスト通知を送信しました' : '未テスト — テスト送信で接続を確認してください'}</span>
                <button type="button" onClick={() => { setWhTested(true); showToast('テスト通知を送信しました', '#scrim-通知 チャンネルを確認してください') }}
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 12px' }}>
                  テスト送信
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.18)' }}>
              <button type="button" className="btn-ghost" onClick={() => setWebhookOpen(false)}>閉じる</button>
              <button type="button" className="btn-primary" onClick={() => { setWebhookOpen(false); showToast('通知設定を保存しました', '') }}>保存</button>
            </div>
          </div>
        </div>
        </BodyPortal>
      )}

      {/* ===== トースト ===== */}
      {toast && (
        <BodyPortal>
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 32, transform: 'translateX(-50%)', zIndex: 3000, display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'rgba(22,28,58,0.96)', border: '1px solid rgba(0,229,255,0.35)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 24px rgba(0,229,255,0.12)', animation: 'slide-up-fade .2s ease both', minWidth: 260 }}>
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
