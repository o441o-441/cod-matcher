'use client'

// ============================================================
// 大会スケジュール管理 (大会詳細ページ用)
//
// 主催者が「27日21:00から勝者側2回戦・敗者側3回戦まで」のような
// 日程ブロックを設定でき、BO別の所要時間 (BO1=20/BO3=40/BO5=70/BO7=90分)
// から各日の終了目安を自動計算して全員に表示する。
// 保存先: tournaments.metadata.schedule (ロジック: lib/tournamentSchedule.ts)
// 対象: トーナメント形式のみ (リーグのグループステージは対象外)
// ============================================================

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import {
  bracketShape, estimateSchedule, roundLabel,
  fmtMinutes, fmtBlockStart, fmtTime, localInputToJst, isoToLocalInput,
  type ScheduleBlock, type RoundFormats, type RoundRef,
} from '@/lib/tournamentSchedule'

type TournamentLike = {
  id: string
  format: string
  elimination_type: string
  gf_reset: boolean
  match_format: string
  capacity: number
  metadata: { round_formats?: RoundFormats; schedule?: ScheduleBlock[] } | null
}

export default function TournamentSchedule({
  tournament,
  isHost,
  entryCount = 0,
}: {
  tournament: TournamentLike
  isHost: boolean
  // 実エントリー数 (ソロは4人=1チーム換算済みの値)。0 = まだ不明 → 定員で計算
  entryCount?: number
}) {
  const { showToast } = useToast()
  const meta = (tournament.metadata ?? {}) as { round_formats?: RoundFormats; schedule?: ScheduleBlock[] }
  const rf = meta.round_formats ?? null

  // ラウンド数は実エントリー数基準 (定員基準だとエントリーが少ない時に食い違う)
  const baseCount = entryCount >= 2 ? entryCount : tournament.capacity
  const shape = useMemo(
    () => bracketShape(baseCount, tournament.elimination_type, tournament.gf_reset),
    [baseCount, tournament.elimination_type, tournament.gf_reset]
  )

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(meta.schedule ?? [])

  const est = useMemo(
    () => estimateSchedule(blocks, shape, tournament.match_format, rf),
    [blocks, shape, tournament.match_format, rf]
  )

  // 保存済みスケジュールが現在のラウンド数を超えている (エントリー数が
  // 想定より少ない等でブラケットが縮んだ) 場合の注意表示
  const stale = useMemo(
    () => blocks.some(b => b.wb_until > shape.wbRounds || b.lb_until > shape.lbRounds),
    [blocks, shape]
  )

  if (tournament.format !== 'tournament') return null
  if (!isHost && blocks.length === 0) return null

  const roundsText = (rounds: RoundRef[]) => {
    if (rounds.length === 0) return '（消化するラウンドなし）'
    const wb = rounds.filter(r => r.side === 'wb')
    const lb = rounds.filter(r => r.side === 'lb')
    const gf = rounds.filter(r => r.side === 'gf' || r.side === 'gf_reset')
    const parts: string[] = []
    if (wb.length > 0) parts.push(roundLabel(wb[wb.length - 1], shape) + 'まで')
    if (lb.length > 0) parts.push(roundLabel(lb[lb.length - 1], shape) + 'まで')
    if (gf.length > 0) parts.push(gf.length > 1 ? 'グランドファイナル（リセット含む）' : roundLabel(gf[0], shape))
    return parts.join('・')
  }

  const save = async () => {
    for (const b of blocks) {
      if (!b.start) { showToast('各ブロックに開始日時を設定してください', 'error'); return }
      if (b.wb_until === 0 && b.lb_until === 0 && !b.gf) { showToast('ラウンドが選択されていないブロックがあります', 'error'); return }
    }
    const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start))
    setSaving(true)
    const { error } = await supabase
      .from('tournaments')
      .update({ metadata: { ...(tournament.metadata ?? {}), schedule: sorted } })
      .eq('id', tournament.id)
    setSaving(false)
    if (error) { showToast(error.message || 'スケジュールの保存に失敗しました', 'error'); return }
    setBlocks(sorted)
    setEditing(false)
    showToast('スケジュールを保存しました', 'success')
  }

  const updateBlock = (i: number, patch: Partial<ScheduleBlock>) =>
    setBlocks(prev => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  return (
    <div className="card-strong">
      <div className="rowx">
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>スケジュール</h2>
        {isHost && !editing && (
          <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
            {blocks.length === 0 ? 'スケジュールを設定' : '編集'}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        所要時間の目安: BO1=20分 / BO3=40分 / BO5=70分（同時進行の試合は並行、ラウンド進行は直列で計算）
      </p>
      {stale && (
        <p className="danger" style={{ fontSize: 12, marginTop: 4 }}>
          ⚠️ エントリー数 ({baseCount}チーム) に対してラウンド数が変わっています
          （現在: 勝者側{shape.wbRounds}回戦{shape.lbRounds > 0 ? `・敗者側${shape.lbRounds}回戦` : ''}）。
          スケジュールの「どこまで消化」を見直してください
        </p>
      )}

      {!editing ? (
        blocks.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>スケジュールは未設定です</p>
        ) : (
          <div className="stack" style={{ marginTop: 8 }}>
            {est.blocks.map((b, i) => (
              <div key={i} className="card" style={{ padding: '12px 14px' }}>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>DAY {i + 1}</span>
                  <span style={{ fontWeight: 700 }}>{fmtBlockStart(b.block.start)} 〜</span>
                  <span style={{ fontSize: 13 }}>{roundsText(b.rounds)}</span>
                </div>
                {b.rounds.length > 0 && (
                  <div className="muted mono" style={{ fontSize: 11, marginTop: 6 }}>
                    目安 {fmtMinutes(b.minutes)}{b.endsAt ? ` — ${fmtTime(b.endsAt)}頃 終了予定` : ''}
                  </div>
                )}
              </div>
            ))}
            {est.uncovered.length > 0 && (
              <p className="danger" style={{ fontSize: 12, margin: 0 }}>
                ⚠️ スケジュールに入っていないラウンド: {est.uncovered.map(r => roundLabel(r, shape)).join('・')}
              </p>
            )}
          </div>
        )
      ) : (
        <div className="stack" style={{ marginTop: 8 }}>
          {blocks.map((b, i) => (
            <div key={i} className="card" style={{ padding: '12px 14px' }}>
              <div className="rowx">
                <span className="mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>DAY {i + 1}</span>
                <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setBlocks(prev => prev.filter((_, j) => j !== i))}>削除</button>
              </div>
              <div className="grid grid-2" style={{ gap: 8, marginTop: 8 }}>
                <div>
                  <label className="stat-label" style={{ fontSize: 10 }}>開始日時</label>
                  <input
                    type="datetime-local"
                    value={isoToLocalInput(b.start)}
                    onChange={e => updateBlock(i, { start: localInputToJst(e.target.value) })}
                    style={{ marginTop: 4 }}
                  />
                </div>
                <div>
                  <label className="stat-label" style={{ fontSize: 10 }}>勝者側をどこまで消化</label>
                  <select value={b.wb_until} onChange={e => updateBlock(i, { wb_until: Number(e.target.value) })} style={{ marginTop: 4 }}>
                    <option value={0}>なし</option>
                    {Array.from({ length: shape.wbRounds }, (_, r) => r + 1).map(r => (
                      <option key={r} value={r}>{roundLabel({ side: 'wb', round: r }, shape)}まで</option>
                    ))}
                  </select>
                </div>
                {shape.lbRounds > 0 && (
                  <div>
                    <label className="stat-label" style={{ fontSize: 10 }}>敗者側をどこまで消化</label>
                    <select value={b.lb_until} onChange={e => updateBlock(i, { lb_until: Number(e.target.value) })} style={{ marginTop: 4 }}>
                      <option value={0}>なし</option>
                      {Array.from({ length: shape.lbRounds }, (_, r) => r + 1).map(r => (
                        <option key={r} value={r}>{roundLabel({ side: 'lb', round: r }, shape)}まで</option>
                      ))}
                    </select>
                  </div>
                )}
                {shape.hasGf && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={b.gf} onChange={e => updateBlock(i, { gf: e.target.checked })} />
                      グランドファイナル{shape.gfReset ? '（＋リセット）' : ''}を含む
                    </label>
                  </div>
                )}
              </div>
              {(() => {
                const eb = est.blocks[i]
                if (!eb) return null
                return (
                  <div className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
                    このブロック: {eb.rounds.length > 0 ? `${roundsText(eb.rounds)} — 目安 ${fmtMinutes(eb.minutes)}${eb.endsAt ? ` (〜${fmtTime(eb.endsAt)}頃)` : ''}` : '消化するラウンドなし（前のブロックとの重複や順序を確認）'}
                  </div>
                )
              })()}
            </div>
          ))}

          <button
            className="btn-ghost btn-block"
            onClick={() => {
              const last = blocks[blocks.length - 1]
              setBlocks(prev => [...prev, {
                start: '',
                wb_until: last?.wb_until ?? 0,
                lb_until: last?.lb_until ?? 0,
                gf: false,
              }])
            }}
          >
            ＋ 日程ブロックを追加
          </button>

          {est.uncovered.length > 0 && (
            <p className="danger" style={{ fontSize: 12, margin: 0 }}>
              ⚠️ 未割当のラウンド: {est.uncovered.map(r => roundLabel(r, shape)).join('・')}
            </p>
          )}
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            ブラケットは{entryCount >= 2 ? `現在のエントリー${baseCount}チーム基準` : `定員${tournament.capacity}チーム想定`}（勝者側{shape.wbRounds}回戦
            {shape.lbRounds > 0 ? `・敗者側${shape.lbRounds}回戦・GF${shape.gfReset ? '+リセット' : ''}` : ''}）。
            BO: 基本{tournament.match_format.toUpperCase()}
            {rf?.wf ? ` / ${shape.hasGf ? '勝者側決勝' : '決勝'} ${rf.wf.toUpperCase()}` : ''}
            {rf?.lf && shape.lbRounds > 0 ? ` / 敗者側決勝 ${rf.lf.toUpperCase()}` : ''}
            {rf?.gf && shape.hasGf ? ` / GF ${rf.gf.toUpperCase()}` : ''}
          </p>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn-ghost" onClick={() => { setBlocks(meta.schedule ?? []); setEditing(false) }}>キャンセル</button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? '保存中...' : 'スケジュールを保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
