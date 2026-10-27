// ============================================================
// スコアボード (リザルト) 画面のピクセル判定 (ブラウザ専用・無料)
//
// CDLのリザルト画面には、チームAとチームBの区切り線が
// 画面横幅ほぼ全域に走る。線の色はゲーム側の設定 (チームカラー/
// 色覚サポート) で変わり得るため、色そのものではなく構造で判定する:
//
//   1. 暗いテーブル背景の中に、横幅の6割以上を占める明るい水平線がある
//   2. 線のすぐ上下 (±4px) は暗い = 細い線 (白文字の行は連続率2割程度で弾かれる)
//   3. 上の線 (チームA帯) と下の線 (チームB帯) の両方がある
//   4. 2本の線は互いに色が異なる (チームA/Bは必ず別色。メニュー等の同色罫線を除外)
//
// 実測値 (1920x1080録画・既定色、640x360縮小後):
//   チームA線 y ≈ 高さの28.9%  連続率1.0  (シアン既定)
//   チームB線 y ≈ 高さの62.2%  連続率1.0  (オレンジ既定)
//   帯内の他の行 (ヘッダー文字など) の連続率は最大0.21
// ============================================================

const DETECT_W = 640
const DETECT_H = 360

// 線を探す帯 (高さ比) と判定に使う横範囲 (幅比)。レイアウト変更に備えて広めます
const TEAM_A_BAND: readonly [number, number] = [0.2, 0.42]
const TEAM_B_BAND: readonly [number, number] = [0.5, 0.74]
const X_RANGE: readonly [number, number] = [0.12, 0.92]

const BRIGHT_V = 90 // これより明るいピクセル (最大チャンネル) を線の一部とみなす
const ROW_MATCH_RATIO = 0.6 // 行内でこの割合以上が明るければ「線」(実測: 線=1.0 / 文字行=0.21)
const NEIGHBOR_DARK_MAX = 0.35 // 線の±4px行の明るい割合がこれ以下 = 細い線 (実測: 0.13)
const NEIGHBOR_DY = 4
const COLOR_DIFF_MIN = 0.15 // 2本の線の色差 (正規化RGBのL1距離)。同色の罫線ペアを除外

type LineHit = { y: number; color: readonly [number, number, number] }

// 1行ぶんの明るいピクセルの割合と平均色
function scanRow(img: ImageData, y: number): { ratio: number; color: readonly [number, number, number] } {
  const { width, data } = img
  const x0 = Math.floor(width * X_RANGE[0])
  const x1 = Math.floor(width * X_RANGE[1])
  let bright = 0
  let n = 0
  let sr = 0
  let sg = 0
  let sb = 0
  for (let x = x0; x < x1; x += 2) {
    const i = (y * width + x) * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    n++
    if (Math.max(r, g, b) > BRIGHT_V) {
      bright++
      sr += r; sg += g; sb += b
    }
  }
  if (n === 0 || bright === 0) return { ratio: 0, color: [0, 0, 0] }
  return { ratio: bright / n, color: [sr / bright, sg / bright, sb / bright] }
}

// 帯の中から「上下が暗い明るい水平線」を探す
function findLineInBand(img: ImageData, band: readonly [number, number]): LineHit | null {
  const h = img.height
  const y0 = Math.floor(h * band[0])
  const y1 = Math.floor(h * band[1])
  for (let y = y0; y <= y1; y++) {
    const row = scanRow(img, y)
    if (row.ratio < ROW_MATCH_RATIO) continue
    const above = scanRow(img, Math.max(0, y - NEIGHBOR_DY))
    const below = scanRow(img, Math.min(h - 1, y + NEIGHBOR_DY))
    if (above.ratio <= NEIGHBOR_DARK_MAX && below.ratio <= NEIGHBOR_DARK_MAX) {
      return { y, color: row.color }
    }
  }
  return null
}

// 正規化RGB (明るさの影響を除いた色味) のL1距離
function colorDiff(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const sa = a[0] + a[1] + a[2] || 1
  const sb = b[0] + b[1] + b[2] || 1
  return (
    Math.abs(a[0] / sa - b[0] / sb) +
    Math.abs(a[1] / sa - b[1] / sb) +
    Math.abs(a[2] / sa - b[2] / sb)
  )
}

// 純関数: この画像はスコアボード (リザルト) 画面か
export function hasScoreboardSignature(img: ImageData): boolean {
  const a = findLineInBand(img, TEAM_A_BAND)
  if (!a) return false
  const b = findLineInBand(img, TEAM_B_BAND)
  if (!b) return false
  return colorDiff(a.color, b.color) >= COLOR_DIFF_MIN
}

// 現在の動画フレームを縮小して判定する。canvas は呼び出し側で
// 使い回せる (スキャン中の大量生成を避ける)
export function readScoreboardSignature(video: HTMLVideoElement, canvas?: HTMLCanvasElement): boolean {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return false
  const cv = canvas ?? document.createElement('canvas')
  cv.width = DETECT_W
  cv.height = DETECT_H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, DETECT_W, DETECT_H)
  return hasScoreboardSignature(ctx.getImageData(0, 0, DETECT_W, DETECT_H))
}
