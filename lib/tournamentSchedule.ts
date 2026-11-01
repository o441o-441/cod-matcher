// ============================================================
// 大会のラウンド別BO・スケジュール目安の共有ロジック
//
// 保存先は tournaments.metadata (jsonb):
//   round_formats: { wf?: 'bo3'|'bo5'|'bo1', lf?: ..., gf?: ... }
//   schedule: ScheduleBlock[]
//
// 所要時間モデル:
//   - BO1=20分 / BO3=40分 / BO5=70分 / BO7=90分
//   - ラウンド内の試合は並行、ラウンド同士は依存関係に従って直列。
//     ダブルエリミは「WB r と LB 2r-3 は並行可、LB 2r-2 は WB r 待ち」
//     という標準の進行順でスロット列を組む (スロット時間 = 含まれる
//     ラウンドのBO時間の最大値)。
// ============================================================

export const BO_MINUTES: Record<string, number> = { bo1: 20, bo3: 40, bo5: 70, bo7: 90 }

export type RoundFormats = { wf?: string; lf?: string; gf?: string }

export type ScheduleBlock = {
  start: string // ISO8601 (+09:00 付きで保存)
  wb_until: number // この日に消化する勝者側ラウンド (0 = なし)
  lb_until: number // 同・敗者側 (シングルエリミでは常に0)
  gf: boolean // グランドファイナル (+リセット) を含むか
}

export type BracketShape = {
  wbRounds: number
  lbRounds: number // シングルエリミは 0
  hasGf: boolean
  gfReset: boolean
}

export type RoundRef = { side: 'wb' | 'lb' | 'gf' | 'gf_reset'; round: number }

// エントリー数 (または定員) からブラケット形状を計算
export function bracketShape(entryCount: number, eliminationType: string, gfReset: boolean): BracketShape {
  let size = 1
  while (size < Math.max(2, entryCount)) size *= 2
  const wbRounds = Math.round(Math.log2(size))
  const isDouble = eliminationType === 'double'
  return {
    wbRounds,
    lbRounds: isDouble ? (wbRounds - 1) * 2 : 0,
    hasGf: isDouble,
    gfReset: isDouble && gfReset,
  }
}

// ラウンドの実効BO (metadata.round_formats の上書きを解決)
export function resolveRoundFormat(ref: RoundRef, shape: BracketShape, base: string, rf: RoundFormats | null | undefined): string {
  const valid = (v: string | undefined) => (v && v in BO_MINUTES ? v : null)
  if (ref.side === 'wb' && ref.round === shape.wbRounds) return valid(rf?.wf) ?? base
  if (ref.side === 'lb' && ref.round === shape.lbRounds) return valid(rf?.lf) ?? base
  if (ref.side === 'gf' || ref.side === 'gf_reset') return valid(rf?.gf) ?? base
  return base
}

export function roundLabel(ref: RoundRef, shape: BracketShape): string {
  if (ref.side === 'gf') return 'グランドファイナル'
  if (ref.side === 'gf_reset') return 'GFリセット'
  if (ref.side === 'wb') {
    if (ref.round === shape.wbRounds) return shape.hasGf ? '勝者側決勝' : '決勝'
    return `勝者側${ref.round}回戦`
  }
  if (ref.round === shape.lbRounds) return '敗者側決勝'
  return `敗者側${ref.round}回戦`
}

// 標準進行順のスロット列 (同一スロット内のラウンドは並行扱い)
export function buildSlots(shape: BracketShape): RoundRef[][] {
  const slots: RoundRef[][] = []
  if (shape.wbRounds >= 1) slots.push([{ side: 'wb', round: 1 }])
  for (let r = 2; r <= shape.wbRounds; r++) {
    const parallel: RoundRef[] = [{ side: 'wb', round: r }]
    const lbOdd = 2 * r - 3
    if (lbOdd >= 1 && lbOdd <= shape.lbRounds) parallel.push({ side: 'lb', round: lbOdd })
    slots.push(parallel)
    const lbEven = 2 * r - 2
    if (lbEven >= 1 && lbEven <= shape.lbRounds) slots.push([{ side: 'lb', round: lbEven }])
  }
  if (shape.hasGf) {
    slots.push([{ side: 'gf', round: 1 }])
    if (shape.gfReset) slots.push([{ side: 'gf_reset', round: 2 }])
  }
  return slots
}

const inBlock = (ref: RoundRef, b: ScheduleBlock): boolean => {
  if (ref.side === 'wb') return ref.round <= b.wb_until
  if (ref.side === 'lb') return ref.round <= b.lb_until
  return b.gf
}

export type BlockEstimate = {
  block: ScheduleBlock
  rounds: RoundRef[] // このブロックで消化するラウンド (進行順)
  minutes: number
  endsAt: Date | null // start が有効な場合のみ
}

export type ScheduleEstimate = {
  blocks: BlockEstimate[]
  uncovered: RoundRef[] // どのブロックにも入っていないラウンド
  totalMinutes: number
}

// 各スロットを「カバーできる最初のブロック」に割り当てて目安時間を出す。
// スロットは進行順なので、前のスロットが未消化のうちは後のスロットを
// 先のブロックに入れない (進行順を保証)。
export function estimateSchedule(
  blocks: ScheduleBlock[],
  shape: BracketShape,
  base: string,
  rf: RoundFormats | null | undefined
): ScheduleEstimate {
  const slots = buildSlots(shape)
  const result: BlockEstimate[] = blocks.map(b => {
    const start = b.start ? new Date(b.start) : null
    return { block: b, rounds: [], minutes: 0, endsAt: start && !isNaN(start.getTime()) ? start : null }
  })
  const uncovered: RoundRef[] = []

  let bi = 0
  for (const slot of slots) {
    // 現在以降のブロックで、このスロットの全ラウンドをカバーできる最初のもの
    let assigned = -1
    for (let j = bi; j < blocks.length; j++) {
      if (slot.every(ref => inBlock(ref, blocks[j]))) { assigned = j; break }
      // カバーできないブロックはスキップして次のブロックへ (進行順維持)
    }
    if (assigned === -1) {
      uncovered.push(...slot)
      continue
    }
    bi = assigned
    const dur = Math.max(...slot.map(ref => BO_MINUTES[resolveRoundFormat(ref, shape, base, rf)] ?? 40))
    result[assigned].rounds.push(...slot)
    result[assigned].minutes += dur
  }

  for (const r of result) {
    if (r.endsAt) r.endsAt = new Date(r.endsAt.getTime() + r.minutes * 60_000)
  }
  return {
    blocks: result,
    uncovered,
    totalMinutes: result.reduce((s, r) => s + r.minutes, 0),
  }
}

export const fmtMinutes = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? (m > 0 ? `${h}時間${m}分` : `${h}時間`) : `${m}分`
}

export const fmtBlockStart = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${youbi}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const fmtTime = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// datetime-local の値 (ブラウザローカル) → +09:00 付きISO文字列
export const localInputToJst = (v: string): string => (v ? `${v}:00+09:00` : '')
// ISO → datetime-local 入力値 (JST表示前提)
export const isoToLocalInput = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
