// ============================================================
// ハードポイント地点保持タイムラインの導出ロジック (純関数)
//
// LK動画からサンプリングしたHUD読み取り値 (スコア・試合時間・ヒル残時間)
// から「どのチームが地点に乗れていたか」の推移を導出する。
//
// 原理: HPのスコアは地点保持中に 1pt/秒 で増えるため、
// 累計スコアの増分 = その区間に地点へ乗れていた秒数。
// ポイント(ヒル)の切り替わりは次の優先順で推定する:
//   1. hill  — HUDのヒル残り時間カウントダウンのリセットを検出
//   2. clock — 試合時間の読み取りから60秒境界を計算 (ヒルは60秒固定)
//   3. assumed — 最初にスコアが動いた時刻を起点に60秒ごと
// ============================================================

export const HILL_DURATION_SEC = 60

// マップごとのヒル数 (P1〜Pいくつでループするか)。
// CDLハードポイントは標準4ヒル (例: グリッドロックは P1→P4→P1...)。
// 例外のマップが見つかったらここに追記する
export const DEFAULT_HILL_CYCLE = 4
export const MAP_HILL_CYCLES: Record<string, number> = {
  // 例: 'マップ名': 5,
}

export const hillCycleForMap = (map: string | null | undefined): number =>
  MAP_HILL_CYCLES[(map ?? '').trim()] ?? DEFAULT_HILL_CYCLE

// 通算n本目のヒル → ループ後のポイント番号 (1始まり)
export const hillNoOf = (rotationNo: number, map: string | null | undefined): number =>
  ((rotationNo - 1) % hillCycleForMap(map)) + 1

// Edge Function (hp-video-parse) の1フレーム読み取り結果 + 動画内時刻
export type RawFrameReading = {
  t: number // 動画内の秒
  left: number | null
  right: number | null
  clock: number | null
  hill: number | null
}

// 保存形式 (host/guest にマッピング済み)
export type TimelineSample = {
  t: number
  h: number | null // ホストの累計スコア
  g: number | null // ゲストの累計スコア
  ck: number | null // 試合時間 (秒)
  hl: number | null // ヒル残り時間 (秒)
}

export type Rotation = {
  no: number // 何ポイント目 (1始まり)
  start_t: number
  end_t: number
  host_sec: number
  guest_sec: number
  dead_sec: number // どちらも乗れていない (リスポーン/競り合い) 時間
}

export type RotationMethod = 'hill' | 'clock' | 'assumed'

export type Derived = {
  samples: TimelineSample[]
  rotations: Rotation[]
  method: RotationMethod
  finalHost: number | null
  finalGuest: number | null
}

// 表示用: サンプル間の区間ごとにどちらが乗れていたか
export type Segment = { t0: number; t1: number; holder: 'host' | 'guest' | 'both' | 'none' }

type Pt = { t: number; v: number }

// OCR誤読対策: 累計スコアは単調非減少のはずなので、
// 単調非減少になる最長部分列だけを残す (スパイク/桁誤読を自動排除)
export function cleanMonotonic(pts: Pt[]): Pt[] {
  const n = pts.length
  if (n === 0) return []
  const len: number[] = new Array(n).fill(1)
  const prev: number[] = new Array(n).fill(-1)
  let best = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (pts[j].v <= pts[i].v && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j }
    }
    if (len[i] > len[best]) best = i
  }
  const out: Pt[] = []
  for (let k = best; k >= 0; k = prev[k]) { out.push(pts[k]); if (prev[k] < 0) break }
  return out.reverse()
}

// 片チームぶんの「保持区間」: 隣り合う有効サンプル間のスコア増分を
// その区間に均等に割り付ける
type HoldInterval = { t0: number; t1: number; sec: number }

function holdIntervals(pts: Pt[]): HoldInterval[] {
  const out: HoldInterval[] = []
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].v - pts[i - 1].v
    if (d > 0) out.push({ t0: pts[i - 1].t, t1: pts[i].t, sec: d })
  }
  return out
}

// 任意の時間窓 [w0, w1] 内の保持秒数 (区間を比例配分)
function heldIn(intervals: HoldInterval[], w0: number, w1: number): number {
  let sum = 0
  for (const iv of intervals) {
    const o0 = Math.max(iv.t0, w0)
    const o1 = Math.min(iv.t1, w1)
    if (o1 <= o0) continue
    const dur = iv.t1 - iv.t0
    sum += dur > 0 ? iv.sec * ((o1 - o0) / dur) : iv.sec
  }
  return sum
}

function toPts(readings: RawFrameReading[], pick: (r: RawFrameReading) => number | null): Pt[] {
  const pts: Pt[] = []
  for (const r of readings) {
    const v = pick(r)
    if (v !== null && Number.isFinite(v) && v >= 0) pts.push({ t: r.t, v })
  }
  return pts
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// 試合時間の読み取りから「動画時刻 → ヒル境界」を計算する。
// CDLの試合時間は丸い分 (5:00等) から1秒刻みで進むため、
// 表示時間が60の倍数になる瞬間がヒルの切り替わり。
function clockBoundaries(readings: RawFrameReading[], t0: number, t1: number): { boundaries: number[]; start: number | null } | null {
  const pts = toPts(readings, r => r.clock)
  if (pts.length < 6) return null
  // 隣接ペアの傾きの中央値で カウントダウン(-1) / カウントアップ(+1) を判定
  const slopes: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t
    if (dt > 0 && dt < 30) slopes.push((pts[i].v - pts[i - 1].v) / dt)
  }
  const slope = median(slopes)
  if (slope === null) return null
  const dir = slope < -0.6 && slope > -1.4 ? -1 : slope > 0.6 && slope < 1.4 ? 1 : 0
  if (dir === 0) return null
  // clock(t) ≒ I + dir * t の切片Iを中央値でロバストに推定
  const I = median(pts.map(p => p.v - dir * p.t))
  if (I === null) return null
  const maxClock = Math.max(...pts.map(p => p.v))
  // 試合開始時刻: カウントダウンなら初期値 (丸い分に切り上げ) から逆算
  const initial = dir === -1 ? Math.ceil(maxClock / 60) * 60 : 0
  const start = dir === -1 ? I - initial : -I
  const boundaries: number[] = []
  // clock が 60 の倍数になる動画時刻: t = (60m - I) / dir
  for (let m = 0; m <= 60; m++) {
    const t = (60 * m - I) / dir
    if (t > t0 + 1 && t < t1 - 1) boundaries.push(t)
  }
  boundaries.sort((a, b) => a - b)
  return { boundaries, start }
}

// ヒル残り時間のリセット (大きく増えた瞬間) を境界とみなす
function hillBoundaries(readings: RawFrameReading[]): number[] {
  const pts = toPts(readings, r => (r.hill !== null && r.hill <= 120 ? r.hill : null))
  if (pts.length < 8) return []
  const out: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t
    if (dt <= 0 || dt > 20) continue
    if (pts[i].v - pts[i - 1].v > 15) out.push((pts[i - 1].t + pts[i].t) / 2)
  }
  return out
}

// opts.anchorT: 試合開始位置 (動画秒)。指定された場合はそこを1ポイント目の
// 開始とし、以降60秒ごとに次のポイントとする固定ルールで区切る
// (HUDのヒル残時間・試合時間からの推定は行わない)
export function derive(readings: RawFrameReading[], hostIsLeft: boolean, opts?: { anchorT?: number }): Derived {
  const sortedR = [...readings].sort((a, b) => a.t - b.t)
  const samples: TimelineSample[] = sortedR.map(r => ({
    t: Math.round(r.t * 10) / 10,
    h: hostIsLeft ? r.left : r.right,
    g: hostIsLeft ? r.right : r.left,
    ck: r.clock,
    hl: r.hill,
  }))

  const hostPts = cleanMonotonic(toPts(sortedR, r => (hostIsLeft ? r.left : r.right)))
  const guestPts = cleanMonotonic(toPts(sortedR, r => (hostIsLeft ? r.right : r.left)))
  const finalHost = hostPts.length > 0 ? hostPts[hostPts.length - 1].v : null
  const finalGuest = guestPts.length > 0 ? guestPts[guestPts.length - 1].v : null

  const hostIv = holdIntervals(hostPts)
  const guestIv = holdIntervals(guestPts)
  const allIv = [...hostIv, ...guestIv]
  if (allIv.length === 0 || sortedR.length === 0) {
    return { samples, rotations: [], method: 'assumed', finalHost, finalGuest }
  }

  // 試合のアクティブ範囲: 最初/最後にスコアが動いた区間
  const firstScoreT = Math.min(...allIv.map(iv => iv.t0))
  const lastScoreT = Math.max(...allIv.map(iv => iv.t1))

  let method: RotationMethod = 'assumed'
  let startT: number
  const boundaries: number[] = []

  if (opts?.anchorT !== undefined) {
    // 固定ルール: 指定された試合開始位置から60秒ごと
    startT = opts.anchorT
    method = 'assumed'
    for (let t = startT + HILL_DURATION_SEC; t < lastScoreT - 1; t += HILL_DURATION_SEC) boundaries.push(t)
  } else {
    // ヒル境界の推定 (hill → clock → assumed の順でフォールバック)
    startT = Math.max(sortedR[0].t, firstScoreT - HILL_DURATION_SEC / 2)

    const ck = clockBoundaries(sortedR, startT, lastScoreT)
    if (ck && ck.start !== null && ck.start > sortedR[0].t - 90 && ck.start < firstScoreT + 10) {
      startT = Math.max(sortedR[0].t, ck.start)
    }

    const hb = hillBoundaries(sortedR).filter(t => t > startT + 5 && t < lastScoreT - 1)
    if (hb.length >= 2) {
      method = 'hill'
      boundaries.push(...hb)
    } else if (ck && ck.boundaries.length >= 1) {
      method = 'clock'
      boundaries.push(...ck.boundaries.filter(t => t > startT + 5 && t < lastScoreT - 1))
    } else {
      method = 'assumed'
      for (let t = startT + HILL_DURATION_SEC; t < lastScoreT - 1; t += HILL_DURATION_SEC) boundaries.push(t)
    }
  }

  const edges = [startT, ...boundaries, lastScoreT].sort((a, b) => a - b)
  const rotations: Rotation[] = []
  for (let k = 0; k + 1 < edges.length; k++) {
    const s = edges[k]
    const e = edges[k + 1]
    if (e - s < 5) continue
    const hs = heldIn(hostIv, s, e)
    const gs = heldIn(guestIv, s, e)
    rotations.push({
      no: rotations.length + 1,
      start_t: Math.round(s * 10) / 10,
      end_t: Math.round(e * 10) / 10,
      host_sec: Math.round(hs * 10) / 10,
      guest_sec: Math.round(gs * 10) / 10,
      dead_sec: Math.round(Math.max(0, e - s - hs - gs) * 10) / 10,
    })
  }

  return { samples, rotations, method, finalHost, finalGuest }
}

// 左右どちらがホストかを、確定済みの最終スコアと照合して自動判定する。
// 判定できなければ host_slot (チーム1=HUD左と仮定) にフォールバック。
export function deriveOriented(
  readings: RawFrameReading[],
  game: { host_score: number | null; guest_score: number | null; host_slot: 'team1' | 'team2' | null },
  opts?: { anchorT?: number }
): Derived {
  const prefer = game.host_slot !== 'team2'
  const a = derive(readings, prefer, opts)
  if (game.host_score === null || game.guest_score === null) return a
  const b = derive(readings, !prefer, opts)
  const fit = (d: Derived): number => {
    let s = 0
    if (d.finalHost !== null && game.host_score !== null) s -= Math.abs(d.finalHost - game.host_score)
    if (d.finalGuest !== null && game.guest_score !== null) s -= Math.abs(d.finalGuest - game.guest_score)
    return s
  }
  return fit(b) > fit(a) ? b : a
}

// 保存済みサンプルから表示用の保持セグメントを再構成する
export function segmentsFromSamples(samples: TimelineSample[]): Segment[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const hostPts = cleanMonotonic(sorted.filter(s => s.h !== null).map(s => ({ t: s.t, v: s.h as number })))
  const guestPts = cleanMonotonic(sorted.filter(s => s.g !== null).map(s => ({ t: s.t, v: s.g as number })))
  const hostIv = holdIntervals(hostPts)
  const guestIv = holdIntervals(guestPts)
  if (sorted.length < 2) return []
  const out: Segment[] = []
  for (let i = 1; i < sorted.length; i++) {
    const t0 = sorted[i - 1].t
    const t1 = sorted[i].t
    if (t1 <= t0) continue
    const dur = t1 - t0
    const hs = heldIn(hostIv, t0, t1)
    const gs = heldIn(guestIv, t0, t1)
    const holder: Segment['holder'] =
      hs > dur * 0.25 && gs > dur * 0.25 ? 'both'
        : hs > gs && hs > dur * 0.25 ? 'host'
          : gs > hs && gs > dur * 0.25 ? 'guest'
            : 'none'
    const last = out[out.length - 1]
    if (last && last.holder === holder && Math.abs(last.t1 - t0) < 0.01) last.t1 = t1
    else out.push({ t0, t1, holder })
  }
  return out
}

// サンプルの左右 (host/guest) を入れ替える (保存後の手動修正用)
export function swapSamples(samples: TimelineSample[]): TimelineSample[] {
  return samples.map(s => ({ ...s, h: s.g, g: s.h }))
}

export function swapRotations(rotations: Rotation[]): Rotation[] {
  return rotations.map(r => ({ ...r, host_sec: r.guest_sec, guest_sec: r.host_sec }))
}
