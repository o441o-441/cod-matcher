// ============================================================
// LK動画 (試合録画) からのフレーム抽出 (ブラウザ専用)
//
// 動画はアップロードせず、<video> + <canvas> でローカル処理する。
// HUD読み取り用には画面上部だけを切り出して縮小JPEG化し、
// Edge Function `hp-video-parse` へ送るサイズを抑える。
// ============================================================

export type VideoFrame = { i: number; t: number; data: string }

export function loadVideoFile(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.src = url
    video.onloadedmetadata = () => resolve({ video, url })
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('動画を読み込めませんでした')) }
  })
}

export function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(t, Math.max(0, video.duration - 0.05)))
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) { resolve(); return }
    const timer = setTimeout(() => { cleanup(); reject(new Error('シークがタイムアウトしました')) }, timeoutMs)
    const onSeeked = () => { cleanup(); resolve() }
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', onSeeked) }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = target
  })
}

export type CaptureOpts = {
  cropTopRatio?: number // 上から何割を切り出すか (1 = 全体)
  width?: number // 出力幅 (px)
  quality?: number // JPEG品質
}

// 現在のフレームをJPEG base64 (data:プレフィックスなし) で取得
export function captureJpeg(video: HTMLVideoElement, opts: CaptureOpts = {}): string {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('動画のフレームを取得できませんでした')
  const cropRatio = Math.max(0.05, Math.min(1, opts.cropTopRatio ?? 1))
  const srcH = Math.round(vh * cropRatio)
  const outW = Math.min(opts.width ?? 960, vw)
  const outH = Math.max(1, Math.round(srcH * (outW / vw)))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvasを初期化できませんでした')
  ctx.drawImage(video, 0, 0, vw, srcH, 0, 0, outW, outH)
  const dataUrl = canvas.toDataURL('image/jpeg', opts.quality ?? 0.72)
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

// [startT, endT] を interval 秒間隔でサンプリングしてHUDフレームを抽出
export async function sampleHudFrames(
  video: HTMLVideoElement,
  params: { startT: number; endT: number; interval: number; onProgress?: (done: number, total: number) => void }
): Promise<VideoFrame[]> {
  const { startT, endT, interval, onProgress } = params
  const times: number[] = []
  for (let t = startT; t <= endT; t += interval) times.push(Math.round(t * 10) / 10)
  const frames: VideoFrame[] = []
  for (let i = 0; i < times.length; i++) {
    try {
      await seekTo(video, times[i])
      frames.push({ i, t: times[i], data: captureJpeg(video, { cropTopRatio: 0.38, width: 960, quality: 0.72 }) })
    } catch {
      // シーク失敗したフレームは飛ばす (読み取り欠損として扱われる)
    }
    onProgress?.(i + 1, times.length)
  }
  return frames
}

export function base64ToJpegBlob(b64: string): Blob {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Blob([u8], { type: 'image/jpeg' })
}
