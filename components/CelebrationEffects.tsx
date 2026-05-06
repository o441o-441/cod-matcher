'use client'

import { useEffect, useState, useMemo } from 'react'

// ── Confetti pieces ────────────────────────────────────
function Confetti({ count = 80 }: { count?: number }) {
  const palette = ['#00e5ff', '#8b5cf6', '#ff2bd6', '#ffd166', '#ffffff']
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    dur: 2.2 + Math.random() * 2.5,
    delay: Math.random() * 0.8,
    color: palette[Math.floor(Math.random() * palette.length)],
    w: 6 + Math.random() * 8,
    h: 10 + Math.random() * 16,
    rot: Math.random() * 360,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [count])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {pieces.map(p => (
        <span key={p.id} className="confetti-piece" style={{
          left: `${p.left}%`,
          width: p.w,
          height: p.h,
          background: p.color,
          animationDuration: `${p.dur}s`,
          animationDelay: `${p.delay}s`,
          transform: `rotate(${p.rot}deg)`,
          boxShadow: `0 0 8px ${p.color}aa`,
        }} />
      ))}
    </div>
  )
}

// ── Corner brackets (gold, champion) ──────────────────
function CornerBrackets() {
  const corners = [
    { left: 24, top: 24 },
    { right: 24, top: 24 },
    { left: 24, bottom: 24, transform: 'scaleY(-1)' as const },
    { right: 24, bottom: 24, transform: 'scale(-1)' as const },
  ]
  return (
    <>
      {corners.map((pos, i) => (
        <div key={i} style={{ position: 'absolute', width: 60, height: 60, ...pos }}>
          <div style={{
            position: 'absolute', top: 0,
            left: pos.left != null ? 0 : undefined,
            right: pos.right != null ? 0 : undefined,
            width: '100%', height: 2,
            background: 'linear-gradient(90deg, #ffd166, transparent)',
            transform: pos.right != null && !pos.bottom ? 'scaleX(-1)' : undefined,
            boxShadow: '0 0 12px #ffd166',
          }} />
          <div style={{
            position: 'absolute', top: 0,
            left: pos.left != null ? 0 : undefined,
            right: pos.right != null ? 0 : undefined,
            width: 2, height: '100%',
            background: 'linear-gradient(180deg, #ffd166, transparent)',
            boxShadow: '0 0 12px #ffd166',
          }} />
        </div>
      ))}
    </>
  )
}

// ── VICTORY — match win, ~3s ──────────────────────────
export function VictoryEffect({ onClose }: { onClose?: () => void }) {
  useEffect(() => {
    if (!onClose) return
    const t = setTimeout(onClose, 3200)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="celeb-overlay" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div className="celeb-scan" />
      <div className="celeb-win-toast">
        <div className="celeb-victory-text">VICTORY</div>
      </div>
    </div>
  )
}

// ── CHAMPION — tournament winner, ~8s ─────────────────
export function ChampionEffect({
  tournamentName = '',
  winnerName = '',
  onClose,
}: {
  tournamentName?: string
  winnerName?: string
  onClose?: () => void
}) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 800)
    const t2 = setTimeout(() => setPhase(2), 2200)
    const t3 = onClose ? setTimeout(onClose, 9000) : null
    return () => { clearTimeout(t1); clearTimeout(t2); if (t3) clearTimeout(t3) }
  }, [onClose])

  return (
    <div className="celeb-overlay celeb-scrim">
      <div className="celeb-spotlight" />
      <Confetti count={120} />
      <div className="celeb-stage">
        <div className="celeb-eyebrow">{tournamentName} · CHAMPION</div>
        <div className="celeb-big celeb-gold">{winnerName}</div>
        {phase >= 1 && (
          <div className="celeb-sub" style={{ marginTop: 6, animation: 'celeb-pop 500ms cubic-bezier(.2,1.5,.4,1)' }}>
            TOURNAMENT CHAMPION
          </div>
        )}
        {phase >= 2 && (
          <div style={{ marginTop: 18, animation: 'celeb-pop 600ms cubic-bezier(.2,1.5,.4,1)' }}>
            <div className="celeb-ring">
              <span style={{ fontSize: 14 }}>★</span>
              LEGEND
              <span style={{ fontSize: 14 }}>★</span>
            </div>
          </div>
        )}
      </div>
      <CornerBrackets />
    </div>
  )
}
