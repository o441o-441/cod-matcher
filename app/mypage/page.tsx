'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

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
  const [waitingCount, setWaitingCount] = useState(0)

  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchWaitingCount = async () => {
    const { count, error } = await supabase
      .from('match_queue')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('fetchWaitingCount error:', error)
      return
    }

    setWaitingCount(count || 0)
  }

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

    await fetchWaitingCount()
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
          table: 'match_queue',
        },
        async () => {
          await fetchWaitingCount()
        }
      )
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
          <h1>マイページ</h1>
          <p className="muted">チーム状況や対戦導線をここから管理します</p>
        </div>

        <div className="row">
          <span className="muted">ログイン中</span>
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

            <div className="card">
              <p className="muted">Discord User ID</p>
              <h3>{profile?.discord_user_id || '未設定'}</h3>
            </div>
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
          <h2>現在の状況</h2>

          <div className="grid grid-2">
            <div className="card">
              <p className="muted">待機中チーム数</p>
              <h3>{waitingCount}チーム</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card-strong">
          <h2>所属チーム</h2>

          {team ? (
            <>
              <div className="grid grid-2">
                <div className="card">
                  <p className="muted">チーム名</p>
                  <h3>{team.name}</h3>
                </div>

                <div className="card">
                  <p className="muted">レート</p>
                  <h3>{team.rating}</h3>
                </div>

                <div className="card">
                  <p className="muted">戦績</p>
                  <h3>
                    {team.wins}勝 {team.losses}敗
                  </h3>
                </div>

                <div className="card">
                  <p className="muted">試合数</p>
                  <h3>{team.matches_played}</h3>
                </div>
              </div>

              <div className="section row">
                <button onClick={() => router.push('/team/edit')}>
                  チーム名を編集
                </button>
                <button onClick={() => router.push(`/team/${team.id}`)}>
                  チーム詳細を見る
                </button>
                <button onClick={() => router.push('/match')}>対戦開始</button>
                <button onClick={() => router.push('/friends')}>
                  フレンド管理
                </button>
                <button onClick={() => router.push('/ranking')}>
                  ランキングを見る
                </button>
                <button onClick={() => router.push('/history')}>
                  マッチ履歴
                </button>
                <button onClick={() => router.push('/rules')}>
                  ルール一覧
                </button>
              </div>
            </>
          ) : (
            <>
              <p>まだチームに所属していません（ソロでも対戦に参加できます）</p>

              <div className="section row">
                <button onClick={() => router.push('/match')}>対戦開始</button>
                <button onClick={() => router.push('/friends')}>
                  フレンド管理
                </button>
                <button onClick={() => router.push('/ranking')}>
                  ランキングを見る
                </button>
                <button onClick={() => router.push('/history')}>
                  マッチ履歴
                </button>
                <button onClick={() => router.push('/rules')}>
                  ルール一覧
                </button>
                <button onClick={() => router.push('/team/create')}>
                  チームを作成
                </button>
                <button onClick={() => router.push('/team/join')}>
                  チームに参加
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}