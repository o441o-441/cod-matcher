// ============================================================
// 交流戦スタッツの共有ヘルパー
// チームページのダッシュボード (ScrimStatsDashboard) と
// 試合ページのプレイヤー比較 (MatchPlayerCompare) で共用する。
// ============================================================

export const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const fmt = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(digits)

export const fmtPct = (wins: number, losses: number): string =>
  wins + losses === 0 ? '-' : `${Math.round((wins / (wins + losses)) * 100)}%`

export const fmtSigned = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`

export const fmtDur = (sec: number | null): string => {
  if (sec === null || !Number.isFinite(sec)) return '-'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const kd = (k: number, d: number): number | null => (d > 0 ? k / d : k > 0 ? k : null)

// ---- 色分けヘルパー (緑=良い / 赤=改善余地) ----

// t: 0(悪い)〜1(良い)。0.5が中立で無色、離れるほど濃くなる
export const heatBg = (t: number | null): React.CSSProperties => {
  if (t === null || !Number.isFinite(t)) return {}
  const c = Math.max(0, Math.min(1, t))
  const alpha = Math.abs(c - 0.5) * 0.52
  if (alpha < 0.04) return {}
  return { background: c >= 0.5 ? `rgba(34,197,94,${alpha.toFixed(2)})` : `rgba(239,68,68,${alpha.toFixed(2)})` }
}

// 列内での相対評価 (最小=0, 最大=1)。invert=true は小さいほど良い列 (デス等)
export const relT = (vals: number[], v: number | null, invert = false): number | null => {
  if (v === null || !Number.isFinite(v) || vals.length < 2) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  if (max - min < 1e-9) return null
  const t = (v - min) / (max - min)
  return invert ? 1 - t : t
}

// K/D の絶対評価 (0.65〜1.35 を 0〜1 に)
export const kdT = (v: number | null): number | null => (v === null ? null : (v - 0.65) / 0.7)

export const winRateOf = (wins: number, losses: number): number | null =>
  wins + losses === 0 ? null : wins / (wins + losses)

export const signColor = (v: number | null): string | undefined =>
  v === null || v === 0 ? undefined : v > 0 ? 'var(--success)' : 'var(--danger)'

// 勝率バー + パーセント表示
export function WinBar({ wins, losses }: { wins: number; losses: number }) {
  const t = winRateOf(wins, losses)
  if (t === null) return <span className="mono">-</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 44, height: 6, borderRadius: 3, background: 'rgba(239,68,68,0.3)', overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ width: `${Math.round(t * 100)}%`, height: '100%', background: 'var(--success)', display: 'block' }} />
      </span>
      <span className="mono" style={{ fontWeight: 700, color: t >= 0.5 ? 'var(--success)' : 'var(--danger)' }}>{Math.round(t * 100)}%</span>
    </span>
  )
}

export const thStyle: React.CSSProperties = { textAlign: 'right', fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap' }
export const thLeft: React.CSSProperties = { ...thStyle, textAlign: 'left' }
export const tdStyle: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', whiteSpace: 'nowrap' }
export const tdLeft: React.CSSProperties = { ...tdStyle, textAlign: 'left' }

export function StatTable({ head, children, minWidth = 520 }: { head: React.ReactNode; children: React.ReactNode; minWidth?: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth, fontSize: 12, borderCollapse: 'collapse' }}>
        <thead><tr className="muted" style={{ fontSize: 10, borderBottom: '1px solid var(--line)' }}>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
