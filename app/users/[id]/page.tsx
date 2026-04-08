'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'

type ProfileRow = {
  id: string
  display_name: string | null
  current_rating: number | null
  is_banned: boolean | null
  bio: string | null
}

type LegacyUser = {
  controller: string | null
  activision_id: string | null
  discord_name: string | null
}

export default function UserProfilePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const userId =
    typeof params.id === 'string'
      ? params.id
      : Array.isArray(params.id)
      ? params.id[0]
      : ''

  const matchContext = searchParams.get('match') || ''
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [legacy, setLegacy] = useState<LegacyUser | null>(null)
  const [isMe, setIsMe] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [sendingFriend, setSendingFriend] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!userId) {
        setLoading(false)
        return
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()
      setIsMe(session?.user?.id === userId)
      setSignedIn(!!session?.user)

      const { data: p } = await supabase
        .from('profiles')
        .select('id, display_name, current_rating, is_banned, bio')
        .eq('id', userId)
        .maybeSingle<ProfileRow>()
      setProfile(p ?? null)

      const { data: l } = await supabase
        .from('users')
        .select('controller, activision_id, discord_name')
        .eq('auth_user_id', userId)
        .maybeSingle<LegacyUser>()
      setLegacy(l ?? null)

      setLoading(false)
    }

    void Promise.resolve().then(load)
  }, [userId])

  if (loading) {
    return (
      <main>
        <h1>プレイヤー</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (!profile) {
    return (
      <main>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>プレイヤー</h1>
          <button onClick={() => router.back()}>戻る</button>
        </div>
        <div className="section card-strong">
          <p>プレイヤー情報が見つかりません。</p>
        </div>
      </main>
    )
  }

  const reportHref = matchContext
    ? `/reports/new?reported=${profile.id}&match=${matchContext}`
    : `/reports/new?reported=${profile.id}`

  const handleSendFriendRequest = async () => {
    if (!profile?.display_name) {
      showToast('表示名が未設定のため申請を送れません', 'error')
      return
    }
    setSendingFriend(true)
    const { error } = await supabase.rpc('rpc_send_friend_request', {
      p_target_display_name: profile.display_name,
    })
    setSendingFriend(false)
    if (error) {
      console.error('send friend request error:', error)
      showToast(error.message || 'フレンド申請に失敗しました', 'error')
      return
    }
    showToast('フレンド申請を送信しました', 'success')
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{profile.display_name || '(名前未設定)'}</h1>
          <p className="muted">プレイヤープロフィール</p>
        </div>
        <div className="row">
          <button onClick={() => router.back()}>戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>基本情報</h2>
        <div className="grid grid-2">
          <div className="card">
            <p className="muted">表示名</p>
            <h3>{profile.display_name || '未設定'}</h3>
          </div>

          <div className="card">
            <p className="muted">レート</p>
            <h3>{profile.current_rating ?? '-'}</h3>
          </div>

          <div className="card">
            <p className="muted">使用デバイス</p>
            <h3>{legacy?.controller || '未設定'}</h3>
          </div>

          <div className="card">
            <p className="muted">Activision ID</p>
            <h3>{legacy?.activision_id || '未設定'}</h3>
          </div>

          <div className="card">
            <p className="muted">Discord 名</p>
            <h3>{legacy?.discord_name || '未設定'}</h3>
          </div>

          <div className="card">
            <p className="muted">状態</p>
            <h3 className={profile.is_banned ? 'danger' : ''}>
              {profile.is_banned ? 'BAN中' : '通常'}
            </h3>
          </div>
        </div>

        <div className="section card">
          <p className="muted">自己紹介</p>
          {profile.bio ? (
            <p style={{ whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
          ) : (
            <p className="muted">未設定</p>
          )}
        </div>
      </div>

      {!isMe && signedIn && (
        <div className="section card-strong">
          <h2>このプレイヤーと交流</h2>
          <div className="section row">
            <button onClick={handleSendFriendRequest} disabled={sendingFriend}>
              {sendingFriend ? '送信中...' : 'フレンド申請を送る'}
            </button>
            <button onClick={() => router.push(reportHref)}>通報する</button>
          </div>
        </div>
      )}
    </main>
  )
}
