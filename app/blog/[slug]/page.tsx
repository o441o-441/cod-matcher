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
  controller_name: string | null
  rating: number | null
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
  reply_to_comment_id: string | null
  reply_to_user_id: string | null
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
  const [replyTo, setReplyTo] = useState<{ commentId: string; userId: string; name: string } | null>(null)
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
          'id, slug, title, body, excerpt, status, author_user_id, tags, controller_name, rating, published_at, created_at, updated_at, view_count'
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
      .select('id, post_id, author_user_id, body, created_at, reply_to_comment_id, reply_to_user_id')
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
      reply_to_comment_id: replyTo?.commentId ?? null,
      reply_to_user_id: replyTo?.userId ?? null,
    })
    setSubmitting(false)

    if (error) {
      console.error('comment insert error:', error)
      showToast(error.message || 'コメント投稿に失敗しました', 'error')
      return
    }

    setCommentBody('')
    setReplyTo(null)
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
        <h1>ASCENT レビュー</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (!post) {
    return (
      <main>
        <h1>ASCENT レビュー</h1>
        <EmptyCard
          title="レビューが見つかりません"
          message="削除されたか、非公開の可能性があります"
        />
        <div className="section row">
          <button onClick={() => router.push('/menu')}>メニュー</button>
          <button onClick={() => router.push('/blog')}>レビュー一覧へ</button>
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
          {post.controller_name && (
            <p style={{ fontSize: '1.1rem' }}>
              {post.controller_name}
              {post.rating != null && (
                <span style={{ marginLeft: 8 }}>
                  {'★'.repeat(post.rating)}{'☆'.repeat(5 - post.rating)}
                </span>
              )}
            </p>
          )}
          <p className="muted">
            閲覧 {post.view_count} / いいね {likeCount} / コメント {commentCount}
          </p>
        </div>
        <div className="row">
          <button
            onClick={handleToggleLike}
            style={{
              fontSize: '1.1rem',
              padding: '10px 24px',
              background: liked
                ? 'linear-gradient(180deg, var(--accent-magenta, #ff2bd6), #c020a8)'
                : 'linear-gradient(180deg, var(--accent-cyan, #00e5ff), var(--accent-strong, #00b3ff))',
              color: '#fff',
              boxShadow: liked ? 'var(--glow-violet)' : 'var(--glow-cyan)',
              fontWeight: 'bold',
            }}
          >
            {liked ? `いいね済み ${likeCount}` : `いいね ${likeCount}`}
          </button>
          <button onClick={() => router.push('/menu')}>メニュー</button>
          <button onClick={() => router.push('/blog')}>レビュー一覧</button>
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
              const isReply = !!c.reply_to_comment_id
              const replyTargetName = c.reply_to_user_id ? commentAuthors[c.reply_to_user_id] || null : null
              return (
                <div
                  key={c.id}
                  className="card"
                  style={isReply ? { marginLeft: 24, borderLeft: '3px solid var(--accent-cyan, #00e5ff)' } : undefined}
                >
                  <p>
                    <strong>
                      {commentAuthors[c.author_user_id] || c.author_user_id}
                    </strong>
                    {replyTargetName && (
                      <span className="muted" style={{ marginLeft: 8 }}>
                        @{replyTargetName} への返信
                      </span>
                    )}
                  </p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div className="row" style={{ gap: 8 }}>
                      <span className="muted">
                        {new Date(c.created_at).toLocaleString('ja-JP')}
                      </span>
                      {currentUserProfileId && (
                        <button
                          onClick={() => setReplyTo({
                            commentId: c.id,
                            userId: c.author_user_id,
                            name: commentAuthors[c.author_user_id] || c.author_user_id,
                          })}
                          style={{ fontSize: '0.8rem' }}
                        >
                          返信
                        </button>
                      )}
                    </div>
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
              <h3>{replyTo ? `@${replyTo.name} に返信` : 'コメントを投稿'}</h3>
              {replyTo && (
                <div className="row" style={{ marginBottom: 8, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    @{replyTo.name} への返信
                  </span>
                  <button
                    onClick={() => setReplyTo(null)}
                    style={{ fontSize: '0.75rem', marginLeft: 8 }}
                  >
                    キャンセル
                  </button>
                </div>
              )}
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={replyTo ? `@${replyTo.name} への返信を入力...` : 'コメントを入力...'}
              />
              <div className="section row" style={{ justifyContent: 'flex-end' }}>
                <button onClick={handleSubmitComment} disabled={submitting}>
                  {submitting ? '送信中...' : replyTo ? '返信' : '投稿'}
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
