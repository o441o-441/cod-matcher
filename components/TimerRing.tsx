'use client'

export default function TimerRing({
  seconds,
  max = 45,
  size = 60,
}: {
  seconds: number
  max?: number
  size?: number
}) {
  const r = size * 0.37
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, seconds) / max
  const offset = circ * (1 - pct)
  // 警告色は残り割合ベース (長い制限時間でも段階的に警告が出るように)。
  // 短い制限時間では従来の絶対秒しきい値も効かせる。
  const danger = pct <= 0.1 || seconds <= 10
  const warn = pct <= 0.33 || seconds <= 20
  const color = danger ? 'var(--danger)' : warn ? 'var(--amber)' : 'var(--cyan)'
  const cx = size / 2
  const cy = size / 2

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="3"
          fill="none"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={color}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            transition: 'stroke-dashoffset 1s linear, stroke 0.3s',
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: size * 0.23,
          color,
        }}
      >
        {seconds}
      </div>
    </div>
  )
}
