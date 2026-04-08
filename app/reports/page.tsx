'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type ReportRow = {
  id: string
  reported_user_id: string
  reported_display_name: string | null
  match_id: string | null
  category: string
  description: string | null
  status: string
  created_at: string
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

const STATUS_LABEL: Record<string, string> = {
  open: '受付中',
  reviewing: '確認中',
  resolved: '対応済み',
  dismissed: '却下',
}

export default function MyReportsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState<ReportRow[]>([])

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      const { data, error } = await supabase.rpc('rpc_list_my_reports')
      if (error) {
        console.error('rpc_list_my_reports error:', error)
      } else {
        setReports((data ?? []) as ReportRow[])
      }
      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <main>
        <h1>通報履歴</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>通報履歴</h1>
          <p className="muted">自分が送信した通報の一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/mypage')}>マイページへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {reports.length === 0 ? (
          <EmptyCard title="通報履歴がありません" message="" />
        ) : (
          <div className="stack">
            {reports.map((r) => (
              <div key={r.id} className="card">
                <p>
                  <strong>対象:</strong> {r.reported_display_name || r.reported_user_id}
                </p>
                <p>
                  <strong>種別:</strong> {CATEGORY_LABEL[r.category] ?? r.category}
                </p>
                <p>
                  <strong>状態:</strong> {STATUS_LABEL[r.status] ?? r.status}
                </p>
                {r.description && (
                  <p>
                    <strong>詳細:</strong> {r.description}
                  </p>
                )}
                <p className="muted">{new Date(r.created_at).toLocaleString('ja-JP')}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
