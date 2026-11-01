'use client'

// ============================================================
// 大会の組み合わせ (シード) 編集 (大会詳細ページ・主催者用)
//
// status='seeding' の間に表示。シード順の並べ替え・シャッフル・保存と、
// 1回戦の対戦カードプレビュー (標準配置: 1vs8, 4vs5, 2vs7, 3vs6...) を提供。
// 「大会開始」でシードを保存してからブラケットを生成する。
// ============================================================

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

export type SeedEntry = { id: string; label: string; rating: number | null }

// 標準ブラケット配置 (1,8,4,5,2,7,3,6 ...) — SQL側の生成と同じ反復倍加法
function bracketPositions(size: number): number[] {
  let positions = [1]
  let cur = 1
  while (cur < size) {
    cur *= 2
    const next: number[] = []
    for (const p of positions) {
      next.push(p)
      next.push(cur + 1 - p)
    }
    positions = next
  }
  return positions
}

export default function TournamentSeedEditor({
  tournamentId,
  initialEntries,
  onStarted,
}: {
  tournamentId: string
  initialEntries: SeedEntry[]
  onStarted: () => void
}) {
  const { showToast } = useToast()
  const [order, setOrder] = useState<SeedEntry[]>(initialEntries)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
    setDirty(true)
  }

  const shuffle = () => {
    const next = [...order]
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    setOrder(next)
    setDirty(true)
  }

  const saveSeeds = async (): Promise<boolean> => {
    const { error } = await supabase.rpc('rpc_tournament_set_seeds', {
      p_tournament_id: tournamentId,
      p_entry_ids: order.map(e => e.id),
    })
    if (error) { showToast(error.message || 'シードの保存に失敗しました', 'error'); return false }
    setDirty(false)
    return true
  }

  const handleSave = async () => {
    setBusy(true)
    const ok = await saveSeeds()
    setBusy(false)
    if (ok) showToast('組み合わせを保存しました', 'success')
  }

  const handleStart = async () => {
    setBusy(true)
    if (!(await saveSeeds())) { setBusy(false); return }
    const { error } = await supabase.rpc('rpc_tournament_generate_bracket', { p_tournament_id: tournamentId })
    setBusy(false)
    if (error) { showToast(error.message || 'ブラケット生成に失敗しました', 'error'); return }
    showToast('ブラケットを生成して大会を開始しました', 'success')
    onStarted()
  }

  // 1回戦プレビュー
  const preview = useMemo(() => {
    let size = 1
    while (size < Math.max(2, order.length)) size *= 2
    const positions = bracketPositions(size)
    const pairs: { a: string; b: string }[] = []
    for (let i = 0; i < size; i += 2) {
      const sa = positions[i]
      const sb = positions[i + 1]
      pairs.push({
        a: sa <= order.length ? `#${sa} ${order[sa - 1].label}` : 'BYE',
        b: sb <= order.length ? `#${sb} ${order[sb - 1].label}` : 'BYE',
      })
    }
    return pairs
  }, [order])

  return (
    <div className="section card-strong" style={{ borderLeft: '3px solid var(--amber)' }}>
      <div className="rowx">
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>組み合わせの確認・調整</h2>
        <button className="btn-ghost btn-sm" onClick={shuffle} disabled={busy}>🔀 シャッフル</button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        シード順を並べ替えて組み合わせを調整できます（#1 と #2 は決勝まで当たりません）。
        「大会開始」でこの組み合わせのままブラケットが生成されます。
      </p>

      <div className="grid-2" style={{ gap: 14 }}>
        {/* シード順リスト */}
        <div className="stack" style={{ gap: 6 }}>
          {order.map((e, i) => (
            <div key={e.id} className="card" style={{ padding: '8px 12px' }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="mono" style={{ width: 34, fontWeight: 800, color: 'var(--amber)' }}>#{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{e.label}</span>
                {e.rating !== null && <span className="mono muted" style={{ fontSize: 11 }}>SR {e.rating}</span>}
                <button className="btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label="上へ">↑</button>
                <button className="btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => move(i, 1)} disabled={busy || i === order.length - 1} aria-label="下へ">↓</button>
              </div>
            </div>
          ))}
        </div>

        {/* 1回戦プレビュー */}
        <div>
          <div className="stat-label" style={{ marginBottom: 6 }}>1回戦の対戦カード</div>
          <div className="stack" style={{ gap: 6 }}>
            {preview.map((p, i) => (
              <div key={i} className="card" style={{ padding: '8px 12px', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{p.a}</span>
                <span className="muted" style={{ margin: '0 8px' }}>vs</span>
                <span style={{ fontWeight: 600 }}>{p.b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn-ghost" onClick={handleSave} disabled={busy || !dirty}>
          {dirty ? '並び順を保存' : '保存済み'}
        </button>
        <button className="btn-primary" onClick={handleStart} disabled={busy}>
          {busy ? '処理中...' : 'この組み合わせで大会開始'}
        </button>
      </div>
    </div>
  )
}
