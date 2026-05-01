'use client'

export default function QueueRadar({ size = 220, waitingCount }: { size?: number; waitingCount?: number }) {
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      {/* Rings */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: '1px solid var(--line-bright)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: size * 0.11,
          borderRadius: '50%',
          border: '1px solid var(--line-strong)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: size * 0.25,
          borderRadius: '50%',
          border: '1px solid var(--line)',
        }}
      />

      {/* Sweeping cone */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'conic-gradient(from 0deg, transparent 0deg, rgba(0, 229, 255, 0.35) 30deg, transparent 60deg)',
          animation: 'spin 2s linear infinite',
          maskImage: 'radial-gradient(circle, black 50%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(circle, black 50%, transparent 100%)',
        }}
      />

      {/* Center: waiting count or dot */}
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        {waitingCount != null ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: size * 0.18,
              fontWeight: 800,
              color: 'var(--cyan)',
              lineHeight: 1,
              textShadow: '0 0 20px var(--cyan)',
            }}>
              {waitingCount}
            </div>
            <div style={{
              fontSize: size * 0.065,
              color: 'var(--text-muted)',
              fontWeight: 600,
              marginTop: 2,
            }}>
              人が検索中
            </div>
          </div>
        ) : (
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'var(--cyan)',
              boxShadow: '0 0 20px var(--cyan)',
            }}
          />
        )}
      </div>

      {/* Blips */}
      {[
        { x: '20%', y: '30%', d: 0.2 },
        { x: '75%', y: '25%', d: 0.5 },
        { x: '30%', y: '80%', d: 0.8 },
        { x: '80%', y: '70%', d: 1.2 },
      ].map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--magenta)',
            boxShadow: '0 0 12px var(--magenta)',
            animation: `flicker 2s ${p.d}s infinite`,
          }}
        />
      ))}
    </div>
  )
}
