'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

export default function EditBlogPostPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const originalSlug = params?.slug
  const { showToast } = useToast()
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [postId, setPostId] = useState<string | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [body, setBody] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [origStatus, setOrigStatus] = useState<'draft' | 'published'>('draft')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!originalSlug) return
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }
      setAuthUserId(session.user.id)

      const { data, error } = await supabase
        .from('posts')
        .select('id, slug, title, body, excerpt, tags, status')
        .eq('slug', originalSlug)
        .maybeSingle<{
          id: string
          slug: string
          title: string
          body: string
          excerpt: string | null
          tags: string[]
          status: 'draft' | 'published'
        }>()

      if (error) console.error('post fetch error:', error)

      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setPostId(data.id)
      setTitle(data.title)
      setSlug(data.slug)
      setExcerpt(data.excerpt ?? '')
      setBody(data.body)
      setTagsText(data.tags.join(', '))
      setStatus(data.status)
      setOrigStatus(data.status)
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalSlug])

  const handleUploadImage = async (file: File) => {
    if (!authUserId) return
    setUploading(true)
    const ext = file.name.split('.').pop() || 'png'
    const path = `${authUserId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('blog-images')
      .upload(path, file, { cacheControl: '3600', upsert: false })
    setUploading(false)

    if (upErr) {
      console.error('upload error:', upErr)
      showToast(upErr.message || '画像アップロードに失敗しました', 'error')
      return
    }

    const { data: pub } = supabase.storage.from('blog-images').getPublicUrl(path)
    const url = pub?.publicUrl
    if (!url) {
      showToast('公開URLの取得に失敗しました', 'error')
      return
    }

    const md = `\n![image](${url})\n`
    const ta = bodyRef.current
    if (ta) {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = body.slice(0, start) + md + body.slice(end)
      setBody(next)
      requestAnimationFrame(() => {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = start + md.length
      })
    } else {
      setBody(body + md)
    }
    showToast('画像を挿入しました', 'success')
  }

  const handleSubmit = async () => {
    if (!postId) return
    if (!title.trim()) {
      showToast('タイトルを入力してください', 'error')
      return
    }
    if (!body.trim()) {
      showToast('本文を入力してください', 'error')
      return
    }

    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const patch: Record<string, unknown> = {
      slug: slug.trim(),
      title: title.trim(),
      body,
      excerpt: excerpt.trim() || null,
      status,
      tags,
      updated_at: new Date().toISOString(),
    }

    if (status === 'published' && origStatus !== 'published') {
      patch.published_at = new Date().toISOString()
    }

    setSubmitting(true)
    const { data, error } = await supabase
      .from('posts')
      .update(patch)
      .eq('id', postId)
      .select('slug')
      .single<{ slug: string }>()
    setSubmitting(false)

    if (error) {
      console.error('post update error:', error)
      showToast(error.message || '更新に失敗しました', 'error')
      return
    }

    showToast('保存しました', 'success')
    router.push(`/blog/${data.slug}`)
  }

  if (loading) {
    return (
      <main>
        <h1>記事を編集</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (notFound) {
    return (
      <main>
        <h1>記事を編集</h1>
        <EmptyCard title="記事が見つかりません" message="" />
        <div className="section row">
          <button onClick={() => router.push('/blog')}>ブログ一覧へ</button>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>記事を編集</h1>
          <p className="muted">Markdown 形式で記述できます</p>
        </div>
        <div className="row">
          <button onClick={() => router.push(`/blog/${originalSlug}`)}>
            キャンセル
          </button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>タイトル</h2>
        <div className="card">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      <div className="section card-strong">
        <h2>スラッグ (URL)</h2>
        <div className="card">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <p className="muted">/blog/{slug || '...'}</p>
        </div>
      </div>

      <div className="section card-strong">
        <h2>抜粋（任意）</h2>
        <div className="card">
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </div>
      </div>

      <div className="section card-strong">
        <h2>本文 (Markdown)</h2>
        <div className="card">
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
          />
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'center' }}
          >
            <label className="muted">
              画像を挿入:{' '}
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleUploadImage(f)
                  e.target.value = ''
                }}
              />
            </label>
            {uploading && <span className="muted">アップロード中...</span>}
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>タグ（カンマ区切り）</h2>
        <div className="card">
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />
        </div>
      </div>

      <div className="section card-strong">
        <h2>公開設定</h2>
        <div className="card">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
          >
            <option value="draft">下書き</option>
            <option value="published">公開</option>
          </select>
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={() => router.push(`/blog/${originalSlug}`)}>
          キャンセル
        </button>
        <button onClick={handleSubmit} disabled={submitting}>
          {submitting ? '保存中...' : '保存'}
        </button>
      </div>
    </main>
  )
}
