'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type PostRow = {
  id: string
  slug: string
  title: string
  body: string
  excerpt: string | null
  status: string
  author_user_id: string
  tags: string[]
  published_at: string | null
  created_at: string
  updated_at: string
  view_count: number
}

type CommentRow = {
  id: string
  post_id: string
  author_user_id: string
  body: string
  created_at: string
}

type ProfileRow = {
  id: string
  display_name: string | null
}

export default function BlogPostPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [post, setPost] = useState<PostRow | null>(null)
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [commentAuthors, setCommentAuthors] = useState<Record<string, string>>({})
  const [currentUserProfileId, setCurrentUserProfileId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [commentCount, setCommentCount] = useState(0)

  useEffect(() => {
    if (!slug) return
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        setCurrentUserProfileId(session.user.id)

        const { data: adminFlag } = await supabase.rpc('is_admin')
        setIsAdmin(!!adminFlag)
      }

      const { data: postRow, error: postErr } = await supabase
        .from('posts')
        .select(
          'id, slug, title, body, excerpt, status, author_user_id, tags, published_at, created_at, updated_at, view_count'
        )
        .eq('slug', slug)
        .maybeSingle<PostRow>()

      if (postErr) {
        console.error('post fetch error:', postErr)
      }

      if (!postRow) {
        setLoading(false)
        return
      }
      setPost(postRow)

      // increment view count
      void supabase.from('posts').update({ view_count: postRow.view_count + 1 }).eq('id', postRow.id)

      // fetch likes
      const { count: lc } = await supabase
        .from('post_likes')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', postRow.id)
      setLikeCount(lc ?? 0)

      if (session?.user) {
        const { data: myLike } = await supabase
          .from('post_likes')
          .select('id')
          .eq('post_id', postRow.id)
          .eq('user_id', session.user.id)
          .maybeSingle()
        setLiked(!!myLike)
      }

      const { data: authorRow } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', postRow.author_user_id)
        .maybeSingle<{ display_name: string | null }>()
      setAuthorName(authorRow?.display_name ?? null)

      await loadComments(postRow.id)
      setLoading(false)
    }

    void Promise.resolve().then(init)
  }, [slug])

  const loadComments = async (postId: string) => {
    const { data, error } = await supabase
      .from('post_comments')
      .select('id, post_id, author_user_id, body, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('comments fetch error:', error)
      return
    }

    const rows = (data ?? []) as CommentRow[]
    setComments(rows)
    setCommentCount(rows.length)

    const authorIds = Array.from(new Set(rows.map((r) => r.author_user_id)))
    if (authorIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', authorIds)
      const map: Record<string, string> = {}
      ;((profs ?? []) as ProfileRow[]).forEach((p) => {
        if (p.display_name) map[p.id] = p.display_name
      })
      setCommentAuthors(map)
    }
  }

  const handleSubmitComment = async () => {
    if (!post) return
    if (!currentUserProfileId) {
      showToast('ログインが必要です', 'error')
      router.push('/login')
      return
    }
    const trimmed = commentBody.trim()
    if (!trimmed) {
      showToast('コメントを入力してください', 'error')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('post_comments').insert({
      post_id: post.id,
      author_user_id: currentUserProfileId,
      body: trimmed,
    })
    setSubmitting(false)

    if (error) {
      console.error('comment insert error:', error)
      showToast(error.message || 'コメント投稿に失敗しました', 'error')
      return
    }

    setCommentBody('')
    showToast('コメントを投稿しました', 'success')
    await loadComments(post.id)
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!post) return
    if (!confirm('このコメントを削除しますか?')) return
    const { error } = await supabase.from('post_comments').delete().eq('id', commentId)
    if (error) {
      console.error('comment delete error:', error)
      showToast(error.message || '削除に失敗しました', 'error')
      return
    }
    showToast('削除しました', 'success')
    await loadComments(post.id)
  }

  const handleToggleLike = async () => {
    if (!post || !currentUserProfileId) {
      showToast('ログインが必要です', 'error')
      return
    }
    if (liked) {
      await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', currentUserProfileId)
      setLiked(false)
      setLikeCount((c) => Math.max(0, c - 1))
    } else {
      const { error } = await supabase.from('post_likes').insert({ post_id: post.id, user_id: currentUserProfileId })
      if (error && error.code !== '23505') {
        showToast('いいねに失敗しました', 'error')
        return
      }
      setLiked(true)
      setLikeCount((c) => c + 1)
    }
  }

  const handleDeletePost = async () => {
    if (!post) return
    if (!confirm('この記事を削除しますか?')) return
    const { error } = await supabase.from('posts').delete().eq('id', post.id)
    if (error) {
      console.error('post delete error:', error)
      showToast(error.message || '削除に失敗しました', 'error')
      return
    }
    showToast('削除しました', 'success')
    router.push('/blog')
  }

  if (loading) {
    return (
      <main>
        <h1>記事</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (!post) {
    return (
      <main>
        <h1>記事</h1>
        <EmptyCard
          title="記事が見つかりません"
          message="削除されたか、非公開の可能性があります"
        />
        <div className="section row">
          <button onClick={() => router.push('/blog')}>ブログ一覧へ</button>
        </div>
      </main>
    )
  }

  const canEdit =
    isAdmin || (currentUserProfileId && currentUserProfileId === post.author_user_id)

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{post.title}</h1>
          <p className="muted">
            <Link href={`/users/${post.author_user_id}`}>
              {authorName || '不明'}
            </Link>{' '}
            ・{' '}
            {post.published_at
              ? new Date(post.published_at).toLocaleString('ja-JP')
              : new Date(post.created_at).toLocaleString('ja-JP')}
            {post.status !== 'published' && '（下書き）'}
          </p>
          {post.tags.length > 0 && (
            <p className="muted">タグ: {post.tags.join(', ')}</p>
          )}
          <p className="muted">
            閲覧 {post.view_count} / いいね {likeCount} / コメント {commentCount}
          </p>
        </div>
        <div className="row">
          <button onClick={handleToggleLike}>
            {liked ? 'いいね済み' : 'いいね'}
          </button>
          <button onClick={() => router.push('/blog')}>ブログ一覧</button>
          {canEdit && (
            <>
              <button onClick={() => router.push(`/blog/${post.slug}/edit`)}>
                編集
              </button>
              <button onClick={handleDeletePost}>削除</button>
            </>
          )}
        </div>
      </div>

      <div className="section card-strong">
        <div className="card markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
        </div>
      </div>

      <div className="section card-strong">
        <h2>コメント</h2>

        {comments.length === 0 ? (
          <EmptyCard title="まだコメントがありません" message="" />
        ) : (
          <div className="stack">
            {comments.map((c) => {
              const canDelete =
                isAdmin ||
                (currentUserProfileId && currentUserProfileId === c.author_user_id)
              return (
                <div key={c.id} className="card">
                  <p>
                    <strong>
                      {commentAuthors[c.author_user_id] || c.author_user_id}
                    </strong>
                  </p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span className="muted">
                      {new Date(c.created_at).toLocaleString('ja-JP')}
                    </span>
                    {canDelete && (
                      <button onClick={() => handleDeleteComment(c.id)}>削除</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="section card">
          {currentUserProfileId ? (
            <>
              <h3>コメントを投稿</h3>
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="コメントを入力..."
              />
              <div className="section row" style={{ justifyContent: 'flex-end' }}>
                <button onClick={handleSubmitComment} disabled={submitting}>
                  {submitting ? '送信中...' : '投稿'}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              コメントするには <Link href="/login">ログイン</Link> してください
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
