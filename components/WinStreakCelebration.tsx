'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ================================================================
// TIER CONFIG
// ================================================================
const COLOR_STEPS = [
  { name: 'WHITE', color: '#FFFFFF' },
  { name: 'BLUE', color: '#3D9DFF' },
  { name: 'YELLOW', color: '#FFD620' },
  { name: 'GREEN', color: '#20E070' },
  { name: 'RED', color: '#FF3355' },
  { name: 'RAINBOW', color: '#FF00AA' },
]

export type TierKey = 'streak' | 'rampage' | 'unstoppable' | 'godlike'

export interface TierConfig {
  threshold: number
  key: TierKey
  eyebrow: string
  bigText: string
  sub: string
  glow: string
  stopStep: number
  holdDur: number
  totalDur: number
  promoFrom: number
  promoTo: number
  rankFrom: number
  rankTo: number
  desc: string
  stingerCount: number
}

export const TIERS: Record<TierKey, TierConfig> = {
  streak: {
    threshold: 3,
    key: 'streak',
    eyebrow: '3 WIN STREAK',
    bigText: 'STREAK',
    sub: '// CONSECUTIVE VICTORIES',
    glow: '#3D9DFF',
    stopStep: 1,
    holdDur: 1400,
    totalDur: 4500,
    promoFrom: 2184, promoTo: 2202, rankFrom: 142, rankTo: 128,
    desc: '青保留。中堅帯。4.5秒',
    stingerCount: 2,
  },
  rampage: {
    threshold: 5,
    key: 'rampage',
    eyebrow: '5 WIN STREAK',
    bigText: 'RAMPAGE',
    sub: '// SURGE PROTOCOL',
    glow: '#FFD620',
    stopStep: 3,
    holdDur: 2200,
    totalDur: 7500,
    promoFrom: 2184, promoTo: 2218, rankFrom: 142, rankTo: 96,
    desc: '緑まで上昇。中尺。7.5秒',
    stingerCount: 3,
  },
  unstoppable: {
    threshold: 7,
    key: 'unstoppable',
    eyebrow: '7 WIN STREAK',
    bigText: 'UNSTOPPABLE',
    sub: '// TRANSCENDENCE IMMINENT',
    glow: '#FF3355',
    stopStep: 4,
    holdDur: 3000,
    totalDur: 9500,
    promoFrom: 2184, promoTo: 2242, rankFrom: 142, rankTo: 61,
    desc: '赤確定。長尺。9.5秒',
    stingerCount: 4,
  },
  godlike: {
    threshold: 10,
    key: 'godlike',
    eyebrow: '10 WIN STREAK · MYTHIC',
    bigText: 'GODLIKE',
    sub: '// SEASON LEGEND ASCENDED',
    glow: '#FF00AA',
    stopStep: 5,
    holdDur: 4500,
    totalDur: 12000,
    promoFrom: 2184, promoTo: 2298, rankFrom: 142, rankTo: 12,
    desc: '虹確定。シーズンレジェンド。フル12秒',
    stingerCount: 6,
  },
}

export function tierFor(count: number): TierConfig | null {
  if (count >= 10) return TIERS.godlike
  if (count >= 7) return TIERS.unstoppable
  if (count >= 5) return TIERS.rampage
  if (count >= 3) return TIERS.streak
  return null
}

// ================================================================
// AUDIO ENGINE (WebAudio synth)
// ================================================================
let _ctx: AudioContext | null = null
function getCtx(): AudioContext {
  if (!_ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    _ctx = new AC()
  }
  if (_ctx.state === 'suspended') _ctx.resume()
  return _ctx
}

function glassPing(ctx: AudioContext, t0: number, out: AudioNode, opts: { freq?: number; gain?: number; dur?: number } = {}) {
  const { freq = 4800, gain = 0.4, dur = 0.35 } = opts
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.8, t0 + 0.06)
  const osc2 = ctx.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(freq * 1.5, t0)
  osc2.frequency.exponentialRampToValueAtTime(freq * 2.4, t0 + 0.08)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g); osc2.connect(g); g.connect(out)
  osc.start(t0); osc.stop(t0 + dur + 0.05)
  osc2.start(t0); osc2.stop(t0 + dur + 0.05)

  const nb = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate)
  const nd = nb.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  const ns = ctx.createBufferSource(); ns.buffer = nb
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0, t0)
  ng.gain.linearRampToValueAtTime(gain * 0.5, t0 + 0.004)
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
  ns.connect(hp).connect(ng).connect(out)
  ns.start(t0); ns.stop(t0 + 0.22)
}

function metalStinger(ctx: AudioContext, t0: number, out: AudioNode, opts: { freq?: number; gain?: number; dur?: number } = {}) {
  const { freq = 2800, gain = 0.5, dur = 0.7 } = opts
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'
  bp.frequency.setValueAtTime(freq, t0)
  bp.frequency.exponentialRampToValueAtTime(freq * 0.7, t0 + dur)
  bp.Q.value = 6
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp).connect(g).connect(out)
  src.start(t0); src.stop(t0 + dur + 0.05)

  const bell = ctx.createOscillator(); bell.type = 'triangle'
  bell.frequency.setValueAtTime(freq * 0.5, t0)
  const bg = ctx.createGain()
  bg.gain.setValueAtTime(0, t0)
  bg.gain.linearRampToValueAtTime(gain * 0.5, t0 + 0.004)
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.2)
  bell.connect(bg).connect(out)
  bell.start(t0); bell.stop(t0 + dur * 1.2 + 0.05)
}

function subHit(ctx: AudioContext, t0: number, out: AudioNode, opts: { gain?: number; freq?: number; dur?: number } = {}) {
  const { gain = 1.2, freq = 50, dur = 1.0 } = opts
  const osc = ctx.createOscillator(); osc.type = 'sine'
  osc.frequency.setValueAtTime(freq * 2, t0)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(out)
  osc.start(t0); osc.stop(t0 + dur + 0.05)
}

function noiseRiser(ctx: AudioContext, t0: number, out: AudioNode, opts: { dur?: number; gain?: number; from?: number; to?: number } = {}) {
  const { dur = 1.2, gain = 0.3, from = 100, to = 9000 } = opts
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2
  bp.frequency.setValueAtTime(from, t0)
  bp.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.7)
  g.gain.linearRampToValueAtTime(0, t0 + dur)
  src.connect(bp).connect(g).connect(out)
  src.start(t0); src.stop(t0 + dur + 0.05)
}

function chordStab(ctx: AudioContext, t0: number, out: AudioNode, opts: { notes: number[]; dur?: number; gain?: number }) {
  const { notes, dur = 1.8, gain = 0.18 } = opts
  notes.forEach((freq) => {
    [0, -8, 8].forEach((detune) => {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'; osc.frequency.value = freq; osc.detune.value = detune
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(gain / 3, t0 + 0.02)
      g.gain.linearRampToValueAtTime(gain / 5, t0 + dur * 0.4)
      g.gain.linearRampToValueAtTime(0, t0 + dur)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'
      lp.frequency.setValueAtTime(500, t0)
      lp.frequency.exponentialRampToValueAtTime(7000, t0 + 0.2)
      osc.connect(lp).connect(g).connect(out)
      osc.start(t0); osc.stop(t0 + dur + 0.1)
    })
  })
}

function heartbeat(ctx: AudioContext, t0: number, out: AudioNode, bpm = 110, beats = 4, gain = 0.5) {
  const beat = 60 / bpm
  for (let i = 0; i < beats; i++) {
    const bt = t0 + i * beat;
    [bt, bt + 0.18].forEach((tt) => {
      const osc = ctx.createOscillator(); osc.type = 'sine'
      osc.frequency.setValueAtTime(80, tt)
      osc.frequency.exponentialRampToValueAtTime(30, tt + 0.12)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, tt)
      g.gain.linearRampToValueAtTime(gain, tt + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.15)
      osc.connect(g).connect(out)
      osc.start(tt); osc.stop(tt + 0.18)
    })
  }
}

function arp(ctx: AudioContext, t0: number, out: AudioNode, opts: { notes: number[]; step?: number; dur?: number; gain?: number }) {
  const { notes, step = 0.07, dur = 0.12, gain = 0.14 } = opts
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = freq
    const g = ctx.createGain()
    const start = t0 + i * step
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(gain, start + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g).connect(out)
    osc.start(start); osc.stop(start + dur + 0.05)
  })
}

// ================================================================
// SHARD GENERATION
// ================================================================
interface Shard {
  i: number; x: number; y: number; rot: number; left: number; top: number; delay: number
}

function generateShards(n: number): Shard[] {
  return Array.from({ length: n }).map((_, i) => {
    const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.5
    const dist = 300 + Math.random() * 500
    return {
      i,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      rot: Math.random() * 360,
      left: 50 + (Math.random() - 0.5) * 20,
      top: 50 + (Math.random() - 0.5) * 20,
      delay: Math.random() * 0.1,
    }
  })
}

// ================================================================
// PROMO LABELS
// ================================================================
const PROMO_LABELS: Record<TierKey, string> = {
  streak: '▸ RANK PROMOTION',
  rampage: '▸▸ SPECIAL PROMOTION',
  unstoppable: '▸▸▸ EMERGENCY ASCENSION',
  godlike: '★ TRANSCENDENT PROMOTION ★',
}

// ================================================================
// CELEBRATION COMPONENT
// ================================================================
type Phase = 'hold' | 'burst' | 'main' | 'promo' | 'outro'

function Celebration({ tierKey, count, onDone }: { tierKey: TierKey; count: number; onDone?: () => void }) {
  const tier = TIERS[tierKey]
  const [phase, setPhase] = useState<Phase>('hold')
  const [colorIdx, setColorIdx] = useState(0)
  const [gaugePct, setGaugePct] = useState(0)
  const [promoRank, setPromoRank] = useState(tier.rankFrom)
  const [promoRating, setPromoRating] = useState(tier.promoFrom)
  const [shards, setShards] = useState<Shard[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    document.body.classList.add('ws-active')
    const t = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms)
      timersRef.current.push(id)
      return id
    }

    const ctx = getCtx()
    const master = ctx.createGain()
    master.gain.value = 0.75
    master.connect(ctx.destination)
    const now = () => ctx.currentTime

    // PHASE 1 — HOLD
    heartbeat(ctx, now() + 0.1, master, 90 + tier.stopStep * 20, 2 + tier.stopStep, 0.45)

    const { stopStep, holdDur } = tier
    const stepDur = holdDur / (stopStep + 1)

    for (let step = 0; step <= stopStep; step++) {
      const stepT = step * stepDur
      t(() => {
        setColorIdx(step)
        setGaugePct(((step + 1) / (stopStep + 1)) * 100)
        const pitchBoost = 1 + step * 0.15
        glassPing(ctx, now() + 0.01, master, {
          freq: 4200 * pitchBoost,
          gain: 0.35 + step * 0.05,
          dur: 0.3 + step * 0.05,
        })
        if (step >= 1 && step < stopStep) {
          heartbeat(ctx, now() + 0.2, master, 100 + step * 15, 2, 0.4 + step * 0.05)
        }
      }, stepT)
    }

    // PHASE 2 — EXPLOSION
    t(() => {
      setPhase('burst')
      setShards(generateShards(28 + tier.stopStep * 6))
      for (let k = 0; k < 5; k++) {
        glassPing(ctx, now() + k * 0.03, master, { freq: 5000 + k * 800, gain: 0.5, dur: 0.5 })
      }
      subHit(ctx, now(), master, { gain: 1.4, freq: 40, dur: 1.2 })
      metalStinger(ctx, now(), master, { freq: 2200, gain: 0.7, dur: 1.0 })
      metalStinger(ctx, now(), master, { freq: 4500, gain: 0.4, dur: 0.4 })
      noiseRiser(ctx, now(), master, { dur: 0.5, gain: 0.3, from: 200, to: 9000 })
    }, holdDur)

    // PHASE 3 — MAIN TEXT
    const mainStart = holdDur + 400
    t(() => {
      setPhase('main')
      const chordNotes: Record<TierKey, number[][]> = {
        streak: [[392, 494, 587, 784]],
        rampage: [[349, 440, 523, 698], [392, 494, 587, 784]],
        unstoppable: [[329, 415, 494, 659], [392, 494, 587, 784], [440, 554, 659, 880]],
        godlike: [[261, 329, 392, 523, 659], [293, 370, 440, 587, 740], [329, 415, 494, 659, 831], [392, 494, 587, 784, 988]],
      }
      chordNotes[tier.key].forEach((notes, i) => {
        chordStab(ctx, now() + i * 0.7, master, { notes, dur: 2.2, gain: 0.22 })
      })

      const stCount = tier.stingerCount
      for (let i = 0; i < stCount; i++) {
        const pitchMult = 1 + i * 0.25
        const gainMult = 0.5 + i * 0.08
        const tOffset = i * 0.45
        t(() => {
          metalStinger(ctx, now(), master, { freq: 2400 * pitchMult, gain: gainMult, dur: 0.7 })
          glassPing(ctx, now() + 0.02, master, { freq: 5000 * pitchMult, gain: 0.35, dur: 0.4 })
        }, tOffset * 1000)
      }
    }, mainStart)

    // PHASE 4 — RANK PROMOTION
    const promoStart = mainStart + 1400
    t(() => {
      setPhase('promo')
      const arpNotes = [523, 659, 784, 1047, 1319, 1568, 2093, 2637]
      arp(ctx, now(), master, { notes: arpNotes.slice(0, 5 + tier.stopStep), step: 0.06, gain: 0.16 })

      const rankDelta = tier.rankFrom - tier.rankTo
      const rtDelta = tier.promoTo - tier.promoFrom
      const countDur = 1600
      const steps = 30
      for (let i = 1; i <= steps; i++) {
        const p = i / steps
        const ease = 1 - Math.pow(1 - p, 3)
        t(() => {
          setPromoRank(Math.round(tier.rankFrom - rankDelta * ease))
          setPromoRating(Math.round(tier.promoFrom + rtDelta * ease))
          if (i % 4 === 0) {
            glassPing(ctx, now() + 0.01, master, { freq: 6000 + i * 100, gain: 0.2, dur: 0.15 })
          }
        }, (i / steps) * countDur)
      }

      if (tier.key === 'godlike') {
        t(() => {
          metalStinger(ctx, now(), master, { freq: 3500, gain: 0.6, dur: 0.8 })
          metalStinger(ctx, now(), master, { freq: 7000, gain: 0.35, dur: 0.3 })
        }, 800)
        t(() => {
          arp(ctx, now(), master, { notes: [784, 988, 1175, 1568, 1975, 2349, 2960], step: 0.05, gain: 0.15 })
        }, 1200)
      }
    }, promoStart)

    // OUTRO
    t(() => setPhase('outro'), tier.totalDur - 600)
    t(() => onDone?.(), tier.totalDur)

    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      document.body.classList.remove('ws-active')
    }
  }, [tier, onDone])

  const curColor = COLOR_STEPS[colorIdx] || COLOR_STEPS[0]
  const isBurst = phase === 'burst' || phase === 'main' || phase === 'promo'
  const isMain = phase === 'main' || phase === 'promo'
  const showPromo = phase === 'promo'
  const showHold = phase === 'hold'
  const tierGlow = tier.glow
  const isRainbow = tier.key === 'godlike'

  const holdBg = colorIdx === 5
    ? 'linear-gradient(90deg,#ff3355,#ffaa00,#ffee00,#00ff88,#00aaff,#aa00ff,#ff00aa)'
    : curColor.color

  return (
    <div
      className={`ws-root ws-tier-${tier.key}${phase === 'outro' ? ' ws-fade-out' : ''}`}
      role="presentation"
      style={{ '--tier-glow': tierGlow } as React.CSSProperties}
    >
      <div className="ws-backdrop" />
      <div className="ws-scan" />
      <div className="ws-vignette" />
      <div className={`ws-heartbeat${showHold ? ' active' : ''}`} />

      {/* HOLD GAUGE */}
      {showHold && (
        <>
          <div className="ws-hold" style={{ '--hold-color': colorIdx === 5 ? '#FF00AA' : curColor.color } as React.CSSProperties}>
            <div
              className="ws-hold-fill"
              style={{
                width: gaugePct + '%',
                background: holdBg,
                boxShadow: `0 0 60px ${curColor.color}, inset 0 0 30px rgba(255,255,255,0.4)`,
              }}
            />
            <div className="ws-hold-label">{curColor.name} · HOLD</div>
            <div
              className="ws-hold-ping"
              key={colorIdx}
              style={{ borderColor: curColor.color, boxShadow: `0 0 20px ${curColor.color}` }}
            />
          </div>
          <div className="ws-levels">
            {COLOR_STEPS.slice(0, Math.max(5, tier.stopStep + 1)).map((s, i) => (
              <div
                key={i}
                className={`ws-level-chip${i <= colorIdx ? ' on' : ''}${i === colorIdx ? ' current' : ''}`}
                style={{ '--chip-color': i === 5 ? '#FF00AA' : s.color, background: i <= colorIdx ? (i === 5 ? '#FF00AA' : s.color) : undefined } as React.CSSProperties}
              />
            ))}
          </div>
        </>
      )}

      {/* EXPLOSION */}
      <div
        className={`ws-explosion${isBurst ? ' active' : ''}`}
        style={{
          background: isRainbow
            ? 'radial-gradient(circle, #fff 0%, rgba(255,255,255,0.5) 20%, transparent 70%)'
            : `radial-gradient(circle, ${tierGlow} 0%, transparent 70%)`,
        }}
      />
      <div className={`ws-rainbow-burst${isBurst ? ' active' : ''}`} />
      <div className={`ws-ring r1${isBurst ? ' active' : ''}`} style={{ borderColor: tierGlow }} />
      <div className={`ws-ring r2${isBurst ? ' active' : ''}`} />
      <div className={`ws-ring r3${isBurst ? ' active' : ''}`} />

      {/* GLASS SHARDS */}
      <div className="ws-shards">
        {isBurst && shards.map((s) => (
          <span
            key={s.i}
            className="ws-shard active"
            style={{
              left: s.left + '%',
              top: s.top + '%',
              '--tx': s.x + 'px',
              '--ty': s.y + 'px',
              '--tr': s.rot + 'deg',
              animationDelay: s.delay + 's',
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div className={`ws-frame-edge${isRainbow && isMain ? ' active' : ''}`} />

      {/* MAIN TEXT */}
      <div className={`ws-stage${isMain ? ' active' : ''}`}>
        <div className="ws-stage-inner">
          <div className="ws-eyebrow">{tier.eyebrow}</div>
          <div className={`ws-bigtext ${isRainbow ? 'rainbow' : 'solid'}`}>
            {tier.bigText}
          </div>
          <div className="ws-count">
            W <span className="ws-count-num">{count}</span> IN A ROW
          </div>
          <div className="ws-sub">{tier.sub}</div>
        </div>
      </div>

      {/* RANK PROMOTION */}
      {showPromo && (
        <div className="ws-promo active">
          <div className="ws-promo-label">{PROMO_LABELS[tier.key]}</div>
          <div className="ws-promo-from">{tier.rankFrom}位</div>
          <div className="ws-promo-arrow">▶</div>
          <div className="ws-promo-to">{promoRank}位</div>
          <div className="ws-promo-delta">+{tier.rankFrom - promoRank}</div>
          <div style={{
            gridColumn: '1 / -1',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 13,
            color: 'rgba(255,255,255,0.75)',
            marginTop: 2,
            letterSpacing: '0.1em',
          }}>
            SR {tier.promoFrom} → <span style={{ color: tierGlow, fontWeight: 800 }}>{promoRating}</span>
            <span style={{ color: '#00ff88', marginLeft: 10, fontWeight: 800 }}>(+{promoRating - tier.promoFrom})</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ================================================================
// HOST — listens for custom events
// ================================================================
export function triggerWinStreak(count: number, tier?: TierKey) {
  window.dispatchEvent(new CustomEvent('ascent:winstreak', { detail: { count, tier } }))
}

export default function WinStreakHost() {
  const [state, setState] = useState<{ tierKey: TierKey; count: number; id: number } | null>(null)

  const handleDone = useCallback(() => setState(null), [])

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail
      const count = detail?.count ?? 0
      const forced = detail?.tier as TierKey | undefined
      const tier = forced ? TIERS[forced] : tierFor(count)
      if (!tier) return
      setState({ tierKey: tier.key, count, id: Date.now() })
    }
    window.addEventListener('ascent:winstreak', handler)
    return () => window.removeEventListener('ascent:winstreak', handler)
  }, [])

  if (!state) return null
  return (
    <Celebration
      key={state.id}
      tierKey={state.tierKey}
      count={state.count}
      onDone={handleDone}
    />
  )
}
