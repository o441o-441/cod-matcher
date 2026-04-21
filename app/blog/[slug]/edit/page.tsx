'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CONTROLLER_GROUPS } from '@/lib/controllers'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || `post-${Date.now()}`

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
  const [controllerName, setControllerName] = useState('')
  const [ratingValue, setRatingValue] = useState<number>(0)
  const [excerpt, setExcerpt] = useState('')
  const [body, setBody] = useState('')
  const [status] = useState<'draft' | 'published'>('published')
  const [origStatus, setOrigStatus] = useState<'draft' | 'published'>('published')
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
        .select('id, slug, title, body, excerpt, tags, status, controller_name, rating')
        .eq('slug', originalSlug)
        .maybeSingle<{
          id: string
          slug: string
          title: string
          body: string
          excerpt: string | null
          tags: string[]
          status: 'draft' | 'published'
          controller_name: string | null
          rating: number | null
        }>()

      if (error) console.error('post fetch error:', error)

      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setPostId(data.id)
      setTitle(data.title)
      setControllerName(data.controller_name ?? '')
      setRatingValue(data.rating ?? 0)
      setExcerpt(data.excerpt ?? '')
      setBody(data.body)
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
    if (!controllerName) {
      showToast('コントローラーを選択してください', 'error')
      return
    }
    if (ratingValue < 1 || ratingValue > 5) {
      showToast('評価を選択してください（1〜5）', 'error')
      return
    }
    if (!body.trim()) {
      showToast('本文を入力してください', 'error')
      return
    }

    const finalSlug = slugify(title)

    const patch: Record<string, unknown> = {
      slug: finalSlug,
      title: title.trim(),
      body,
      excerpt: excerpt.trim() || null,
      status,
      tags: [controllerName],
      controller_name: controllerName,
      rating: ratingValue,
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
        <div className="eyebrow">EDIT REVIEW</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Edit</em> Review
        </h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (notFound) {
    return (
      <main>
        <div className="eyebrow">EDIT REVIEW</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Edit</em> Review
        </h1>
        <EmptyCard title="レビューが見つかりません" message="" />
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={() => router.push('/blog')}>レビュー一覧へ</button>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">EDIT REVIEW</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Edit</em> Review
      </h1>
      <p className="muted">Markdown 形式で記述できます</p>

      <div className="section card-strong">
        <div className="sec-title">タイトル</div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="コントローラーレビューのタイトル"
        />
      </div>

      <div className="section card-strong">
        <div className="sec-title">コントローラー</div>
        <select
          value={controllerName}
          onChange={(e) => setControllerName(e.target.value)}
        >
          <option value="">選択してください</option>
          {CONTROLLER_GROUPS.map((g) => (
            <optgroup key={g.manufacturer} label={g.manufacturer}>
              {g.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="section card-strong">
        <div className="sec-title">評価</div>
        <div className="row" style={{ gap: 4 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRatingValue(n)}
              style={{
                fontSize: '1.5rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                boxShadow: 'none',
                color: n <= ratingValue ? 'var(--cyan)' : 'var(--text-dim)',
              }}
            >
              {n <= ratingValue ? '★' : '☆'}
            </button>
          ))}
        </div>
      </div>

      <div className="section card-strong">
        <div className="sec-title">抜粋（任意）</div>
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
      </div>

      <div className="section card-strong">
        <div className="sec-title">本文 (Markdown)</div>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
        />
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
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

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn-ghost" onClick={() => router.push(`/blog/${originalSlug}`)}>
          キャンセル
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '保存中...' : '保存'}
        </button>
      </div>
    </main>
  )
}
