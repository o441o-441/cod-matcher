'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'banned_weapon', label: '禁止武器の使用' },
  { value: 'banned_attachment', label: '禁止アタッチメントの使用' },
  { value: 'glitch', label: 'グリッチ使用（スネーク/階段など）' },
  { value: 'cheat', label: 'チート使用疑惑' },
  { value: 'converter', label: 'コンバーター使用（XIM / Cronus 等）' },
  { value: 'afk', label: '試合放棄 / AFK' },
  { value: 'toxic', label: '暴言・嫌がらせ' },
  { value: 'match_fixing', label: '八百長 / 故意敗北' },
  { value: 'false_report', label: '虚偽の試合結果報告' },
  { value: 'other', label: 'その他' },
]

function ReportNewContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { showToast } = useToast()

  const reportedId = params.get('reported') || ''
  const matchId = params.get('match') || ''

  const [loading, setLoading] = useState(true)
  const [reportedName, setReportedName] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      if (!reportedId) {
        showToast('通報対象のユーザーが指定されていません', 'error')
        router.push('/menu')
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', reportedId)
        .maybeSingle<{ display_name: string | null }>()

      setReportedName(data?.display_name ?? null)
      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportedId])

  const handleSubmit = async () => {
    if (!category) {
      showToast('違反種別を選択してください', 'error')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.rpc('rpc_create_report', {
      p_reported_user_id: reportedId,
      p_category: category,
      p_description: description.trim() || null,
      p_match_id: matchId || null,
    })
    setSubmitting(false)

    if (error) {
      console.error('rpc_create_report error:', error)
      showToast(error.message || '通報送信に失敗しました', 'error')
      return
    }

    showToast('通報を送信しました', 'success')
    router.push('/reports')
  }

  if (loading) {
    return (
      <main>
        <h1>通報</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>通報</h1>
          <p className="muted">ルール違反などを運営に通報します</p>
        </div>
        <div className="row">
          <button onClick={() => router.back()}>戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>通報対象</h2>
        <div className="card">
          <p>
            <strong>{reportedName || reportedId}</strong>
          </p>
          {matchId && <p className="muted">関連マッチ ID: {matchId}</p>}
        </div>
      </div>

      <div className="section card-strong">
        <h2>違反種別</h2>
        <div className="card">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">選択してください</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="section card-strong">
        <h2>詳細（任意）</h2>
        <div className="card">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="状況を簡潔に説明してください（任意）"
          />
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={() => router.back()}>キャンセル</button>
        <button onClick={handleSubmit} disabled={submitting}>
          {submitting ? '送信中...' : '通報を送信'}
        </button>
      </div>
    </main>
  )
}

export default function ReportNewPage() {
  return (
    <Suspense
      fallback={
        <main>
          <h1>通報</h1>
          <LoadingCard message="読み込み中..." />
        </main>
      }
    >
      <ReportNewContent />
    </Suspense>
  )
}
