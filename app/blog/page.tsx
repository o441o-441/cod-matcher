'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type PostRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  tags: string[]
  published_at: string | null
  created_at: string
  author_user_id: string
  status: string
}

export default function BlogIndexPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [posts, setPosts] = useState<PostRow[]>([])
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setSignedIn(!!session?.user)

      const { data, error } = await supabase
        .from('posts')
        .select(
          'id, slug, title, excerpt, tags, published_at, created_at, author_user_id, status'
        )
        .eq('status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(50)

      if (error) {
        console.error('blog list error:', error)
      } else {
        setPosts((data ?? []) as PostRow[])
      }
      setLoading(false)
    }

    void Promise.resolve().then(init)
  }, [])

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ブログ</h1>
          <p className="muted">コミュニティの記事一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/mypage')}>マイページへ戻る</button>
          {signedIn && (
            <button onClick={() => router.push('/blog/new')}>記事を書く</button>
          )}
        </div>
      </div>

      <div className="section card-strong">
        {loading ? (
          <LoadingCard message="読み込み中..." />
        ) : posts.length === 0 ? (
          <EmptyCard title="まだ記事がありません" message="" />
        ) : (
          <div className="stack">
            {posts.map((p) => (
              <div key={p.id} className="card">
                <h2 style={{ marginTop: 0 }}>
                  <Link href={`/blog/${p.slug}`}>{p.title}</Link>
                </h2>
                {p.excerpt && <p>{p.excerpt}</p>}
                {p.tags.length > 0 && (
                  <p className="muted">タグ: {p.tags.join(', ')}</p>
                )}
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
