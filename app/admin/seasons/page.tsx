'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type SeasonRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
  created_at: string
}

export default function AdminSeasonsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [seasons, setSeasons] = useState<SeasonRow[]>([])

  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')

  const fetchSeasons = async () => {
    const { data } = await supabase
      .from('seasons')
      .select('id, name, start_date, end_date, is_active, created_at')
      .order('start_date', { ascending: false })
    setSeasons((data ?? []) as SeasonRow[])
  }

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }

      const { data: me } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()
      if (!me?.is_admin) { showToast('権限がありません', 'error'); router.push('/menu'); return }

      setAuthorized(true)
      await fetchSeasons()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreate = async () => {
    if (!name.trim() || !startDate || !endDate) {
      showToast('全項目を入力してください', 'error'); return
    }
    setSubmitting(true)
    const { error } = await supabase.from('seasons').insert({
      name: name.trim(), start_date: startDate, end_date: endDate, is_active: false,
    })
    setSubmitting(false)
    if (error) { showToast(error.message || '作成に失敗しました', 'error'); return }
    setName(''); setStartDate(''); setEndDate('')
    showToast('作成しました', 'success')
    await fetchSeasons()
  }

  const handleActivate = async (seasonId: string) => {
    if (!confirm('このシーズンをアクティブにしますか？他のシーズンは非アクティブになります。全プレイヤーのレートが1500にリセットされます。')) return

    await supabase.from('seasons').update({ is_active: false }).neq('id', seasonId)
    await supabase.from('seasons').update({ is_active: true }).eq('id', seasonId)

    const { error } = await supabase.rpc('rpc_admin_reset_ratings')
    if (error) {
      showToast('シーズン切替は成功しましたがレートリセットに失敗しました: ' + error.message, 'error')
    } else {
      showToast('シーズンをアクティブにし、全プレイヤーのレートを1500にリセットしました', 'success')
    }
    await fetchSeasons()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このシーズンを削除しますか？')) return
    await supabase.from('seasons').delete().eq('id', id)
    showToast('削除しました', 'success')
    await fetchSeasons()
  }

  const startEdit = (s: SeasonRow) => {
    setEditingId(s.id); setEditName(s.name)
    setEditStartDate(s.start_date); setEditEndDate(s.end_date)
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim() || !editStartDate || !editEndDate) {
      showToast('全項目を入力してください', 'error'); return
    }
    await supabase.from('seasons').update({
      name: editName.trim(), start_date: editStartDate, end_date: editEndDate,
    }).eq('id', editingId)
    showToast('更新しました', 'success')
    setEditingId(null)
    await fetchSeasons()
  }

  if (loading || !authorized) {
    return <main><h1>ASCENT シーズン管理</h1><LoadingCard message="読み込み中..." /></main>
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT シーズン管理</h1>
          <p className="muted">シーズンの作成・編集・切り替え</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>新規シーズン作成</h2>
        <div className="card stack">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="シーズン名（例: Season 1）" />
          <div className="grid grid-2">
            <div>
              <p className="muted">開始日</p>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <p className="muted">終了日</p>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={handleCreate} disabled={submitting}>{submitting ? '作成中...' : '作成'}</button>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>シーズン一覧</h2>
        {seasons.length === 0 ? (
          <EmptyCard title="シーズンがありません" message="" />
        ) : (
          <div className="stack">
            {seasons.map((s) => (
              <div key={s.id} className="card">
                {editingId === s.id ? (
                  <div className="stack">
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <div className="grid grid-2">
                      <div>
                        <p className="muted">開始日</p>
                        <input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
                      </div>
                      <div>
                        <p className="muted">終了日</p>
                        <input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditingId(null)}>キャンセル</button>
                      <button onClick={handleSaveEdit}>保存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h3 style={{ marginTop: 0 }}>
                          {s.name}
                          {s.is_active && (
                            <span style={{ marginLeft: 8, fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan, #0ff)', color: '#000', fontWeight: 'bold' }}>
                              アクティブ
                            </span>
                          )}
                        </h3>
                        <p className="muted">{s.start_date} 〜 {s.end_date}</p>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 8, gap: 8 }}>
                      {!s.is_active && (
                        <button onClick={() => handleActivate(s.id)} style={{ color: 'var(--accent-cyan)' }}>
                          アクティブにする（レートリセット）
                        </button>
                      )}
                      <button onClick={() => startEdit(s)}>編集</button>
                      {!s.is_active && <button onClick={() => handleDelete(s.id)}>削除</button>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
