'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type AnnouncementRow = {
  id: string
  title: string
  body: string
  is_active: boolean
  author_user_id: string | null
  created_at: string
  updated_at: string
}

export default function AdminAnnouncementsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [items, setItems] = useState<AnnouncementRow[]>([])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  const fetchItems = async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, is_active, author_user_id, created_at, updated_at')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('fetchItems error:', error)
      showToast(error.message || '取得に失敗しました', 'error')
      return
    }
    setItems((data ?? []) as AnnouncementRow[])
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
    const { error } = await supabase.from('announcements').insert({
      title: title.trim(),
      body: body.trim(),
      is_active: true,
      author_user_id: authUserId,
    })
    setSubmitting(false)
    if (error) {
      console.error('insert error:', error)
      showToast(error.message || '作成に失敗しました', 'error')
      return
    }
    setTitle('')
    setBody('')
    showToast('作成しました', 'success')
    await fetchItems()
  }

  const handleToggleActive = async (row: AnnouncementRow) => {
    const { error } = await supabase
      .from('announcements')
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) {
      console.error('toggle error:', error)
      showToast(error.message || '更新に失敗しました', 'error')
      return
    }
    await fetchItems()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このお知らせを削除しますか?')) return
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) {
      console.error('delete error:', error)
      showToast(error.message || '削除に失敗しました', 'error')
      return
    }
    showToast('削除しました', 'success')
    await fetchItems()
  }

  const startEdit = (row: AnnouncementRow) => {
    setEditingId(row.id)
    setEditTitle(row.title)
    setEditBody(row.body)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditBody('')
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    if (!editTitle.trim() || !editBody.trim()) {
      showToast('タイトルと本文を入力してください', 'error')
      return
    }
    const { error } = await supabase
      .from('announcements')
      .update({
        title: editTitle.trim(),
        body: editBody.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId)
    if (error) {
      console.error('update error:', error)
      showToast(error.message || '更新に失敗しました', 'error')
      return
    }
    showToast('更新しました', 'success')
    cancelEdit()
    await fetchItems()
  }

  if (loading || !authorized) {
    return (
      <main>
        <h1>ASCENT お知らせ管理</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT お知らせ管理</h1>
          <p className="muted">トップページに表示される運営からのお知らせ</p>
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
            placeholder="タイトル"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="本文"
            rows={6}
          />
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
          <EmptyCard title="お知らせはまだありません" message="" />
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
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button onClick={cancelEdit}>キャンセル</button>
                      <button onClick={handleSaveEdit}>保存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 style={{ marginTop: 0 }}>
                      {row.title}{' '}
                      {!row.is_active && (
                        <span className="muted">（非表示）</span>
                      )}
                    </h3>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{row.body}</p>
                    <p className="muted">
                      {new Date(row.created_at).toLocaleString('ja-JP')}
                    </p>
                    <div
                      className="row"
                      style={{ justifyContent: 'flex-end', gap: 8 }}
                    >
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
