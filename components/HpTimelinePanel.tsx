'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ConfirmDialog from '@/components/ConfirmDialog'
import { cleanMonotonic, segmentsFromSamples, swapRotations, swapSamples, type Rotation, type TimelineSample } from '@/lib/hpTimeline'
import { StatTable, thStyle, thLeft, tdStyle, tdLeft, heatBg, relT, fmtDur } from '@/components/scrimStatsUtils'

// ============================================================
// ハードポイント地点保持の推移 (LK動画解析の結果表示)
//
// 試合ページの試合結果カード内に表示する。データが1件もなければ
// 何も描画しない (既存表示への影響ゼロ)。
//   - ゲームごと: 保持チームの推移バー + ポイントごとの保持秒数
//   - 試合全体: 何ポイント目で負けているかの集計と改善候補
// ============================================================

type PanelGame = { id: string; game_no: number; mode: string; map: string | null }

type TimelineRow = {
  game_id: string
  sample_interval: number
  rotation_method: 'hill' | 'clock' | 'assumed'
  samples: TimelineSample[]
  rotations: Rotation[]
}

type Props = {
  games: PanelGame[]
  hostName: string
  guestName: string
  mySide: 'host' | 'guest' | null
  canEdit: boolean
  refresh: number
  onChanged: () => void
}

const HOST_C = '#00e5ff'
const GUEST_C = '#ff2bd6'
const BOTH_C = '#f59e0b'
const NONE_C = 'rgba(255,255,255,0.10)'

const METHOD_LABEL: Record<TimelineRow['rotation_method'], string> = {
  hill: 'ヒル残時間から判定',
  clock: '試合時間から判定',
  assumed: '開始位置から60秒区切り',
}

function TimelineBar({ row }: { row: TimelineRow }) {
  const rots = row.rotations
  if (rots.length === 0) return null
  const t0 = rots[0].start_t
  const t1 = rots[rots.length - 1].end_t
  const span = Math.max(1, t1 - t0)
  const x = (t: number) => ((Math.max(t0, Math.min(t1, t)) - t0) / span) * 1000
  const segs = segmentsFromSamples(row.samples).filter(s => s.t1 > t0 && s.t0 < t1)
  const color = (h: string) => (h === 'host' ? HOST_C : h === 'guest' ? GUEST_C : h === 'both' ? BOTH_C : NONE_C)
  return (
    <svg viewBox="0 0 1000 30" preserveAspectRatio="none" style={{ width: '100%', height: 30, display: 'block', borderRadius: 4, background: 'rgba(0,0,0,0.25)' }}>
      {segs.map((s, i) => (
        <rect key={i} x={x(s.t0)} y={4} width={Math.max(0.5, x(s.t1) - x(s.t0))} height={22} fill={color(s.holder)} opacity={s.holder === 'none' ? 1 : 0.85} />
      ))}
      {rots.slice(1).map(r => (
        <line key={r.no} x1={x(r.start_t)} x2={x(r.start_t)} y1={0} y2={30} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeDasharray="2,2" />
      ))}
    </svg>
  )
}

// 累計スコア (= 累計保持秒数) の折れ線。差が開いた瞬間・追い上げたポイントが読める
function ScoreLineChart({ row }: { row: TimelineRow }) {
  const rots = row.rotations
  if (rots.length === 0) return null
  const t0 = rots[0].start_t
  const t1 = rots[rots.length - 1].end_t
  const span = Math.max(1, t1 - t0)
  const inRange = (p: { t: number }) => p.t >= t0 - 0.01 && p.t <= t1 + 0.01
  const hostPts = cleanMonotonic(row.samples.filter(s => s.h !== null).map(s => ({ t: s.t, v: s.h as number }))).filter(inRange)
  const guestPts = cleanMonotonic(row.samples.filter(s => s.g !== null).map(s => ({ t: s.t, v: s.g as number }))).filter(inRange)
  if (hostPts.length < 2 && guestPts.length < 2) return null
  const maxV = Math.max(50, ...hostPts.map(p => p.v), ...guestPts.map(p => p.v))
  const W = 1000
  const H = 180
  const PAD_T = 8
  const PAD_B = 6
  const x = (t: number) => ((Math.max(t0, Math.min(t1, t)) - t0) / span) * W
  const y = (v: number) => PAD_T + (1 - v / maxV) * (H - PAD_T - PAD_B)
  const path = (pts: { t: number; v: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const gridVals: number[] = []
  for (let v = 50; v < maxV; v += 50) gridVals.push(v)
  const CHART_PX = 220 // 表示高さ (px)
  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height: CHART_PX, display: 'block', borderRadius: 4, background: 'rgba(0,0,0,0.25)' }}>
        {gridVals.map(v => (
          <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {rots.slice(1).map(r => (
          <line key={r.no} x1={x(r.start_t)} x2={x(r.start_t)} y1={0} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2,3" vectorEffect="non-scaling-stroke" />
        ))}
        {hostPts.length >= 2 && <path d={path(hostPts)} fill="none" stroke={HOST_C} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {guestPts.length >= 2 && <path d={path(guestPts)} fill="none" stroke={GUEST_C} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Y軸ラベル (SVGはpreserveAspectRatio=noneで文字が歪むためHTMLで重ねる) */}
      {gridVals.map(v => (
        <span key={v} className="mono" aria-hidden style={{
          position: 'absolute',
          left: 4,
          top: `${(y(v) / H) * 100}%`,
          transform: 'translateY(-55%)',
          fontSize: 9.5,
          color: 'rgba(255,255,255,0.45)',
          textShadow: '0 0 3px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
        }}>{v}</span>
      ))}
    </div>
  )
}

export default function HpTimelinePanel({ games, hostName, guestName, mySide, canEdit, refresh, onChanged }: Props) {
  const hpGames = useMemo(() => games.filter(g => g.mode === 'hp'), [games])
  const [rows, setRows] = useState<Record<string, TimelineRow>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PanelGame | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // hpGames に無い game_id の行は表示側 (withData) で除外される
      if (hpGames.length === 0) return
      const { data } = await supabase.from('scrim_game_hp_timeline')
        .select('game_id, sample_interval, rotation_method, samples, rotations')
        .in('game_id', hpGames.map(g => g.id))
      if (cancelled) return
      const map: Record<string, TimelineRow> = {}
      for (const r of (data ?? []) as TimelineRow[]) map[r.game_id] = r
      setRows(map)
    }
    void load()
    return () => { cancelled = true }
  }, [hpGames, refresh])

  const withData = hpGames.filter(g => rows[g.id]?.rotations?.length)
  const myName = mySide === 'guest' ? guestName : hostName
  const oppName = mySide === 'guest' ? hostName : guestName

  // 何ポイント目ごとの集計 (全HPゲーム横断)
  const agg = useMemo(() => {
    const m = new Map<number, { n: number; host: number; guest: number; wins: number }>()
    for (const g of withData) {
      for (const r of rows[g.id].rotations) {
        const a = m.get(r.no) ?? { n: 0, host: 0, guest: 0, wins: 0 }
        a.n += 1
        a.host += r.host_sec
        a.guest += r.guest_sec
        const my = mySide === 'guest' ? r.guest_sec : r.host_sec
        const opp = mySide === 'guest' ? r.host_sec : r.guest_sec
        if (my > opp) a.wins += 1
        m.set(r.no, a)
      }
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([no, a]) => {
      const avgHost = a.host / a.n
      const avgGuest = a.guest / a.n
      const my = mySide === 'guest' ? avgGuest : avgHost
      const opp = mySide === 'guest' ? avgHost : avgGuest
      return { no, n: a.n, avgHost, avgGuest, diff: my - opp, wins: a.wins }
    })
  }, [withData, rows, mySide])

  if (withData.length === 0) return null

  const diffs = agg.map(a => a.diff)
  const hostAvgs = agg.map(a => a.avgHost)
  const guestAvgs = agg.map(a => a.avgGuest)
  const byDiff = [...agg].sort((a, b) => a.diff - b.diff)
  const worst = byDiff.find(a => a.n >= 2) ?? byDiff[0]

  const swap = async (g: PanelGame) => {
    const row = rows[g.id]
    if (!row || busy) return
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('rpc_scrim_submit_hp_timeline', {
      p_game_id: g.id,
      p_sample_interval: row.sample_interval,
      p_rotation_method: row.rotation_method,
      p_samples: swapSamples(row.samples),
      p_rotations: swapRotations(row.rotations),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onChanged() // refresh の更新で再読込される
  }

  const del = async () => {
    if (!deleteTarget || busy) return
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('rpc_scrim_delete_hp_timeline', { p_game_id: deleteTarget.id })
    setBusy(false)
    setDeleteTarget(null)
    if (error) { setErr(error.message); return }
    setRows(prev => { const next = { ...prev }; delete next[deleteTarget.id]; return next })
    onChanged()
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div className="sec-title" style={{ marginBottom: 4 }}>🕐 ハードポイント地点保持の推移</div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 10.5, marginBottom: 10 }} aria-hidden>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: HOST_C, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />{hostName}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: GUEST_C, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />{guestName}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: BOTH_C, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />競り合い</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: NONE_C, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />どちらも不在</span>
        <span className="dim">折れ線 = 累計スコアの推移 · 縦の点線 = ポイントの切り替わり (横罫線は50点ごと)</span>
      </div>

      {withData.map(g => {
        const row = rows[g.id]
        const total = row.rotations[row.rotations.length - 1].end_t - row.rotations[0].start_t
        return (
          <div key={g.id} style={{ marginBottom: 14 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              <span className="badge" style={{ fontSize: 9 }}>GAME {g.game_no}</span>
              {g.map && <span style={{ fontSize: 12, fontWeight: 700 }}>{g.map}</span>}
              <span className="dim" style={{ fontSize: 10 }}>ポイント区切り: {METHOD_LABEL[row.rotation_method]}</span>
              {canEdit && (
                <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
                  <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 10 }} disabled={busy} onClick={() => void swap(g)}>左右入れ替え</button>
                  <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 10 }} disabled={busy} onClick={() => setDeleteTarget(g)}>推移を削除</button>
                </span>
              )}
            </div>
            <TimelineBar row={row} />
            <ScoreLineChart row={row} />
            <div style={{ display: 'flex', marginTop: 2 }}>
              {row.rotations.map(r => {
                const w = ((r.end_t - r.start_t) / Math.max(1, total)) * 100
                const lead = r.host_sec - r.guest_sec
                return (
                  <div key={r.no} title={`${r.no}ポイント目: ${hostName} ${Math.round(r.host_sec)}秒 / ${guestName} ${Math.round(r.guest_sec)}秒`}
                    style={{ width: `${w}%`, minWidth: 0, textAlign: 'center', fontSize: 9.5, padding: '2px 0', borderRight: '1px solid var(--line)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    <span className="dim">#{r.no}</span>{' '}
                    <span className="mono" style={{ color: lead > 3 ? HOST_C : lead < -3 ? GUEST_C : undefined }}>
                      {Math.round(r.host_sec)}-{Math.round(r.guest_sec)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 何ポイント目ごとの集計 */}
      <div className="stat-label" style={{ margin: '14px 0 6px' }}>何ポイント目で差がついているか (この交流戦のHP {withData.length}ゲーム)</div>
      <StatTable minWidth={460} head={
        <>
          <th style={thLeft}>ポイント</th>
          <th style={thStyle}>{hostName} 平均保持</th>
          <th style={thStyle}>{guestName} 平均保持</th>
          <th style={thStyle}>差 ({myName}視点)</th>
        </>
      }>
        {agg.map(a => (
          <tr key={a.no} style={{ borderBottom: '1px solid var(--line)' }}>
            <td style={tdLeft}>{a.no}ポイント目</td>
            <td style={{ ...tdStyle, ...heatBg(relT(hostAvgs, a.avgHost)) }} className="mono">{fmtDur(a.avgHost)}</td>
            <td style={{ ...tdStyle, ...heatBg(relT(guestAvgs, a.avgGuest)) }} className="mono">{fmtDur(a.avgGuest)}</td>
            <td style={{ ...tdStyle, ...heatBg(relT(diffs, a.diff)) }} className="mono">
              {a.diff > 0 ? '+' : ''}{Math.round(a.diff)}秒
            </td>
          </tr>
        ))}
      </StatTable>
      {worst && (worst.diff < 0 ? (
        <p style={{ fontSize: 12, margin: '8px 0 0' }}>
          💡 改善候補: <strong>{worst.no}ポイント目</strong> — {myName} は {oppName} に平均 <strong style={{ color: 'var(--danger)' }}>{Math.abs(Math.round(worst.diff))}秒</strong> 下回っています。
          このポイントへの寄り方・リスポーン管理を見直すとスコアが伸びやすくなります。
        </p>
      ) : (
        <p style={{ fontSize: 12, margin: '8px 0 0' }}>
          💡 すべてのポイントで {myName} が保持時間で上回っています。最も差が小さいのは <strong>{worst.no}ポイント目</strong> (平均 +{Math.round(worst.diff)}秒) です。
        </p>
      ))}
      {err && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '8px 0 0' }}>{err}</p>}

      <ConfirmDialog
        open={!!deleteTarget}
        title="ヒル保持の推移を削除しますか？"
        message={deleteTarget ? `GAME ${deleteTarget.game_no} の推移データを削除します。スタッツ (スコアボード) はそのまま残ります。` : ''}
        confirmText={busy ? '削除中...' : '削除する'}
        cancelText="戻る"
        onConfirm={() => void del()}
        onCancel={() => { if (!busy) setDeleteTarget(null) }}
      />
    </div>
  )
}
