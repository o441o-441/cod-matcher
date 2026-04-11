'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type AdminReportRow = {
  id: string
  reporter_user_id: string
  reporter_display_name: string | null
  reported_user_id: string
  reported_display_name: string | null
  match_id: string | null
  category: string
  description: string | null
  status: string
  admin_notes: string | null
  created_at: string
  reviewed_at: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  banned_weapon: '禁止武器',
  banned_attachment: '禁止アタッチメント',
  glitch: 'グリッチ使用',
  cheat: 'チート疑惑',
  converter: 'コンバーター使用',
  afk: 'AFK / 試合放棄',
  toxic: '暴言・嫌がらせ',
  match_fixing: '八百長',
  false_report: '虚偽報告',
  other: 'その他',
}

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: '全て' },
  { value: 'open', label: '受付中' },
  { value: 'reviewing', label: '確認中' },
  { value: 'resolved', label: '対応済み' },
  { value: 'dismissed', label: '却下' },
]

export default function AdminReportsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [reports, setReports] = useState<AdminReportRow[]>([])
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  const fetchReports = async (status: string) => {
    const { data, error } = await supabase.rpc('rpc_admin_list_reports', {
      p_status: status || null,
    })
    if (error) {
      console.error('rpc_admin_list_reports error:', error)
      showToast(error.message || '通報一覧の取得に失敗しました', 'error')
      return
    }
    setReports((data ?? []) as AdminReportRow[])
  }

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()

      if (!me?.is_admin) {
        showToast('このページにアクセスする権限がありません', 'error')
        router.push('/menu')
        return
      }

      setAuthorized(true)
      await fetchReports('')
      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFilterChange = async (value: string) => {
    setFilter(value)
    setLoading(true)
    await fetchReports(value)
    setLoading(false)
  }

  const handleStatusUpdate = async (reportId: string, status: string) => {
    setBusyId(reportId)
    const { error } = await supabase.rpc('rpc_admin_update_report', {
      p_report_id: reportId,
      p_status: status,
      p_admin_notes: noteDrafts[reportId] || null,
    })
    setBusyId(null)

    if (error) {
      console.error('rpc_admin_update_report error:', error)
      showToast(error.message || 'ステータス更新に失敗しました', 'error')
      return
    }

    showToast('更新しました', 'success')
    await fetchReports(filter)
  }

  const handleBanUser = async (userId: string, displayName: string | null) => {
    const name = displayName || userId.slice(0, 8)
    if (!confirm(`${name} を BAN しますか？BANされたユーザーはマッチに参加できなくなります。`)) return

    setBusyId(userId)
    const { error } = await supabase.rpc('rpc_admin_ban_user', {
      p_user_id: userId,
      p_ban: true,
    })
    setBusyId(null)

    if (error) {
      console.error('ban error:', error)
      showToast(error.message || 'BAN に失敗しました', 'error')
      return
    }

    showToast(`${name} を BAN しました`, 'success')
    await fetchReports(filter)
  }

  const handleUnbanUser = async (userId: string, displayName: string | null) => {
    const name = displayName || userId.slice(0, 8)
    if (!confirm(`${name} の BAN を解除しますか？`)) return

    setBusyId(userId)
    const { error } = await supabase.rpc('rpc_admin_ban_user', {
      p_user_id: userId,
      p_ban: false,
    })
    setBusyId(null)

    if (error) {
      console.error('unban error:', error)
      showToast(error.message || 'BAN 解除に失敗しました', 'error')
      return
    }

    showToast(`${name} の BAN を解除しました`, 'success')
    await fetchReports(filter)
  }

  if (loading) {
    return (
      <main>
        <h1>通報管理</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (!authorized) {
    return null
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>通報管理</h1>
          <p className="muted">運営者向けの通報対応画面</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>フィルター</h2>
        <div className="row">
          <select value={filter} onChange={(e) => handleFilterChange(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button onClick={() => handleFilterChange(filter)}>再読み込み</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>通報一覧（{reports.length}）</h2>
        {reports.length === 0 ? (
          <EmptyCard title="該当する通報がありません" message="" />
        ) : (
          <div className="stack">
            {reports.map((r) => (
              <div key={r.id} className="card">
                <div className="grid grid-2">
                  <div>
                    <p className="muted">通報者</p>
                    <h3>{r.reporter_display_name || r.reporter_user_id}</h3>
                  </div>
                  <div>
                    <p className="muted">対象</p>
                    <h3>{r.reported_display_name || r.reported_user_id}</h3>
                  </div>
                  <div>
                    <p className="muted">種別</p>
                    <h3>{CATEGORY_LABEL[r.category] ?? r.category}</h3>
                  </div>
                  <div>
                    <p className="muted">状態</p>
                    <h3>{r.status}</h3>
                  </div>
                </div>

                {r.description && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted">詳細</p>
                    <p>{r.description}</p>
                  </div>
                )}

                {r.match_id && (
                  <p className="muted" style={{ marginTop: 8 }}>
                    Match: {r.match_id}
                  </p>
                )}

                <p className="muted" style={{ marginTop: 8 }}>
                  通報日時: {new Date(r.created_at).toLocaleString('ja-JP')}
                  {r.reviewed_at && ` / 対応日時: ${new Date(r.reviewed_at).toLocaleString('ja-JP')}`}
                </p>

                <div style={{ marginTop: 12 }}>
                  <p className="muted">運営メモ</p>
                  <textarea
                    value={noteDrafts[r.id] ?? r.admin_notes ?? ''}
                    onChange={(e) =>
                      setNoteDrafts({ ...noteDrafts, [r.id]: e.target.value })
                    }
                    placeholder="対応の経緯や決定事項を記入"
                  />
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => handleStatusUpdate(r.id, 'reviewing')}
                  >
                    確認中にする
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => handleStatusUpdate(r.id, 'resolved')}
                  >
                    対応済みにする
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => handleStatusUpdate(r.id, 'dismissed')}
                  >
                    却下する
                  </button>
                  <button
                    onClick={() => router.push(`/users/${r.reported_user_id}`)}
                  >
                    対象プロフィール
                  </button>
                  <button
                    disabled={busyId === r.reported_user_id}
                    onClick={() => handleBanUser(r.reported_user_id, r.reported_display_name)}
                    style={{ color: 'var(--danger)' }}
                  >
                    BAN する
                  </button>
                  <button
                    disabled={busyId === r.reported_user_id}
                    onClick={() => handleUnbanUser(r.reported_user_id, r.reported_display_name)}
                  >
                    BAN 解除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
