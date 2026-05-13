'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton } from '@/components/UIState'

type TimelinePost = {
  id: string; author_id: string; body: string
  reactions_gg: number; reactions_fire: number; created_at: string
  author_name: string; author_rating: number | null
  my_gg: boolean; my_fire: boolean
}

type Tab = 'all' | 'following' | 'popular' | 'mine'

export default function TimelinePage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [posts, setPosts] = useState<TimelinePost[]>([])
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set())

  const loadFeed = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)
    if (!uid) { router.push('/login'); return }

    // Get follows
    const { data: followData } = await supabase.from('follows').select('followee_id').eq('follower_id', uid)
    const fIds = new Set((followData ?? []).map((f: { followee_id: string }) => f.followee_id))
    setFollowingIds(fIds)

    // Get posts
    const { data: postData } = await supabase
      .from('timeline_posts')
      .select('id, author_id, body, reactions_gg, reactions_fire, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    const rows = (postData ?? []) as { id: string; author_id: string; body: string; reactions_gg: number; reactions_fire: number; created_at: string }[]

    const authorIds = [...new Set(rows.map(r => r.author_id))]
    const { data: profiles } = authorIds.length > 0
      ? await supabase.from('profiles').select('id, display_name, current_rating').in('id', authorIds)
      : { data: [] }
    const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null; current_rating: number | null }) =>
      [p.id, { name: p.display_name ?? '不明', rating: p.current_rating }]))

    const postIds = rows.map(r => r.id)
    const { data: myReactions } = postIds.length > 0
      ? await supabase.from('timeline_reactions').select('post_id, kind').eq('user_id', uid).in('post_id', postIds)
      : { data: [] }
    const myReactionSet = new Set((myReactions ?? []).map((r: { post_id: string; kind: string }) => `${r.post_id}:${r.kind}`))

    setPosts(rows.map(r => ({
      ...r,
      author_name: profileMap.get(r.author_id)?.name ?? '不明',
      author_rating: profileMap.get(r.author_id)?.rating ?? null,
      my_gg: myReactionSet.has(`${r.id}:gg`),
      my_fire: myReactionSet.has(`${r.id}:fire`),
    })))
    setLoading(false)
  }, [router])

  useEffect(() => { void loadFeed() }, [loadFeed])

  useEffect(() => {
    const ch = supabase.channel('timeline-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'timeline_posts' }, () => void loadFeed())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'timeline_posts' }, () => void loadFeed())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [loadFeed])

  // Filtered posts by tab
  const filteredPosts = posts.filter(p => {
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
    setBody('')
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
    if (followingIds.has(targetId)) {
      await supabase.rpc('rpc_unfollow_user', { p_target_id: targetId })
    } else {
      await supabase.rpc('rpc_follow_user', { p_target_id: targetId })
    }
    void loadFeed()
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

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'all', label: 'すべて', count: posts.length },
    { id: 'following', label: 'フォロー中', count: posts.filter(p => followingIds.has(p.author_id)).length },
    { id: 'popular', label: '注目', count: posts.filter(p => (p.reactions_gg + p.reactions_fire) >= 1).length },
    { id: 'mine', label: '自分', count: posts.filter(p => p.author_id === myUserId).length },
  ]

  if (loading) return <main><LoadingSkeleton cards={3} /></main>

  return (
    <main style={{ maxWidth: 680, marginInline: 'auto' }}>
      <div className="eyebrow">TIMELINE</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', marginTop: 6 }}>
        <em>タイムライン</em>
      </h1>

      {/* Composer */}
      <div className="card-strong" style={{ marginTop: 20 }}>
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="いま何してる？" rows={3}
          style={{ resize: 'none', minHeight: 80 }} aria-label="投稿内容" />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <svg width={28} height={28} viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="12" fill="none" stroke="var(--line)" strokeWidth="2" />
              <circle cx="14" cy="14" r="12" fill="none"
                stroke={charOver ? 'var(--danger)' : charPct > 0.9 ? 'var(--amber)' : 'var(--cyan)'}
                strokeWidth="2" strokeDasharray={`${charPct * 75.4} 75.4`}
                strokeLinecap="round" transform="rotate(-90 14 14)" />
            </svg>
            <span className="mono" style={{ fontSize: 12, color: charOver ? 'var(--danger)' : 'var(--text-dim)' }}>{charCount}/280</span>
          </div>
          <button type="button" className="btn-primary btn-sm" onClick={handlePost} disabled={posting || !body.trim() || charOver}>
            {posting ? '投稿中...' : '投稿する'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="row" style={{ gap: 6, marginTop: 18, marginBottom: 14 }}>
        {tabs.map(t => (
          <button key={t.id} type="button" className={`btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)} style={{ minWidth: 70 }}>
            {t.label} <span className="mono" style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="stack" style={{ gap: 0 }}>
        {filteredPosts.length === 0 && (
          <div className="empty" style={{ padding: 40 }}>
            {tab === 'following' ? 'フォロー中のユーザーの投稿はまだありません' :
             tab === 'mine' ? 'まだ投稿していません' :
             tab === 'popular' ? '注目の投稿はまだありません' :
             'まだ投稿がありません。最初の投稿をしてみましょう！'}
          </div>
        )}
        {filteredPosts.map(p => (
          <div key={p.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="avatar" style={{ width: 40, height: 40, fontSize: 14, flexShrink: 0, cursor: 'pointer' }}
                onClick={() => router.push(`/users/${p.author_id}`)}>
                {p.author_name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, cursor: 'pointer' }} onClick={() => router.push(`/users/${p.author_id}`)}>
                    {p.author_name}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>SR {p.author_rating ?? '---'}</span>
                  <span className="muted" style={{ fontSize: 11 }}>· {timeAgo(p.created_at)}</span>

                  {/* Follow / Unfollow / Delete */}
                  {p.author_id === myUserId ? (
                    <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto', color: 'var(--danger)' }}
                      onClick={() => handleDelete(p.id)}>削除</button>
                  ) : (
                    <button type="button" className="btn-ghost btn-sm"
                      style={{ fontSize: 10, padding: '2px 8px', marginLeft: 'auto', color: followingIds.has(p.author_id) ? 'var(--text-dim)' : 'var(--cyan)' }}
                      onClick={() => handleFollow(p.author_id)}>
                      {followingIds.has(p.author_id) ? 'フォロー中' : 'フォロー'}
                    </button>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.body}</p>
                <div className="row" style={{ gap: 16, marginTop: 10 }}>
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
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
