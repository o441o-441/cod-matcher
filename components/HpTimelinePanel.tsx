'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ConfirmDialog from '@/components/ConfirmDialog'
import { cleanMonotonic, hillCycleForMap, segmentsFromSamples, type Rotation, type TimelineSample } from '@/lib/hpTimeline'
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

  if (withData.length === 0) return null

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
        const rots = row.rotations
        const cyc = hillCycleForMap(g.map)
        const rotLabel = (no: number) => `${Math.floor((no - 1) / cyc) + 1}周目 P${((no - 1) % cyc) + 1}`
        const myOf = (r: Rotation) => (mySide === 'guest' ? r.guest_sec : r.host_sec)
        const oppOf = (r: Rotation) => (mySide === 'guest' ? r.host_sec : r.guest_sec)
        const hostVals = rots.map(r => r.host_sec)
        const guestVals = rots.map(r => r.guest_sec)
        const diffVals = rots.map(r => myOf(r) - oppOf(r))
        const worst = [...rots].sort((a, b) => (myOf(a) - oppOf(a)) - (myOf(b) - oppOf(b)))[0]
        const worstDiff = worst ? myOf(worst) - oppOf(worst) : 0
        return (
          <div key={g.id} style={{ marginBottom: 14 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              <span className="badge" style={{ fontSize: 9 }}>GAME {g.game_no}</span>
              {g.map && <span style={{ fontSize: 12, fontWeight: 700 }}>{g.map}</span>}
              <span className="dim" style={{ fontSize: 10 }}>ポイント区切り: {METHOD_LABEL[row.rotation_method]}</span>
              {canEdit && (
                <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
                  <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 10 }} disabled={busy} onClick={() => setDeleteTarget(g)}>推移を削除</button>
                </span>
              )}
            </div>
            <TimelineBar row={row} />
            <ScoreLineChart row={row} />
            {/* このゲームのポイント別の保持時間 */}
            <div style={{ marginTop: 6 }}>
              <StatTable minWidth={380} head={
                <>
                  <th style={thLeft}>ポイント</th>
                  <th style={thStyle}>{hostName} 保持</th>
                  <th style={thStyle}>{guestName} 保持</th>
                  <th style={thStyle}>差 ({myName}視点)</th>
                </>
              }>
                {rots.map((r, i) => (
                  <tr key={r.no} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={tdLeft}>{rotLabel(r.no)}</td>
                    <td style={{ ...tdStyle, ...heatBg(relT(hostVals, r.host_sec)) }} className="mono">{fmtDur(r.host_sec)}</td>
                    <td style={{ ...tdStyle, ...heatBg(relT(guestVals, r.guest_sec)) }} className="mono">{fmtDur(r.guest_sec)}</td>
                    <td style={{ ...tdStyle, ...heatBg(relT(diffVals, diffVals[i])) }} className="mono">
                      {diffVals[i] > 0 ? '+' : ''}{Math.round(diffVals[i])}秒
                    </td>
                  </tr>
                ))}
              </StatTable>
              {worst && worstDiff < 0 && (
                <p style={{ fontSize: 11.5, margin: '4px 0 0' }}>
                  💡 このゲームの改善候補: <strong>{rotLabel(worst.no)}</strong> — {myName}視点で <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{Math.round(worstDiff)}秒</span>
                </p>
              )}
            </div>
          </div>
        )
      })}

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
