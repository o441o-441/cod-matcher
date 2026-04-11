'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || `post-${Date.now()}`

export default function NewBlogPostPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const [loading, setLoading] = useState(true)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [excerpt, setExcerpt] = useState('')
  const [body, setBody] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [status] = useState<'draft' | 'published'>('published')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)

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
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle<{ id: string }>()

      if (!me?.id) {
        showToast('プロフィールが未作成です', 'error')
        router.push('/onboarding')
        return
      }
      setProfileId(me.id)
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTitleChange = (v: string) => {
    setTitle(v)
    if (!slugTouched) setSlug(slugify(v))
  }

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
    if (!profileId) return
    if (!title.trim()) {
      showToast('タイトルを入力してください', 'error')
      return
    }
    if (!body.trim()) {
      showToast('本文を入力してください', 'error')
      return
    }
    const finalSlug = (slug.trim() || slugify(title)).slice(0, 80)

    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    setSubmitting(true)

    // 1日1件チェック
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { count: todayCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_user_id', profileId)
      .gte('created_at', todayStart.toISOString())
    if (todayCount && todayCount >= 1) {
      showToast('1日に投稿できるのは1件までです。明日また投稿してください。', 'error')
      setSubmitting(false)
      return
    }
    const { data, error } = await supabase
      .from('posts')
      .insert({
        slug: finalSlug,
        title: title.trim(),
        body,
        excerpt: excerpt.trim() || null,
        status,
        author_user_id: profileId,
        tags,
        published_at: status === 'published' ? new Date().toISOString() : null,
      })
      .select('slug')
      .single<{ slug: string }>()
    setSubmitting(false)

    if (error) {
      console.error('post insert error:', error)
      if (error.message?.includes('daily post limit')) {
        showToast('1日に投稿できるのは1件までです。明日また投稿してください。', 'error')
      } else {
        showToast(error.message || '投稿に失敗しました', 'error')
      }
      return
    }

    showToast('保存しました', 'success')
    router.push(`/blog/${data.slug}`)
  }

  if (loading) {
    return (
      <main>
        <h1>記事を書く</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>記事を書く</h1>
          <p className="muted">Markdown 形式で記述できます</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/blog')}>キャンセル</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>タイトル</h2>
        <div className="card">
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="記事タイトル"
          />
        </div>
      </div>

      <div className="section card-strong">
        <h2>スラッグ (URL)</h2>
        <div className="card">
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value)
            }}
            placeholder="my-first-post"
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
            placeholder="一覧で表示される短い説明"
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
            placeholder="# 見出し&#10;&#10;本文をここに..."
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
            placeholder="bo7, tips, ranked"
          />
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/blog')}>キャンセル</button>
        <button onClick={handleSubmit} disabled={submitting}>
          {submitting ? '保存中...' : '保存'}
        </button>
      </div>
    </main>
  )
}
