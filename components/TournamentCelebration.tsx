'use client'

import { useEffect, useState } from 'react'

type Props = {
  type: 'victory' | 'champion'
  onClose: () => void
}

export default function TournamentCelebration({ type, onClose }: Props) {
  const [visible, setVisible] = useState(false)
  const [confetti, setConfetti] = useState<{ x: number; y: number; color: string; delay: number }[]>([])

  useEffect(() => {
    setVisible(true)

    if (type === 'champion') {
      // コンフェッティ生成
      const particles = Array.from({ length: 80 }, () => ({
        x: Math.random() * 100,
        y: -10 - Math.random() * 20,
        color: ['#ffd700', '#ff6b6b', '#00e5ff', '#8b5cf6', '#f59e0b'][Math.floor(Math.random() * 5)],
        delay: Math.random() * 2,
      }))
      setConfetti(particles)
    }

    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onClose, 500)
    }, type === 'champion' ? 8000 : 3000)

    return () => clearTimeout(timer)
  }, [type, onClose])

  if (type === 'victory') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.5s',
          pointerEvents: visible ? 'auto' : 'none',
        }}
        onClick={onClose}
      >
        <div style={{ textAlign: 'center', animation: 'pulse-glow 1.5s ease-in-out infinite' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(3rem, 8vw, 6rem)',
            fontWeight: 800,
            color: 'var(--cyan)',
            textShadow: '0 0 40px var(--cyan), 0 0 80px rgba(0,229,255,0.3)',
          }}>
            VICTORY
          </div>
          <div style={{ fontSize: 18, color: 'var(--text-soft)', marginTop: 12 }}>
            試合に勝利しました
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at center, rgba(255,215,0,0.1) 0%, rgba(0,0,0,0.9) 70%)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      {/* コンフェッティ */}
      {confetti.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: 8,
            height: 8,
            borderRadius: Math.random() > 0.5 ? '50%' : '0',
            background: p.color,
            animation: `confetti-fall 3s ${p.delay}s linear infinite`,
          }}
        />
      ))}

      {/* メインテキスト */}
      <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
        {/* ゴールドコーナーブラケット */}
        <div style={{ position: 'relative', padding: '40px 60px' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 40, height: 40, borderTop: '3px solid var(--gold, #ffd700)', borderLeft: '3px solid var(--gold, #ffd700)' }} />
          <div style={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTop: '3px solid var(--gold, #ffd700)', borderRight: '3px solid var(--gold, #ffd700)' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: 40, height: 40, borderBottom: '3px solid var(--gold, #ffd700)', borderLeft: '3px solid var(--gold, #ffd700)' }} />
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 40, height: 40, borderBottom: '3px solid var(--gold, #ffd700)', borderRight: '3px solid var(--gold, #ffd700)' }} />

          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(3rem, 10vw, 7rem)',
            fontWeight: 800,
            background: 'linear-gradient(135deg, #ffd700, #ffaa00, #ffd700)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 0 60px rgba(255,215,0,0.5)',
            lineHeight: 1,
          }}>
            CHAMPION
          </div>
          <div style={{
            fontSize: 20,
            color: 'var(--gold, #ffd700)',
            marginTop: 16,
            fontWeight: 600,
          }}>
            大会優勝おめでとうございます！
          </div>
        </div>
      </div>

      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
