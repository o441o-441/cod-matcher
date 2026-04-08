'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard } from '@/components/UIState'

type ProfileRow = {
  id: string
  display_name: string | null
  current_rating: number | null
  is_banned: boolean | null
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

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [legacy, setLegacy] = useState<LegacyUser | null>(null)
  const [isMe, setIsMe] = useState(false)

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

      const { data: p } = await supabase
        .from('profiles')
        .select('id, display_name, current_rating, is_banned')
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
      </div>

      {!isMe && (
        <div className="section card-strong">
          <h2>このプレイヤーを通報</h2>
          <p className="muted">
            ルール違反、チート、暴言などを発見したら通報できます。
          </p>
          <div className="section row">
            <button onClick={() => router.push(reportHref)}>通報する</button>
          </div>
        </div>
      )}
    </main>
  )
}
