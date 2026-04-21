'use client'

import { useEffect, useState } from 'react'

export default function RatingDelta({
  oldRating,
  newRating,
  show,
}: {
  oldRating: number
  newRating: number
  show: boolean
}) {
  const [displayRating, setDisplayRating] = useState(oldRating)
  const [phase, setPhase] = useState<'idle' | 'counting' | 'done'>('idle')

  const delta = newRating - oldRating
  const isPositive = delta > 0

  useEffect(() => {
    if (!show) return
    setPhase('counting')

    const steps = 30
    const stepMs = 40
    const increment = delta / steps
    let step = 0

    const interval = setInterval(() => {
      step++
      if (step >= steps) {
        setDisplayRating(newRating)
        setPhase('done')
        clearInterval(interval)
      } else {
        setDisplayRating(Math.round(oldRating + increment * step))
      }
    }, stepMs)

    return () => clearInterval(interval)
  }, [show, oldRating, newRating, delta])

  if (!show) return null

  return (
    <div className="enter" style={{ textAlign: 'center', padding: '32px 0' }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>
        RATING UPDATE
      </div>
      <div
        className="mono tabular"
        style={{
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1,
          color: 'var(--cyan)',
          textShadow: '0 0 40px rgba(0, 229, 255, 0.5)',
          fontFamily: 'var(--font-display)',
        }}
      >
        {displayRating}
      </div>
      {phase === 'done' && (
        <div
          className="enter mono"
          style={{
            fontSize: 24,
            fontWeight: 700,
            marginTop: 12,
            color: isPositive ? 'var(--success)' : 'var(--danger)',
            textShadow: isPositive
              ? '0 0 20px rgba(0, 245, 160, 0.5)'
              : '0 0 20px rgba(255, 77, 109, 0.5)',
          }}
        >
          {isPositive ? '+' : ''}
          {delta}
        </div>
      )}
      {phase === 'done' && (
        <div className="bar mt-m" style={{ maxWidth: 300, margin: '20px auto 0' }}>
          <div
            className="bar-fill"
            style={{
              width: `${Math.min(100, (newRating / 2500) * 100)}%`,
              background: isPositive
                ? 'linear-gradient(90deg, var(--cyan), var(--success))'
                : 'linear-gradient(90deg, var(--danger), var(--magenta))',
            }}
          />
        </div>
      )}
    </div>
  )
}
