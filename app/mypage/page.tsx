'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { usePageView } from '@/lib/usePageView'
import RatingChart from '@/components/RatingChart'

type UserRow = {
  id: string
  auth_user_id: string
  display_name: string | null
  discord_name: string | null
  discord_user_id: string | null
  activision_id: string | null
  controller: string | null
  is_profile_complete: boolean | null
}

type TeamRow = {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

export default function MyPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserRow | null>(null)
  const [team, setTeam] = useState<TeamRow | null>(null)
  const [pageError, setPageError] = useState('')
  const [bio, setBio] = useState<string | null>(null)
  const [isBanned, setIsBanned] = useState(false)
  const [isMonitor, setIsMonitor] = useState(false)
  const [isApproved, setIsApproved] = useState(false)
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [wins, setWins] = useState<number | null>(null)
  const [losses, setLosses] = useState<number | null>(null)
  const [ratingHistory, setRatingHistory] = useState<{ matchIndex: number; rating: number }[]>([])

  usePageView('/mypage')

  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const pickString = (
    obj: Record<string, unknown> | undefined,
    key: string
  ): string | null => {
    const v = obj?.[key]
    if (v == null) return null
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return null
  }

  const extractDiscordInfo = (authUser: User) => {
    const meta = (authUser?.user_metadata ?? {}) as Record<string, unknown>
    const identities = (authUser?.identities ?? []) as Array<{
      provider?: string
      identity_data?: Record<string, unknown>
    }>
    const discordIdentity = identities.find((i) => i?.provider === 'discord')
    const identityData = (discordIdentity?.identity_data ?? {}) as Record<string, unknown>
    const appMeta = (authUser?.app_metadata ?? {}) as Record<string, unknown>

    const discordUserId =
      pickString(identityData, 'provider_id') ||
      pickString(identityData, 'user_id') ||
      pickString(meta, 'provider_id') ||
      pickString(meta, 'sub') ||
      pickString(appMeta, 'provider_id') ||
      null

    const discordName =
      pickString(meta, 'full_name') ||
      pickString(meta, 'name') ||
      pickString(identityData, 'full_name') ||
      pickString(identityData, 'name') ||
      pickString(identityData, 'global_name') ||
      pickString(identityData, 'preferred_username') ||
      null

    return {
      discordUserId,
      discordName,
    }
  }

  const createUserIfMissing = async (authUser: User) => {
    const { discordUserId, discordName } = extractDiscordInfo(authUser)

    const { data, error } = await supabase
      .from('users')
      .insert({
        auth_user_id: authUser.id,
        display_name: null,
        activision_id: null,
        is_profile_complete: false,
        discord_name: discordName,
        discord_user_id: discordUserId,
      })
      .select('*')
      .single()

    if (error || !data) {
      console.error('createUserIfMissing error:', error)
      return null
    }

    return data as UserRow
  }

  const syncDiscordProfile = async (
    authUserId: string,
    authUser: User,
    existingUser: UserRow
  ) => {
    const { discordUserId, discordName } = extractDiscordInfo(authUser)

    const needsUpdate =
      (discordUserId && existingUser.discord_user_id !== discordUserId) ||
      (discordName && existingUser.discord_name !== discordName)

    if (!needsUpdate) {
      return existingUser
    }

    const updatePayload: Partial<UserRow> = {
      discord_user_id: discordUserId ?? existingUser.discord_user_id,
      discord_name: discordName ?? existingUser.discord_name,
    }

    const { data, error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('auth_user_id', authUserId)
      .select('*')
      .single()

    if (error || !data) {
      console.error('syncDiscordProfile error:', error)
      return existingUser
    }

    return data as UserRow
  }

  const fetchPageData = async () => {
    setPageError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user) {
      router.push('/login')
      return
    }

    const authUser = session.user

    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    if (selectError) {
      console.error('selectError:', selectError)
      setPageError('ユーザー情報の取得に失敗しました')
      setLoading(false)
      return
    }

    let userRow = existingUser as UserRow | null

    if (!userRow) {
      userRow = await createUserIfMissing(authUser)

      if (!userRow) {
        setPageError('ユーザー初期作成に失敗しました')
        setLoading(false)
        return
      }
    }

    const syncedUser = await syncDiscordProfile(authUser.id, authUser, userRow)

    if (!syncedUser.is_profile_complete) {
      router.push('/onboarding')
      return
    }

    setProfile(syncedUser)

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('bio, current_rating, wins, losses, is_banned, is_monitor, is_approved, suspended_until')
      .eq('id', authUser.id)
      .maybeSingle<{
        bio: string | null
        current_rating: number | null
        wins: number | null
        losses: number | null
        is_banned: boolean | null
        is_monitor: boolean | null
        is_approved: boolean | null
        suspended_until: string | null
      }>()
    setBio(profileRow?.bio ?? null)
    setIsBanned(!!profileRow?.is_banned)
    setIsMonitor(!!profileRow?.is_monitor)
    setIsApproved(!!profileRow?.is_approved)
    setSuspendedUntil(profileRow?.suspended_until ?? null)
    setRating(profileRow?.current_rating ?? null)
    setWins(profileRow?.wins ?? null)
    setLosses(profileRow?.losses ?? null)

    // Fetch rating history for chart
    const { data: rhData } = await supabase
      .from('rating_history')
      .select('rating_after, created_at')
      .eq('user_id', authUser.id)
      .order('created_at', { ascending: true })
    if (rhData && rhData.length > 0) {
      const points = (rhData as { rating_after: number; created_at: string }[]).map((r, i) => ({
        matchIndex: i + 1,
        rating: r.rating_after,
      }))
      setRatingHistory(points)
    }

    const { data: memberRow, error: memberError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', authUser.id)
      .maybeSingle()

    if (memberError) {
      console.error('memberError:', memberError)
      setPageError('所属チーム情報の取得に失敗しました')
    }

    if (memberRow?.team_id) {
      const { data: teamRow, error: teamError } = await supabase
        .from('teams')
        .select(
          'id, name, owner_user_id, created_at, rating, wins, losses, matches_played'
        )
        .eq('id', memberRow.team_id)
        .single()

      if (teamError) {
        console.error('teamError:', teamError)
        setPageError('チーム情報の取得に失敗しました')
      } else {
        setTeam(teamRow as TeamRow)
      }
    } else {
      setTeam(null)
    }

    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchPageData)

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
    // fetchPageData is stable within the component closure; intentionally not in deps to avoid refetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => {
    const channel = supabase
      .channel('mypage-realtime-global')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
        },
        async () => {
          await fetchPageData()
        }
      )
      .subscribe((status) => {
        console.log('mypage realtime status:', status)
      })

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    showToast('ログアウトしました', 'info')
    router.push('/login')
  }

  if (loading) {
    return (
      <main>
        <h1>マイページ</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>
            マイページ
            {isMonitor && (
              <span style={{ fontSize: '0.7rem', marginLeft: 8, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-cyan, #0ff)', color: '#000', verticalAlign: 'middle' }}>
                監視ユーザー
              </span>
            )}
            {isApproved && (
              <span style={{ fontSize: '0.7rem', marginLeft: 8, padding: '2px 6px', borderRadius: 4, background: 'var(--success, #0f0)', color: '#000', verticalAlign: 'middle' }}>
                承認ユーザー
              </span>
            )}
          </h1>
          <p className="muted">チーム状況や対戦導線をここから管理します</p>
        </div>

        <div className="row">
          <span className="muted">ログイン中</span>
          <button onClick={() => router.push('/menu')}>メニューへ</button>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </div>

      {pageError && (
        <div className="section">
          <div className="card">
            <p className="danger">
              <strong>エラー:</strong> {pageError}
            </p>
          </div>
        </div>
      )}

      <div className="section">
        <div className="card-strong">
          <h2>プロフィール</h2>

          {suspendedUntil && new Date(suspendedUntil) > new Date() && (
            <div className="card" style={{ borderColor: 'var(--warning, orange)', marginBottom: 12 }}>
              <h3 style={{ color: 'var(--warning, orange)' }}>このアカウントは一時停止中です（解除: {new Date(suspendedUntil).toLocaleString('ja-JP')}）</h3>
              <p className="muted">マッチへの参加が制限されています。</p>
            </div>
          )}

          {isBanned && (
            <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
              <h3 className="danger">このアカウントは BAN されています</h3>
              <p className="muted">マッチへの参加が制限されています。心当たりがない場合は運営にお問い合わせください。</p>
            </div>
          )}

          <div className="grid grid-2">
            <div className="card">
              <p className="muted">表示名</p>
              <h3>{profile?.display_name || '未設定'}</h3>
            </div>

            <div className="card">
              <p className="muted">Activision ID</p>
              <h3>{profile?.activision_id || '未設定'}</h3>
            </div>

            <div className="card">
              <p className="muted">使用デバイス</p>
              <h3>{profile?.controller || '未設定'}</h3>
            </div>

            <div className="card">
              <p className="muted">Discord名</p>
              <h3>{profile?.discord_name || '未設定'}</h3>
            </div>

          </div>

          <div className="section grid grid-2">
            <div className="card">
              <p className="muted">レート</p>
              <h3>{rating ?? '-'}</h3>
            </div>
            <div className="card">
              <p className="muted">個人戦績</p>
              <h3>
                {wins ?? 0}勝 {losses ?? 0}敗
              </h3>
            </div>
          </div>

          {ratingHistory.length > 1 && (
            <div className="section card">
              <p className="muted" style={{ marginBottom: 8 }}>レート推移</p>
              <RatingChart data={ratingHistory} />
            </div>
          )}

          <div className="section card">
            <p className="muted">自己紹介</p>
            {bio ? (
              <p style={{ whiteSpace: 'pre-wrap' }}>{bio}</p>
            ) : (
              <p className="muted">未設定</p>
            )}
          </div>

          <div className="section row">
            <button onClick={() => router.push('/profile/edit')}>
              プロフィールを編集
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card-strong">
          <h2>所属チーム</h2>

          {team ? (
            <>
              <div className="card">
                <p className="muted">チーム名</p>
                <h3>{team.name}</h3>
              </div>

              <div className="section row">
                <button onClick={() => router.push(`/team/${team.id}`)}>
                  チーム詳細を見る
                </button>
              </div>
            </>
          ) : (
            <p>まだチームに所属していません（ソロでも対戦に参加できます）</p>
          )}
        </div>
      </div>
    </main>
  )
}