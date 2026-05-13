'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingSkeleton } from '@/components/UIState'

type FollowUser = { id: string; display_name: string; current_rating: number | null; is_following: boolean }
type Tab = 'following' | 'followers'

export default function FollowsPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const userId = typeof params.id === 'string' ? params.id : ''
  const initialTab = searchParams.get('tab') === 'followers' ? 'followers' : 'following'

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [userName, setUserName] = useState('')
  const [following, setFollowing] = useState<FollowUser[]>([])
  const [followers, setFollowers] = useState<FollowUser[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myFollowingIds, setMyFollowingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const myId = session?.user?.id ?? null
      setMyUserId(myId)

      // User name
      const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle()
      setUserName((prof as { display_name: string | null } | null)?.display_name ?? '不明')

      // Following list
      const { data: fwingData } = await supabase.from('follows').select('followee_id').eq('follower_id', userId)
      const fwingIds = ((fwingData ?? []) as { followee_id: string }[]).map(f => f.followee_id)

      // Followers list
      const { data: fwerData } = await supabase.from('follows').select('follower_id').eq('followee_id', userId)
      const fwerIds = ((fwerData ?? []) as { follower_id: string }[]).map(f => f.follower_id)

      // My follows (for showing follow/unfollow button)
      let myFIds = new Set<string>()
      if (myId) {
        const { data: myF } = await supabase.from('follows').select('followee_id').eq('follower_id', myId)
        myFIds = new Set(((myF ?? []) as { followee_id: string }[]).map(f => f.followee_id))
      }
      setMyFollowingIds(myFIds)

      // Resolve profiles
      const allIds = [...new Set([...fwingIds, ...fwerIds])]
      const { data: profiles } = allIds.length > 0
        ? await supabase.from('profiles').select('id, display_name, current_rating').in('id', allIds)
        : { data: [] }
      const pm = new Map((profiles ?? []).map((p: { id: string; display_name: string | null; current_rating: number | null }) =>
        [p.id, { display_name: p.display_name ?? '不明', current_rating: p.current_rating }]))

      setFollowing(fwingIds.map(id => ({
        id, display_name: pm.get(id)?.display_name ?? '不明',
        current_rating: pm.get(id)?.current_rating ?? null,
        is_following: myFIds.has(id),
      })))
      setFollowers(fwerIds.map(id => ({
        id, display_name: pm.get(id)?.display_name ?? '不明',
        current_rating: pm.get(id)?.current_rating ?? null,
        is_following: myFIds.has(id),
      })))
      setLoading(false)
    }
    void load()
  }, [userId])

  const handleToggleFollow = async (targetId: string) => {
    if (myFollowingIds.has(targetId)) {
      await supabase.rpc('rpc_unfollow_user', { p_target_id: targetId })
      setMyFollowingIds(prev => { const s = new Set(prev); s.delete(targetId); return s })
    } else {
      await supabase.rpc('rpc_follow_user', { p_target_id: targetId })
      setMyFollowingIds(prev => new Set(prev).add(targetId))
    }
    // Update lists
    const updateList = (list: FollowUser[]) => list.map(u => u.id === targetId ? { ...u, is_following: !u.is_following } : u)
    setFollowing(updateList)
    setFollowers(updateList)
  }

  const list = tab === 'following' ? following : followers

  if (loading) return <main><LoadingSkeleton cards={2} /></main>

  return (
    <main style={{ maxWidth: 600, marginInline: 'auto' }}>
      <div className="eyebrow">FOLLOWS</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', marginTop: 6 }}>
        <em>{userName}</em>
      </h1>
      <button type="button" className="btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => router.push(`/users/${userId}`)}>← プロフィールに戻る</button>

      {/* Tabs */}
      <div className="row" style={{ gap: 8, marginTop: 16, marginBottom: 16 }}>
        <button type="button" className={`btn-sm ${tab === 'following' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('following')}>
          フォロー中 <span className="mono" style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{following.length}</span>
        </button>
        <button type="button" className={`btn-sm ${tab === 'followers' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('followers')}>
          フォロワー <span className="mono" style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{followers.length}</span>
        </button>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          {tab === 'following' ? 'まだ誰もフォローしていません' : 'まだフォロワーがいません'}
        </div>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {list.map(u => (
            <div key={u.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 12, cursor: 'pointer' }} onClick={() => router.push(`/users/${u.id}`)}>
                  <div className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>
                    {u.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{u.display_name}</div>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>SR {u.current_rating ?? '---'}</span>
                  </div>
                </div>
                {myUserId && u.id !== myUserId && (
                  <button type="button" className={myFollowingIds.has(u.id) ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
                    style={{ fontSize: 11 }} onClick={() => handleToggleFollow(u.id)}>
                    {myFollowingIds.has(u.id) ? 'フォロー中' : 'フォロー'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
