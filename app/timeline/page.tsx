'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

type TimelinePost = {
  id: string; author_id: string; body: string
  kind: string; event_kind: string | null; event_value: string | null
  parent_post_id: string | null; quote_post_id: string | null
  replies_count: number; reposts_count: number
  reactions_gg: number; reactions_fire: number; created_at: string
  author_name: string; author_rating: number | null
  my_gg: boolean; my_fire: boolean; my_repost: boolean
  quote?: TimelinePost | null
}

type Tab = 'all' | 'following' | 'popular' | 'mine'

const EVENT_STYLE: Record<string, { glyph: string; label: string }> = {
  winstreak: { glyph: '🔥', label: 'WIN STREAK' },
  first_win: { glyph: '🎉', label: 'FIRST WIN' },
  peak_rating: { glyph: '📈', label: 'PEAK SR' },
  matches_milestone: { glyph: '🏅', label: 'MILESTONE' },
  tier_up: { glyph: '⬆️', label: 'TIER UP' },
  comeback: { glyph: '💪', label: 'COMEBACK' },
  tournament_win: { glyph: '🏆', label: 'CHAMPION' },
}

export default function TimelinePage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [posts, setPosts] = useState<TimelinePost[]>([])
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const [hideEvents, setHideEvents] = useState(false)
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set())
  // Reply/Quote modal
  const [replyTo, setReplyTo] = useState<TimelinePost | null>(null)
  const [quoteTo, setQuoteTo] = useState<TimelinePost | null>(null)
  const [modalBody, setModalBody] = useState('')
  // Thread view
  const [threadParent, setThreadParent] = useState<TimelinePost | null>(null)
  const [threadReplies, setThreadReplies] = useState<TimelinePost[]>([])

  const loadFeed = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)
    if (!uid) { router.push('/login'); return }

    const { data: followData } = await supabase.from('follows').select('followee_id').eq('follower_id', uid)
    setFollowingIds(new Set((followData ?? []).map((f: { followee_id: string }) => f.followee_id)))

    // Top-level posts only (no replies)
    const { data: postData } = await supabase
      .from('timeline_posts')
      .select('id, author_id, body, kind, event_kind, event_value, parent_post_id, quote_post_id, replies_count, reposts_count, reactions_gg, reactions_fire, created_at')
      .is('parent_post_id', null)
      .order('created_at', { ascending: false })
      .limit(100)

    const rows = (postData ?? []) as TimelinePost[]

    // Resolve authors
    const authorIds = [...new Set(rows.map(r => r.author_id))]
    const { data: profiles } = authorIds.length > 0
      ? await supabase.from('profiles').select('id, display_name, current_rating').in('id', authorIds)
      : { data: [] }
    const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null; current_rating: number | null }) =>
      [p.id, { name: p.display_name ?? '不明', rating: p.current_rating }]))

    // My reactions + reposts
    const postIds = rows.map(r => r.id)
    const [{ data: myReactions }, { data: myReposts }] = await Promise.all([
      postIds.length > 0 ? supabase.from('timeline_reactions').select('post_id, kind').eq('user_id', uid).in('post_id', postIds) : Promise.resolve({ data: [] }),
      postIds.length > 0 ? supabase.from('timeline_reposts').select('post_id').eq('user_id', uid).in('post_id', postIds) : Promise.resolve({ data: [] }),
    ])
    const myReactionSet = new Set((myReactions ?? []).map((r: { post_id: string; kind: string }) => `${r.post_id}:${r.kind}`))
    const myRepostSet = new Set((myReposts ?? []).map((r: { post_id: string }) => r.post_id))

    // Resolve quoted posts
    const quoteIds = rows.filter(r => r.quote_post_id).map(r => r.quote_post_id!)
    let quoteMap = new Map<string, TimelinePost>()
    if (quoteIds.length > 0) {
      const { data: quoteData } = await supabase.from('timeline_posts').select('id, author_id, body, kind, event_kind, event_value, created_at').in('id', quoteIds)
      const qAuthorIds = [...new Set(((quoteData ?? []) as { author_id: string }[]).map(q => q.author_id))]
      const { data: qProfiles } = qAuthorIds.length > 0 ? await supabase.from('profiles').select('id, display_name, current_rating').in('id', qAuthorIds) : { data: [] }
      const qProfileMap = new Map((qProfiles ?? []).map((p: { id: string; display_name: string | null; current_rating: number | null }) => [p.id, { name: p.display_name ?? '不明', rating: p.current_rating }]))
      for (const q of (quoteData ?? []) as TimelinePost[]) {
        quoteMap.set(q.id, { ...q, author_name: qProfileMap.get(q.author_id)?.name ?? '不明', author_rating: qProfileMap.get(q.author_id)?.rating ?? null, my_gg: false, my_fire: false, my_repost: false, replies_count: 0, reposts_count: 0, reactions_gg: 0, reactions_fire: 0 })
      }
    }

    setPosts(rows.map(r => ({
      ...r,
      author_name: profileMap.get(r.author_id)?.name ?? '不明',
      author_rating: profileMap.get(r.author_id)?.rating ?? null,
      my_gg: myReactionSet.has(`${r.id}:gg`),
      my_fire: myReactionSet.has(`${r.id}:fire`),
      my_repost: myRepostSet.has(r.id),
      quote: r.quote_post_id ? quoteMap.get(r.quote_post_id) ?? null : null,
    })))
    setLoading(false)
  }, [router])

  useEffect(() => { void loadFeed() }, [loadFeed])

  useEffect(() => {
    const ch = supabase.channel('timeline-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timeline_posts' }, () => void loadFeed())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [loadFeed])

  const filteredPosts = posts.filter(p => {
    if (hideEvents && p.kind === 'event') return false
    if (tab === 'following') return followingIds.has(p.author_id)
    if (tab === 'popular') return (p.reactions_gg + p.reactions_fire) >= 1
    if (tab === 'mine') return p.author_id === myUserId
    return true
  })

  const handlePost = async () => {
    if (!body.trim() || body.length > 280) return
    setPosting(true)
    const { error } = await supabase.rpc('rpc_timeline_create_post', { p_body: body })
    setPosting(false)
    if (error) { showToast(error.message, 'error'); return }
    setBody(''); void loadFeed()
  }

  const handleReply = async () => {
    if (!replyTo || !modalBody.trim() || modalBody.length > 280) return
    setPosting(true)
    const { error } = await supabase.rpc('rpc_timeline_reply', { p_parent_id: replyTo.id, p_body: modalBody })
    setPosting(false)
    if (error) { showToast(error.message, 'error'); return }
    setModalBody(''); setReplyTo(null); showToast('返信しました', 'success'); void loadFeed()
  }

  const handleQuote = async () => {
    if (!quoteTo || !modalBody.trim() || modalBody.length > 280) return
    setPosting(true)
    const { error } = await supabase.rpc('rpc_timeline_quote', { p_quote_id: quoteTo.id, p_body: modalBody })
    setPosting(false)
    if (error) { showToast(error.message, 'error'); return }
    setModalBody(''); setQuoteTo(null); showToast('引用しました', 'success'); void loadFeed()
  }

  const handleRepost = async (postId: string) => {
    await supabase.rpc('rpc_timeline_toggle_repost', { p_post_id: postId })
    void loadFeed()
  }

  const handleReaction = async (postId: string, kind: 'gg' | 'fire') => {
    await supabase.rpc('rpc_timeline_toggle_reaction', { p_post_id: postId, p_kind: kind })
    void loadFeed()
  }

  const handleDelete = async (postId: string) => {
    if (!confirm('この投稿を削除しますか？')) return
    await supabase.rpc('rpc_timeline_delete_post', { p_post_id: postId })
    void loadFeed()
  }

  const handleFollow = async (targetId: string) => {
    if (followingIds.has(targetId)) await supabase.rpc('rpc_unfollow_user', { p_target_id: targetId })
    else await supabase.rpc('rpc_follow_user', { p_target_id: targetId })
    void loadFeed()
  }

  const openThread = async (p: TimelinePost) => {
    setThreadParent(p)
    const { data } = await supabase.from('timeline_posts').select('id, author_id, body, kind, event_kind, event_value, reactions_gg, reactions_fire, created_at')
      .eq('parent_post_id', p.id).order('created_at')
    const replies = (data ?? []) as TimelinePost[]
    const aIds = [...new Set(replies.map(r => r.author_id))]
    const { data: profs } = aIds.length > 0 ? await supabase.from('profiles').select('id, display_name, current_rating').in('id', aIds) : { data: [] }
    const pm = new Map((profs ?? []).map((p: { id: string; display_name: string | null; current_rating: number | null }) => [p.id, { name: p.display_name ?? '不明', rating: p.current_rating }]))
    setThreadReplies(replies.map(r => ({ ...r, author_name: pm.get(r.author_id)?.name ?? '不明', author_rating: pm.get(r.author_id)?.rating ?? null, my_gg: false, my_fire: false, my_repost: false, replies_count: 0, reposts_count: 0, parent_post_id: null, quote_post_id: null })))
  }

  const timeAgo = (d: string) => {
    const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
    if (sec < 60) return `${sec}秒前`
    if (sec < 3600) return `${Math.floor(sec / 60)}分前`
    if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`
    return `${Math.floor(sec / 86400)}日前`
  }

  const charCount = body.length
  const charOver = charCount > 280
  const charPct = Math.min(charCount / 280, 1)
  const modalCharCount = modalBody.length
  const modalCharOver = modalCharCount > 280

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'all', label: 'すべて', count: posts.length },
    { id: 'following', label: 'フォロー中', count: posts.filter(p => followingIds.has(p.author_id)).length },
    { id: 'popular', label: '注目', count: posts.filter(p => (p.reactions_gg + p.reactions_fire) >= 1).length },
    { id: 'mine', label: '自分', count: posts.filter(p => p.author_id === myUserId).length },
  ]

  const renderPost = (p: TimelinePost, compact?: boolean) => (
    <div style={{ padding: compact ? '10px 0' : '16px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="avatar" style={{ width: compact ? 32 : 40, height: compact ? 32 : 40, fontSize: compact ? 12 : 14, flexShrink: 0, cursor: 'pointer' }}
          onClick={() => router.push(`/users/${p.author_id}`)}>
          {p.author_name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: compact ? 13 : 14, cursor: 'pointer' }} onClick={() => router.push(`/users/${p.author_id}`)}>{p.author_name}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>SR {p.author_rating ?? '---'}</span>
            <span className="muted" style={{ fontSize: 11 }}>· {timeAgo(p.created_at)}</span>
            {!compact && p.author_id === myUserId && (
              <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => handleDelete(p.id)}>削除</button>
            )}
            {!compact && p.author_id !== myUserId && (
              <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 'auto', color: followingIds.has(p.author_id) ? 'var(--text-dim)' : 'var(--cyan)' }}
                onClick={() => handleFollow(p.author_id)}>{followingIds.has(p.author_id) ? 'フォロー中' : 'フォロー'}</button>
            )}
          </div>

          {p.kind === 'event' && p.event_kind && EVENT_STYLE[p.event_kind] && (
            <div className={`tl-event ${p.event_kind}`}>
              <div className="tl-event-glyph">{p.event_value || EVENT_STYLE[p.event_kind].glyph}</div>
              <div className="tl-event-body">
                <div className="tl-event-eyebrow">{EVENT_STYLE[p.event_kind].label}</div>
                <div className="tl-event-title">{p.body}</div>
              </div>
            </div>
          )}

          {p.kind !== 'event' && <p style={{ margin: 0, fontSize: compact ? 13 : 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.body}</p>}

          {/* Quoted post */}
          {p.quote && (
            <div className="card" style={{ padding: '10px 14px', marginTop: 8, borderColor: 'rgba(139,92,246,0.3)' }}>
              <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{p.quote.author_name}</span>
                <span className="muted" style={{ fontSize: 10 }}>· {timeAgo(p.quote.created_at)}</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>{p.quote.body}</p>
            </div>
          )}

          {/* Actions */}
          {!compact && (
            <div className="row" style={{ gap: 14, marginTop: 10 }}>
              <button type="button" className="row" onClick={() => openThread(p)}
                style={{ gap: 4, background: 'none', border: 'none', padding: 0, boxShadow: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>
                <span style={{ fontSize: 14 }}>💬</span>
                <span className="mono" style={{ fontSize: 12 }}>{p.replies_count > 0 ? p.replies_count : ''}</span>
              </button>
              <button type="button" className="row" onClick={() => handleRepost(p.id)}
                style={{ gap: 4, background: 'none', border: 'none', padding: 0, boxShadow: 'none', cursor: 'pointer', fontSize: 13, color: p.my_repost ? 'var(--success)' : 'var(--text-dim)', fontWeight: p.my_repost ? 700 : 400, textTransform: 'none', letterSpacing: 0 }}>
                <span style={{ fontSize: 14 }}>🔁</span>
                <span className="mono" style={{ fontSize: 12 }}>{p.reposts_count > 0 ? p.reposts_count : ''}</span>
              </button>
              <button type="button" className="row" onClick={() => { setQuoteTo(p); setModalBody('') }}
                style={{ gap: 4, background: 'none', border: 'none', padding: 0, boxShadow: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>
                <span style={{ fontSize: 14 }}>✍️</span>
              </button>
              <button type="button" className="row" onClick={() => handleReaction(p.id, 'gg')}
                style={{ gap: 4, background: 'none', border: 'none', padding: 0, boxShadow: 'none', cursor: 'pointer', fontSize: 13, color: p.my_gg ? 'var(--cyan)' : 'var(--text-dim)', fontWeight: p.my_gg ? 700 : 400, textTransform: 'none', letterSpacing: 0 }}>
                <span style={{ fontSize: 16 }}>👏</span>
                <span className="mono" style={{ fontSize: 12 }}>{p.reactions_gg > 0 ? p.reactions_gg : ''}</span>
              </button>
              <button type="button" className="row" onClick={() => handleReaction(p.id, 'fire')}
                style={{ gap: 4, background: 'none', border: 'none', padding: 0, boxShadow: 'none', cursor: 'pointer', fontSize: 13, color: p.my_fire ? 'var(--amber)' : 'var(--text-dim)', fontWeight: p.my_fire ? 700 : 400, textTransform: 'none', letterSpacing: 0 }}>
                <span style={{ fontSize: 16 }}>🔥</span>
                <span className="mono" style={{ fontSize: 12 }}>{p.reactions_fire > 0 ? p.reactions_fire : ''}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  return (
    <main style={{ maxWidth: 680, marginInline: 'auto' }}>
      <div className="eyebrow">TIMELINE</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', marginTop: 6 }}><em>タイムライン</em></h1>

      {/* Composer */}
      <div className="card-strong" style={{ marginTop: 20 }}>
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="いま何してる？" rows={3} style={{ resize: 'none', minHeight: 80 }} aria-label="投稿内容" />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <svg width={28} height={28} viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="12" fill="none" stroke="var(--line)" strokeWidth="2" />
              <circle cx="14" cy="14" r="12" fill="none" stroke={charOver ? 'var(--danger)' : charPct > 0.9 ? 'var(--amber)' : 'var(--cyan)'} strokeWidth="2" strokeDasharray={`${charPct * 75.4} 75.4`} strokeLinecap="round" transform="rotate(-90 14 14)" />
            </svg>
            <span className="mono" style={{ fontSize: 12, color: charOver ? 'var(--danger)' : 'var(--text-dim)' }}>{charCount}/280</span>
          </div>
          <button type="button" className="btn-primary btn-sm" onClick={handlePost} disabled={posting || !body.trim() || charOver}>{posting ? '投稿中...' : '投稿する'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="row" style={{ gap: 6, marginTop: 18, marginBottom: 14, justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          {tabs.map(t => (
            <button key={t.id} type="button" className={`btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)} style={{ minWidth: 70 }}>
              {t.label} <span className="mono" style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{t.count}</span>
            </button>
          ))}
        </div>
        <button type="button" className={`btn-sm ${hideEvents ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setHideEvents(h => !h)} style={{ fontSize: 11 }}>
          {hideEvents ? '自動投稿を表示' : '自動投稿を非表示'}
        </button>
      </div>

      {/* Feed */}
      <div className="stack" style={{ gap: 0 }}>
        {filteredPosts.length === 0 && (
          <div className="empty" style={{ padding: 40 }}>
            {tab === 'following' ? 'フォロー中のユーザーの投稿はまだありません' : tab === 'mine' ? 'まだ投稿していません' : tab === 'popular' ? '注目の投稿はまだありません' : 'まだ投稿がありません。最初の投稿をしてみましょう！'}
          </div>
        )}
        {filteredPosts.map(p => <div key={p.id}>{renderPost(p)}</div>)}
      </div>

      {/* Reply modal */}
      {replyTo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }} onClick={() => setReplyTo(null)}>
          <div className="card-strong" style={{ maxWidth: 520, width: '100%', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>返信</h2>
            <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{replyTo.author_name}</span>
                <span className="muted" style={{ fontSize: 11 }}>· {timeAgo(replyTo.created_at)}</span>
              </div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{replyTo.body}</p>
            </div>
            <textarea value={modalBody} onChange={e => setModalBody(e.target.value)} placeholder="返信を入力..." rows={3} style={{ resize: 'none' }} aria-label="返信内容" />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <span className="mono" style={{ fontSize: 12, color: modalCharOver ? 'var(--danger)' : 'var(--text-dim)' }}>{modalCharCount}/280</span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setReplyTo(null)}>キャンセル</button>
                <button type="button" className="btn-primary btn-sm" onClick={handleReply} disabled={posting || !modalBody.trim() || modalCharOver}>{posting ? '送信中...' : '返信する'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quote modal */}
      {quoteTo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }} onClick={() => setQuoteTo(null)}>
          <div className="card-strong" style={{ maxWidth: 520, width: '100%', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>引用</h2>
            <textarea value={modalBody} onChange={e => setModalBody(e.target.value)} placeholder="コメントを追加..." rows={3} style={{ resize: 'none' }} aria-label="引用コメント" />
            <div className="card" style={{ padding: '10px 14px', marginTop: 8, borderColor: 'rgba(139,92,246,0.3)' }}>
              <div className="row" style={{ gap: 6 }}><span style={{ fontWeight: 700, fontSize: 12 }}>{quoteTo.author_name}</span></div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{quoteTo.body.slice(0, 100)}{quoteTo.body.length > 100 ? '...' : ''}</p>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <span className="mono" style={{ fontSize: 12, color: modalCharOver ? 'var(--danger)' : 'var(--text-dim)' }}>{modalCharCount}/280</span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setQuoteTo(null)}>キャンセル</button>
                <button type="button" className="btn-primary btn-sm" onClick={handleQuote} disabled={posting || !modalBody.trim() || modalCharOver}>{posting ? '送信中...' : '引用する'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Thread modal */}
      {threadParent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }} onClick={() => setThreadParent(null)}>
          <div className="card-strong" style={{ maxWidth: 580, width: '100%', maxHeight: '80vh', overflowY: 'auto', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>スレッド</h2>
            {renderPost(threadParent, false)}
            {/* Thread line */}
            <div style={{ borderLeft: '2px solid var(--cyan)', marginLeft: 20, paddingLeft: 20, marginTop: 8 }}>
              {threadReplies.length === 0 && <p className="muted" style={{ fontSize: 12, padding: '12px 0' }}>まだ返信はありません</p>}
              {threadReplies.map(r => <div key={r.id}>{renderPost(r, true)}</div>)}
            </div>
            {/* Reply composer */}
            <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <textarea value={modalBody} onChange={e => setModalBody(e.target.value)} placeholder="返信を入力..." rows={2} style={{ resize: 'none' }} aria-label="返信内容" />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setThreadParent(null)}>閉じる</button>
                <button type="button" className="btn-primary btn-sm" onClick={async () => {
                  if (!modalBody.trim() || modalBody.length > 280) return
                  setPosting(true)
                  const { error } = await supabase.rpc('rpc_timeline_reply', { p_parent_id: threadParent.id, p_body: modalBody })
                  setPosting(false)
                  if (error) { showToast(error.message, 'error'); return }
                  setModalBody(''); void openThread(threadParent); void loadFeed()
                }} disabled={posting || !modalBody.trim() || modalCharOver}>返信する</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
