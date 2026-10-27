// ============================================================
// ブラウザ内OCR (Tesseract.js) によるHUDスコア読み取り
//
// AIクレジットを消費しない無料の読み取り方式。ヒル保持推移に
// 必要なのは「画面上部の左右チームの累計スコア」だけなので、
// その2箇所だけを切り出してローカルでOCRする (通信なし)。
//
// スコアの表示位置はHUDレイアウト (解像度・観戦UI) に依存する
// ため、画面中央からのオフセット等をキャリブレーションとして
// 受け取る。値は localStorage に保存して次回も使う。
//
// Tesseract.js は初回利用時にWASMと英語データ (数MB) をCDNから
// 取得する。以降はブラウザキャッシュが効く。
// ============================================================

import type { Worker as TesseractWorker } from 'tesseract.js'

export type HudCalib = {
  cx: number // スコア枠中心の、画面中央からの横オフセット (画面幅比)
  y: number // スコア枠の上端位置 (画面高さ比)
  w: number // スコア枠の幅 (画面幅比)
  h: number // スコア枠の高さ (画面高さ比)
  clockY: number // 残り時間枠の上端位置 (画面高さ比。横は画面中央固定)
  clockW: number // 残り時間枠の幅 (画面幅比)
  clockH: number // 残り時間枠の高さ (画面高さ比)
}

// 観戦HUDの読み取り枠 (固定値)。1920x1080の実機スクリーンショットで実測:
//   左スコア x=820-883 / 右スコア x=1037-1098 (y=60-89)
//   残り時間 x=935-985 (y=36-56)。高さは実機動画での目視確認を経て
//   下方向に広げてある (すぐ下のヒル残り時間 y=58-115 に注意)
export const DEFAULT_CALIB: HudCalib = {
  cx: 0.056, y: 0.05, w: 0.05, h: 0.039,
  clockY: 0.028, clockW: 0.036, clockH: 0.033,
}

const CALIB_STORAGE_KEY = 'hp_ocr_calib_v1'

export function loadCalib(): HudCalib {
  try {
    const raw = localStorage.getItem(CALIB_STORAGE_KEY)
    if (!raw) return DEFAULT_CALIB
    const c = JSON.parse(raw) as Partial<HudCalib>
    const merged = { ...DEFAULT_CALIB, ...c } // 旧バージョンの保存値には残り時間枠が無い
    if (Object.values(merged).every(v => typeof v === 'number' && Number.isFinite(v))) {
      return merged
    }
  } catch { /* 壊れていたら初期値 */ }
  return DEFAULT_CALIB
}

export function saveCalib(c: HudCalib) {
  try { localStorage.setItem(CALIB_STORAGE_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

let workerPromise: Promise<TesseractWorker> | null = null

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import('tesseract.js')
      const w = await mod.createWorker('eng')
      await w.setParameters({
        tessedit_char_whitelist: '0123456789:.', // 残り時間 "4:59" の区切りも読む
        tessedit_pageseg_mode: mod.PSM.SINGLE_LINE,
      })
      return w
    })()
  }
  return workerPromise
}

// OCRエンジン (WASM/言語データのダウンロード含む) を先に温めておく
export async function warmupOcr(): Promise<void> {
  await getWorker()
}

// 指定枠を切り出し、拡大 + 二値化 (明るい文字 → 白地に黒文字) したcanvasを返す
function cropForOcr(video: HTMLVideoElement, box: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const sx = Math.max(0, Math.round(box.x * vw))
  const sy = Math.max(0, Math.round(box.y * vh))
  const sw = Math.max(4, Math.min(vw - sx, Math.round(box.w * vw)))
  const sh = Math.max(4, Math.min(vh - sy, Math.round(box.h * vh)))
  const scale = Math.max(2, Math.ceil(72 / sh)) // 文字高をOCRに十分なサイズへ拡大
  const canvas = document.createElement('canvas')
  canvas.width = sw * scale
  canvas.height = sh * scale
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvasを初期化できませんでした')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  // 二値化: スコア数字は明るい (白/チームカラー) 前提。最大チャンネル値で判定
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(d[i], d[i + 1], d[i + 2])
    const out = v > 150 ? 0 : 255 // 明るい画素=文字 → 黒、それ以外 → 白
    d[i] = out; d[i + 1] = out; d[i + 2] = out; d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

function parseScore(text: string): number | null {
  const m = text.replace(/[^\d]/g, ' ').match(/\d{1,3}/)
  if (!m) return null
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) && n >= 0 && n <= 400 ? n : null
}

// 残り時間 "4:59" を秒に。コロンの誤読 (ピリオド/欠落) にも耐える
function parseClock(text: string): number | null {
  const t = text.replace(/\s+/g, '')
  let m = t.match(/(\d{1,2})[:.](\d{2})/)
  if (!m) m = t.match(/^(\d)(\d{2})$/) // コロンが読めず "459" になったケース
  if (!m) return null
  const sec = parseInt(m[2], 10)
  if (sec >= 60) return null
  const v = parseInt(m[1], 10) * 60 + sec
  return v >= 0 && v <= 600 ? v : null
}

// 現在表示中のフレームから左右チームのスコアとゲーム残り時間をOCRで読み取る
export async function readHudScores(
  video: HTMLVideoElement,
  calib: HudCalib
): Promise<{ left: number | null; right: number | null; clock: number | null }> {
  const worker = await getWorker()
  const boxFor = (side: -1 | 1) => ({
    x: 0.5 + side * calib.cx - calib.w / 2,
    y: calib.y,
    w: calib.w,
    h: calib.h,
  })
  const clockBox = { x: 0.5 - calib.clockW / 2, y: calib.clockY, w: calib.clockW, h: calib.clockH }
  const l = await worker.recognize(cropForOcr(video, boxFor(-1)))
  const r = await worker.recognize(cropForOcr(video, boxFor(1)))
  const c = await worker.recognize(cropForOcr(video, clockBox))
  return {
    left: parseScore(l.data.text ?? ''),
    right: parseScore(r.data.text ?? ''),
    clock: parseClock(c.data.text ?? ''),
  }
}
