'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ============================================================
// マッチ内からの通報ボタン + 対象プレイヤー選択モーダル
// (バンピック / 試合条件確認 / 結果報告 ページ共通)
//
// 違反種別・証拠動画URL (必須) の入力は既存の /reports/new に任せ、
// ここでは対象プレイヤーの選択と、放置経過などの状況テキストを
// クエリで引き継ぐだけ。状況は通報フォーム側で自動添付される
// ============================================================

export default function MatchAbuseReport({
  matchId,
  members,
  myUserId,
  context,
}: {
  matchId: string
  members: { user_id: string; name: string }[]
  myUserId: string | null
  // クリック時点の状況 (例: 「バンピック中、手番チームが3分12秒無操作」)
  context?: () => string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const targets = members.filter(m => m.user_id !== myUserId)
  if (targets.length === 0) return null
  return (
    <>
      <button type="button" className="btn-ghost btn-sm"
        style={{ color: 'var(--danger)', borderColor: 'rgba(255,77,109,0.35)', fontSize: 11 }}
        onClick={() => setOpen(true)}>
        ⚠ 問題を通報
      </button>
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2600, display: 'grid', placeItems: 'center', padding: 24 }}
          role="dialog" aria-modal="true" aria-label="通報するプレイヤーを選択">
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(6px)' }} />
          <div className="card-strong" style={{ position: 'relative', width: '100%', maxWidth: 420, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>通報するプレイヤーを選択</div>
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 12px' }}>
              次の画面で違反の種類と証拠動画URL（必須）を入力します。この試合のIDと現在の状況（放置時間など）は自動で添付されます。
            </p>
            <div className="stack-sm">
              {targets.map(m => (
                <button key={m.user_id} type="button" className="btn-ghost btn-block" style={{ textAlign: 'left', fontSize: 13 }}
                  onClick={() => {
                    const ctx = context?.() ?? ''
                    router.push(`/reports/new?reported=${m.user_id}&match=${matchId}${ctx ? `&ctx=${encodeURIComponent(ctx)}` : ''}`)
                  }}>
                  {m.name}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost btn-sm btn-block" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  )
}
