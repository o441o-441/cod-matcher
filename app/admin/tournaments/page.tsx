'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type TournamentRow = {
  id: string
  title: string
  body: string
  event_date: string | null
  event_date_end: string | null
  entry_deadline: string | null
  is_active: boolean
  created_at: string
}

export default function AdminTournamentsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [items, setItems] = useState<TournamentRow[]>([])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventDateEnd, setEventDateEnd] = useState('')
  const [entryDeadline, setEntryDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editEventDate, setEditEventDate] = useState('')
  const [editEventDateEnd, setEditEventDateEnd] = useState('')
  const [editEntryDeadline, setEditEntryDeadline] = useState('')

  const fetchItems = async () => {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, title, body, event_date, event_date_end, entry_deadline, is_active, created_at')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('fetchItems error:', error)
      showToast(error.message || '取得に失敗しました', 'error')
      return
    }
    setItems((data ?? []) as TournamentRow[])
  }

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }
      setAuthUserId(session.user.id)

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
      await fetchItems()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      showToast('タイトルと本文を入力してください', 'error')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('tournaments').insert({
      title: title.trim(),
      body: body.trim(),
      event_date: eventDate || null,
      event_date_end: eventDateEnd || null,
      entry_deadline: entryDeadline || null,
      is_active: true,
      author_user_id: authUserId,
    })
    setSubmitting(false)
    if (error) {
      showToast(error.message || '作成に失敗しました', 'error')
      return
    }
    setTitle('')
    setBody('')
    setEventDate('')
    setEventDateEnd('')
    setEntryDeadline('')
    showToast('作成しました', 'success')
    await fetchItems()
  }

  const handleToggleActive = async (row: TournamentRow) => {
    await supabase
      .from('tournaments')
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    await fetchItems()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この大会告知を削除しますか?')) return
    await supabase.from('tournaments').delete().eq('id', id)
    showToast('削除しました', 'success')
    await fetchItems()
  }

  const startEdit = (row: TournamentRow) => {
    setEditingId(row.id)
    setEditTitle(row.title)
    setEditBody(row.body)
    setEditEventDate(row.event_date ? row.event_date.slice(0, 16) : '')
    setEditEventDateEnd(row.event_date_end ? row.event_date_end.slice(0, 16) : '')
    setEditEntryDeadline(row.entry_deadline ? row.entry_deadline.slice(0, 16) : '')
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim() || !editBody.trim()) {
      showToast('タイトルと本文を入力してください', 'error')
      return
    }
    await supabase
      .from('tournaments')
      .update({
        title: editTitle.trim(),
        body: editBody.trim(),
        event_date: editEventDate || null,
        event_date_end: editEventDateEnd || null,
        entry_deadline: editEntryDeadline || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId)
    showToast('更新しました', 'success')
    cancelEdit()
    await fetchItems()
  }

  if (loading || !authorized) {
    return (
      <main>
        <h1>ASCENT 大会告知管理</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT 大会告知管理</h1>
          <p className="muted">トップページに表示される大会情報</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>新規作成</h2>
        <div className="card stack">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="大会タイトル"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="大会の詳細（ルール、賞品、参加方法など）"
            rows={6}
          />
          <div>
            <p className="muted">応募締切</p>
            <input
              type="datetime-local"
              value={entryDeadline}
              onChange={(e) => setEntryDeadline(e.target.value)}
            />
          </div>
          <div>
            <p className="muted">開催日時（開始）</p>
            <input
              type="datetime-local"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>
          <div>
            <p className="muted">開催日時（終了）</p>
            <input
              type="datetime-local"
              value={eventDateEnd}
              onChange={(e) => setEventDateEnd(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={handleCreate} disabled={submitting}>
              {submitting ? '作成中...' : '作成'}
            </button>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>一覧</h2>
        {items.length === 0 ? (
          <EmptyCard title="大会告知はまだありません" message="" />
        ) : (
          <div className="stack">
            {items.map((row) => (
              <div key={row.id} className="card">
                {editingId === row.id ? (
                  <div className="stack">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={6}
                    />
                    <div>
                      <p className="muted">応募締切</p>
                      <input
                        type="datetime-local"
                        value={editEntryDeadline}
                        onChange={(e) => setEditEntryDeadline(e.target.value)}
                      />
                    </div>
                    <div>
                      <p className="muted">開催日時（開始）</p>
                      <input
                        type="datetime-local"
                        value={editEventDate}
                        onChange={(e) => setEditEventDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <p className="muted">開催日時（終了）</p>
                      <input
                        type="datetime-local"
                        value={editEventDateEnd}
                        onChange={(e) => setEditEventDateEnd(e.target.value)}
                      />
                    </div>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button onClick={cancelEdit}>キャンセル</button>
                      <button onClick={handleSaveEdit}>保存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 style={{ marginTop: 0 }}>
                      {row.title}{' '}
                      {!row.is_active && <span className="muted">（非表示）</span>}
                    </h3>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{row.body}</p>
                    {row.entry_deadline && (
                      <p style={{ color: 'var(--accent-cyan, #00e5ff)', fontWeight: 'bold' }}>
                        応募締切: {new Date(row.entry_deadline).toLocaleString('ja-JP')}
                      </p>
                    )}
                    {row.event_date && (
                      <p style={{ color: 'var(--accent-violet, #8b5cf6)', fontWeight: 'bold' }}>
                        開催: {new Date(row.event_date).toLocaleString('ja-JP')}
                        {row.event_date_end && ` 〜 ${new Date(row.event_date_end).toLocaleString('ja-JP')}`}
                      </p>
                    )}
                    <p className="muted">
                      {new Date(row.created_at).toLocaleString('ja-JP')}
                    </p>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <button onClick={() => handleToggleActive(row)}>
                        {row.is_active ? '非表示にする' : '公開する'}
                      </button>
                      <button onClick={() => startEdit(row)}>編集</button>
                      <button onClick={() => handleDelete(row.id)}>削除</button>
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
