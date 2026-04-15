'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CONTROLLER_GROUPS } from '@/lib/controllers'
import { LoadingCard, EmptyCard } from '@/components/UIState'
import { usePageView } from '@/lib/usePageView'

type PostRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  controller_name: string | null
  rating: number | null
  published_at: string | null
  created_at: string
  author_user_id: string
  status: string
}

function BlogIndexContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialController = searchParams?.get('controller') ?? ''
  const [loading, setLoading] = useState(true)
  const [posts, setPosts] = useState<PostRow[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [filterController, setFilterController] = useState(initialController)

  usePageView('/blog')

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setSignedIn(!!session?.user)

      let query = supabase
        .from('posts')
        .select(
          'id, slug, title, excerpt, controller_name, rating, published_at, created_at, author_user_id, status'
        )
        .eq('status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(50)

      if (filterController) {
        query = query.eq('controller_name', filterController)
      }

      const { data, error } = await query

      if (error) {
        console.error('blog list error:', error)
      } else {
        setPosts((data ?? []) as PostRow[])
      }
      setLoading(false)
    }

    void Promise.resolve().then(init)
  }, [filterController])

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT コントローラーレビュー</h1>
          <p className="muted">コミュニティのレビュー一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/')}>トップページへ戻る</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
          {signedIn && (
            <button onClick={() => router.push('/blog/new')}>レビューを書く</button>
          )}
        </div>
      </div>

      <div className="section row" style={{ alignItems: 'center' }}>
        <span className="muted">コントローラーで絞り込み:</span>
        <select
          value={filterController}
          onChange={(e) => setFilterController(e.target.value)}
        >
          <option value="">すべて</option>
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
        {loading ? (
          <LoadingCard message="読み込み中..." />
        ) : posts.length === 0 ? (
          <EmptyCard title="まだレビューがありません" message="" />
        ) : (
          <div className="stack">
            {posts.map((p) => (
              <div key={p.id} className="card">
                <h2 style={{ marginTop: 0 }}>
                  <Link href={`/blog/${p.slug}`}>{p.title}</Link>
                </h2>
                {p.controller_name && (
                  <p className="muted">
                    {p.controller_name}
                    {p.rating != null && (
                      <span style={{ marginLeft: 8 }}>
                        {'★'.repeat(p.rating)}{'☆'.repeat(5 - p.rating)}
                      </span>
                    )}
                  </p>
                )}
                {p.excerpt && <p>{p.excerpt}</p>}
                <p className="muted">
                  {p.published_at
                    ? new Date(p.published_at).toLocaleString('ja-JP')
                    : new Date(p.created_at).toLocaleString('ja-JP')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

export default function BlogIndexPage() {
  return (
    <Suspense fallback={<main><h1>ASCENT コントローラーレビュー</h1><LoadingCard message="読み込み中..." /></main>}>
      <BlogIndexContent />
    </Suspense>
  )
}
