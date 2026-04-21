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

const INSTANT_CATEGORIES = ['cheat', 'converter', 'banned_weapon', 'banned_attachment', 'glitch', 'afk']

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
  const [reportedGameId, setReportedGameId] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isMonitor, setIsMonitor] = useState(false)

  const isInstantCategory = INSTANT_CATEGORIES.includes(category)

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

      const { data: me } = await supabase
        .from('profiles')
        .select('is_monitor')
        .eq('id', session.user.id)
        .maybeSingle<{ is_monitor: boolean | null }>()
      setIsMonitor(!!me?.is_monitor)

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
    if (!reportedGameId.trim()) {
      showToast('通報相手のゲーム内IDを入力してください', 'error')
      return
    }
    if (!evidenceUrl.trim()) {
      showToast('証拠動画URLを入力してください', 'error')
      return
    }

    const fullDescription = `[ゲーム内ID] ${reportedGameId.trim()}\n[証拠動画] ${evidenceUrl.trim()}${description.trim() ? '\n[詳細] ' + description.trim() : ''}`

    setSubmitting(true)

    if (isMonitor && isInstantCategory) {
      const { error } = await supabase.rpc('rpc_monitor_report', {
        p_reported_user_id: reportedId,
        p_category: category,
        p_match_id: matchId || null,
        p_description: fullDescription,
      })
      setSubmitting(false)

      if (error) {
        console.error('rpc_monitor_report error:', error)
        showToast(error.message || '通報送信に失敗しました', 'error')
        return
      }
    } else {
      const { error } = await supabase.rpc('rpc_create_report', {
        p_reported_user_id: reportedId,
        p_category: category,
        p_description: fullDescription,
        p_match_id: matchId || null,
      })
      setSubmitting(false)

      if (error) {
        console.error('rpc_create_report error:', error)
        showToast(error.message || '通報送信に失敗しました', 'error')
        return
      }
    }

    showToast('通報を送信しました', 'success')
    router.push('/reports')
  }

  if (loading) {
    return (
      <main>
        <p className="eyebrow">NEW REPORT</p>
        <h1 className="display"><em>通報</em></h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <p className="eyebrow">NEW REPORT</p>
      <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
        <h1 className="display"><em>通報</em></h1>
        {isMonitor && (
          <span className="badge violet">監視ユーザー</span>
        )}
      </div>
      <p className="muted">ルール違反などを運営に通報します</p>

      <div className="section">
        <p className="sec-title">通報対象</p>
        <div className="card-strong">
          <div className="card">
            <p style={{ margin: 0 }}>
              <strong>{reportedName || reportedId}</strong>
            </p>
            {matchId && <p className="dim mono mt-xs" style={{ fontSize: '0.75rem' }}>関連マッチ ID: {matchId}</p>}
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">違反種別</p>
        <div className="card-strong">
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

      {isMonitor && isInstantCategory && (
        <div className="section">
          <div className="card" style={{ borderColor: 'rgba(255,176,32,0.4)' }}>
            <p style={{ color: 'var(--amber)', margin: 0 }}>
              <strong>注意:</strong> この通報は監視ユーザーとして送信されます。2人目の監視通報で対象者が24時間一時停止されます。
            </p>
          </div>
        </div>
      )}

      <div className="section">
        <p className="sec-title">通報相手のゲーム内ID（必須）</p>
        <div className="card-strong">
          <input
            type="text"
            value={reportedGameId}
            onChange={(e) => setReportedGameId(e.target.value)}
            placeholder="例: Player123#1234567"
          />
        </div>
      </div>

      <div className="section">
        <p className="sec-title">証拠動画URL（必須）</p>
        <div className="card-strong">
          <input
            type="url"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="例: https://youtube.com/watch?v=..."
          />
          <p className="muted mt-xs">YouTube、X（Twitter）、Streamable などの動画URL</p>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">詳細（任意）</p>
        <div className="card-strong">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="状況を簡潔に説明してください（任意）"
          />
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn-ghost" onClick={() => router.back()}>キャンセル</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
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
          <p className="eyebrow">NEW REPORT</p>
          <h1 className="display"><em>通報</em></h1>
          <LoadingCard message="読み込み中..." />
        </main>
      }
    >
      <ReportNewContent />
    </Suspense>
  )
}
