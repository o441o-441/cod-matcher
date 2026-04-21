'use client'

const MAP_GRADS: Record<string, [string, string, string]> = {
  ravine:   ['#0b2a3e', '#1d5a7a', '#ff6b35'],
  atrium:   ['#2b1a3e', '#6a3fa5', '#e8d2ff'],
  depot:    ['#2a1f0e', '#7a5a28', '#ffd88a'],
  kiosk:    ['#0e2a1a', '#2a6a48', '#aaffca'],
  meridian: ['#10203e', '#3060a0', '#9ed8ff'],
  foundry:  ['#2e0e0e', '#7a2828', '#ff8888'],
  plaza:    ['#2a2a10', '#787820', '#ffff99'],
  rampart:  ['#1a1a2e', '#424280', '#aaaaff'],
  pier:     ['#0a1e2e', '#205878', '#7cd8ff'],
  orbit:    ['#0a0a2e', '#2828a0', '#8080ff'],
}

export default function MapThumb({
  mapId,
  mapName,
  mapNameEn,
  state = 'available',
  small = false,
}: {
  mapId: string
  mapName: string
  mapNameEn?: string
  state?: 'available' | 'banned' | 'picked'
  small?: boolean
}) {
  const grad = MAP_GRADS[mapId] || ['#20283a', '#4a5878', '#aab4cc']
  const isBanned = state === 'banned'
  const isPicked = state === 'picked'

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: small ? '16/7' : '16/10',
        borderRadius: 10,
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${grad[0]} 0%, ${grad[1]} 60%, ${grad[2]} 120%)`,
        border: isPicked
          ? '1px solid var(--cyan)'
          : isBanned
            ? '1px solid rgba(255, 77, 109, 0.4)'
            : '1px solid var(--line)',
        boxShadow: isPicked
          ? '0 0 28px rgba(0, 229, 255, 0.45), inset 0 0 0 1px rgba(0,229,255,0.5)'
          : 'none',
        filter: isBanned ? 'grayscale(0.9) brightness(0.5)' : 'none',
        transition: 'all 0.25s ease',
      }}
    >
      {/* Topographical pattern */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 160 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, opacity: 0.22 }}
      >
        <defs>
          <pattern
            id={`hatch-${mapId}-${state}`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 6L6 0" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="160" height="100" fill={`url(#hatch-${mapId}-${state})`} />
        <path
          d={`M0 ${60 + (mapId.length % 10)} Q40 ${40 + (mapId.charCodeAt(0) % 20)} 80 50 T160 ${45 + (mapId.length % 15)}`}
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="0.8"
          fill="none"
        />
        <path
          d={`M0 ${75 + (mapId.length % 8)} Q40 ${60 + ((mapId.charCodeAt(1) || 0) % 20)} 80 65 T160 ${60 + (mapId.length % 12)}`}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="0.8"
          fill="none"
        />
      </svg>

      {/* Corner English name */}
      {mapNameEn && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: 8,
            fontFamily: 'var(--font-display)',
            fontSize: 9,
            letterSpacing: '0.22em',
            color: 'rgba(255,255,255,0.75)',
            textTransform: 'uppercase',
          }}
        >
          {mapNameEn}
        </div>
      )}

      {/* Main name */}
      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: 8,
          right: 10,
          fontFamily: 'var(--font-display)',
          fontSize: small ? 14 : 18,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '0.01em',
          textShadow: '0 2px 10px rgba(0,0,0,0.6)',
        }}
      >
        {mapName}
      </div>

      {/* Ban overlay */}
      {isBanned && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(10,5,10,0.55)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: small ? 16 : 22,
              fontWeight: 800,
              color: 'var(--danger)',
              letterSpacing: '0.2em',
              border: '2px solid var(--danger)',
              padding: '4px 14px',
              transform: 'rotate(-8deg)',
              background: 'rgba(255, 77, 109, 0.15)',
              textShadow: '0 0 12px rgba(255, 77, 109, 0.8)',
            }}
          >
            BAN
          </span>
        </div>
      )}

      {/* Pick badge */}
      {isPicked && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'var(--cyan)',
            color: '#04050c',
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.2em',
            padding: '3px 8px',
            borderRadius: 4,
            fontFamily: 'var(--font-display)',
          }}
        >
          PICKED
        </div>
      )}
    </div>
  )
}
