'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

// ============================================================
// 運営用: ランクマッチ監視ページ
//   - 待機中のキュー / 進行中の試合 / 直近の完了試合を一覧
//   - 不具合のあった試合を無効試合にできる (レート巻き戻し付き)
// データは rpc_admin_ranked_overview (SECURITY DEFINER) で取得。15秒ごと自動更新
// ============================================================

type QueueRow = {
  id: string
  party_size: number
  avg_rating: number
  party_size_bonus: number
  wait_sec: number
  heartbeat_age_sec: number
  members: string | null
}

type TeamInfo = { side: string; effective: number | null; members: string | null }

type ActiveRow = {
  id: string
  status: string
  matched_at: string
  elapsed_sec: number
  banpick_deadline: string | null
  report_deadline: string | null
  teams: TeamInfo[] | null
}

type RecentRow = {
  id: string
  approval_status: string
  completed_at: string | null
  winners: string | null
  teams: { side: string; members: string | null }[] | null
}

type Overview = { queue: QueueRow[]; active: ActiveRow[]; recent: RecentRow[] }

const STATUS_LABEL: Record<string, string> = {
  banpick: 'バンピック中',
  ready: '準備完了待ち',
  in_progress: '試合中',
  report_pending: '報告待ち',
}

const fmtSec = (s: number) => `${Math.floor(s / 60)}分${s % 60}秒`
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '-')

export default function AdminRankedPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [data, setData] = useState<Overview | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [voiding, setVoiding] = useState(false)

  const load = useCallback(async () => {
    const { data: res, error } = await supabase.rpc('rpc_admin_ranked_overview')
    if (error) { showToast('取得に失敗しました: ' + error.message, 'error'); return }
    setData(res as Overview)
    setUpdatedAt(new Date())
  }, [showToast])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }
      const { data: me } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()
      if (!me?.is_admin) { showToast('権限がありません', 'error'); router.push('/menu'); return }
      setAuthorized(true)
      await load()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 15秒ごと自動更新
  useEffect(() => {
    if (!authorized) return
    const iv = setInterval(() => { void load() }, 15000)
    return () => clearInterval(iv)
  }, [authorized, load])

  const handleVoid = async (matchId: string) => {
    const reason = prompt('無効試合にします。理由を入力してください（試合チャットに記録されます）:')
    if (reason === null) return
    if (!confirm('この試合を無効試合にしますか？適用済みのレート変動は巻き戻され、参加者は再キュー可能になります。この操作は取り消せません。')) return
    setVoiding(true)
    const { data: res, error } = await supabase.rpc('rpc_admin_void_match', {
      p_match_id: matchId,
      p_reason: reason.trim() || null,
    })
    setVoiding(false)
    if (error) { showToast('無効化に失敗しました: ' + error.message, 'error'); return }
    const reverted = (res as { reverted_rating_rows?: number } | null)?.reverted_rating_rows ?? 0
    showToast(reverted > 0 ? `無効試合にしました（レート変動${reverted}件を巻き戻し）` : '無効試合にしました（レート変動なし）', 'success')
    await load()
  }

  if (loading || !authorized) {
    return <main><h1>ランクマッチ監視</h1><LoadingCard message="読み込み中..." /></main>
  }

  const queue = data?.queue ?? []
  const active = data?.active ?? []
  const recent = data?.recent ?? []

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>ランクマッチ監視</h1>
          <p className="muted">
            待機・進行中・直近の試合状況（15秒ごと自動更新
            {updatedAt && <span className="mono"> · 最終更新 {updatedAt.toLocaleTimeString('ja-JP')}</span>}）
          </p>
        </div>
        <div className="row">
          <button onClick={() => void load()}>今すぐ更新</button>
          <button onClick={() => router.push('/admin/dashboard')}>ダッシュボードへ</button>
        </div>
      </div>

      {/* 待機中のキュー */}
      <div className="section card-strong">
        <h2>待機中のキュー（{queue.reduce((s, q) => s + q.party_size, 0)}人 / {queue.length}組）</h2>
        {queue.length === 0 ? (
          <EmptyCard title="待機中のパーティはありません" message="" />
        ) : (
          <div className="stack">
            {queue.map(q => (
              <div key={q.id} className="card" style={{ padding: '10px 14px' }}>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge" style={{ fontSize: 10 }}>{q.party_size}人</span>
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 160 }}>{q.members ?? '(不明)'}</span>
                  <span className="mono" style={{ fontSize: 12 }}>AVG {Math.round(q.avg_rating)}{q.party_size_bonus > 0 ? ` (+${q.party_size_bonus})` : ''}</span>
                  <span className="mono" style={{ fontSize: 12, color: q.wait_sec > 300 ? 'var(--amber)' : 'var(--text-soft)' }}>待機 {fmtSec(q.wait_sec)}</span>
                  <span className="mono" style={{ fontSize: 11, color: q.heartbeat_age_sec > 45 ? 'var(--danger)' : 'var(--success)' }}>
                    HB {q.heartbeat_age_sec}秒前
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 進行中の試合 */}
      <div className="section card-strong">
        <h2>進行中の試合（{active.length}件）</h2>
        {active.length === 0 ? (
          <EmptyCard title="進行中の試合はありません" message="" />
        ) : (
          <div className="stack">
            {active.map(m => (
              <div key={m.id} className="card">
                <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge magenta" style={{ fontSize: 10 }}>{STATUS_LABEL[m.status] ?? m.status}</span>
                  <span className="mono" style={{ fontSize: 12 }}>成立から {fmtSec(m.elapsed_sec)}</span>
                  {m.banpick_deadline && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>BAN/PICK締切 {fmtTime(m.banpick_deadline)}</span>
                  )}
                  {m.report_deadline && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>報告自動確定 {fmtTime(m.report_deadline)}</span>
                  )}
                  <span style={{ marginLeft: 'auto' }} className="row">
                    <button onClick={() => router.push(`/match/${m.id}/confirm`)} style={{ fontSize: 12 }}>試合ページ</button>
                    <button onClick={() => void handleVoid(m.id)} disabled={voiding}
                      style={{ fontSize: 12, color: 'var(--danger)', borderColor: 'rgba(255,77,109,0.4)' }}>
                      無効試合にする
                    </button>
                  </span>
                </div>
                <div className="grid grid-2" style={{ marginTop: 8, gap: 8 }}>
                  {(m.teams ?? []).map(t => (
                    <div key={t.side} style={{ fontSize: 12.5, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px' }}>
                      <span className={`side-chip ${t.side}`} style={{ marginRight: 8 }}>{t.side.toUpperCase()}</span>
                      {t.members ?? '(不明)'}
                      {t.effective != null && <span className="mono muted" style={{ marginLeft: 8, fontSize: 11 }}>実効 {Math.round(t.effective)}</span>}
                    </div>
                  ))}
                </div>
                <p className="dim mono" style={{ fontSize: 10, margin: '6px 0 0' }}>{m.id}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 直近の完了試合 */}
      <div className="section card-strong">
        <h2>直近の完了試合（最新10件）</h2>
        {recent.length === 0 ? (
          <EmptyCard title="完了した試合はまだありません" message="" />
        ) : (
          <div className="stack">
            {recent.map(m => (
              <div key={m.id} className="card" style={{ padding: '10px 14px' }}>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  {m.approval_status === 'voided' ? (
                    <span className="badge" style={{ fontSize: 10, background: 'rgba(255,77,109,0.2)', color: 'var(--danger)' }}>無効試合</span>
                  ) : (
                    <span className="badge success" style={{ fontSize: 10 }}>確定</span>
                  )}
                  <span style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>
                    {(m.teams ?? []).map(t => t.members ?? '?').join(' vs ')}
                  </span>
                  {m.approval_status !== 'voided' && m.winners && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--success)' }}>勝: {m.winners}</span>
                  )}
                  <span className="mono dim" style={{ fontSize: 11 }}>{fmtTime(m.completed_at)}</span>
                  {m.approval_status !== 'voided' && (
                    <button onClick={() => void handleVoid(m.id)} disabled={voiding}
                      style={{ fontSize: 11, color: 'var(--danger)', borderColor: 'rgba(255,77,109,0.4)' }}>
                      無効試合にする
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
