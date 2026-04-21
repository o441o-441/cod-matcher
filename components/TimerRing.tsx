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
  const color =
    seconds <= 10 ? 'var(--danger)' : seconds <= 20 ? 'var(--amber)' : 'var(--cyan)'
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
