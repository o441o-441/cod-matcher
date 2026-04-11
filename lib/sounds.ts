let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.3) {
  try {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {
    // Audio not available
  }
}

/** マッチ成立 — 高めの2音チャイム */
export function playMatchFound() {
  playTone(660, 0.15, 'sine', 0.3)
  setTimeout(() => playTone(880, 0.3, 'sine', 0.3), 150)
}

/** バンピック操作 — 短い確認音 */
export function playBanpickAction() {
  playTone(520, 0.1, 'triangle', 0.2)
}

/** 試合結果報告 — 3音の通知 */
export function playReportNotify() {
  playTone(440, 0.12, 'sine', 0.25)
  setTimeout(() => playTone(550, 0.12, 'sine', 0.25), 120)
  setTimeout(() => playTone(660, 0.25, 'sine', 0.25), 240)
}
