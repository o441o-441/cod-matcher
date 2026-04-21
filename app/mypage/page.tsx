'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { usePageView } from '@/lib/usePageView'
import RatingChart from '@/components/RatingChart'
import { getCache, setCache } from '@/lib/cache'
import { LoadingSkeleton } from '@/components/UIState'

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

function getTierInfo(rating: number): { name: string; color: string } {
  if (rating >= 2200) return { name: 'ASCENDANT', color: 'var(--tier-ascendant)' }
  if (rating >= 2000) return { name: 'DIAMOND', color: 'var(--tier-diamond)' }
  if (rating >= 1800) return { name: 'PLATINUM', color: 'var(--tier-platinum)' }
  if (rating >= 1600) return { name: 'GOLD', color: 'var(--tier-gold)' }
  if (rating >= 1400) return { name: 'SILVER', color: 'var(--tier-silver)' }
  return { name: 'BRONZE', color: 'var(--tier-bronze)' }
}

function CircularRating({ rating, peakRating }: { rating: number | null; peakRating: number | null }) {
  const displayRating = rating ?? 0
  const tier = getTierInfo(displayRating)
  const size = 180
  const strokeWidth = 6
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  // Fill based on rating 0-3000 range
  const progress = Math.min(displayRating / 3000, 1)
  const dashOffset = circumference * (1 - progress)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background ring */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="rgba(140, 160, 220, 0.08)"
          strokeWidth={strokeWidth}
        />
        {/* Gradient ring */}
        <defs>
          <linearGradient id="rating-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--cyan)" />
            <stop offset="100%" stopColor="var(--violet)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="url(#rating-ring-grad)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      {/* Center content */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 2,
      }}>
        {/* Tier badge */}
        <span className="badge" style={{
          fontSize: 9,
          padding: '2px 8px',
          borderColor: tier.color,
          color: tier.color,
          background: 'rgba(0,0,0,0.3)',
        }}>
          {tier.name}
        </span>
        {/* Rating number */}
        <span className="stat-val huge" style={{ color: 'var(--cyan)', lineHeight: 1 }}>
          {rating != null ? displayRating : '-'}
        </span>
        {/* Peak */}
        {peakRating != null && (
          <span className="muted" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
            PEAK {peakRating}
          </span>
        )}
      </div>
    </div>
  )
}

export default function MyPage() {
  const router = useRouter()
  const { showToast } = useToast()

  type MypageCache = { rating: number | null; wins: number | null; losses: number | null; bio: string | null; ratingHistory: { matchIndex: number; rating: number }[] }
  const cached = typeof window !== 'undefined' ? getCache<MypageCache>('mypage_data') : null

  const [loading, setLoading] = useState(!cached)
  const [profile, setProfile] = useState<UserRow | null>(null)
  const [team, setTeam] = useState<TeamRow | null>(null)
  const [pageError, setPageError] = useState('')
  const [bio, setBio] = useState<string | null>(cached?.bio ?? null)
  const [isBanned, setIsBanned] = useState(false)
  const [isMonitor, setIsMonitor] = useState(false)
  const [isApproved, setIsApproved] = useState(false)
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null)
  const [rating, setRating] = useState<number | null>(cached?.rating ?? null)
  const [peakRating, setPeakRating] = useState<number | null>(null)
  const [wins, setWins] = useState<number | null>(cached?.wins ?? null)
  const [losses, setLosses] = useState<number | null>(cached?.losses ?? null)
  const [ratingHistory, setRatingHistory] = useState<{ matchIndex: number; rating: number }[]>(cached?.ratingHistory ?? [])

  type SeasonOption = { id: string; name: string; start_date: string; end_date: string; is_active: boolean }
  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('')
  const [seasonWins, setSeasonWins] = useState<number | null>(null)
  const [seasonLosses, setSeasonLosses] = useState<number | null>(null)
  const [seasonRatingHistory, setSeasonRatingHistory] = useState<{ matchIndex: number; rating: number }[]>([])
  const [seasonLoading, setSeasonLoading] = useState(false)

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

    // Parallel: profile, rating history, team membership, seasons
    const [profileRes, rhRes, memberRes, seasonRes] = await Promise.all([
      supabase.from('profiles').select('bio, current_rating, peak_rating, wins, losses, is_banned, is_monitor, is_approved, suspended_until').eq('id', authUser.id).maybeSingle<{ bio: string | null; current_rating: number | null; peak_rating: number | null; wins: number | null; losses: number | null; is_banned: boolean | null; is_monitor: boolean | null; is_approved: boolean | null; suspended_until: string | null }>(),
      supabase.from('rating_history').select('rating_after, created_at').eq('user_id', authUser.id).order('created_at', { ascending: true }),
      supabase.from('team_members').select('team_id').eq('user_id', authUser.id).maybeSingle(),
      supabase.from('seasons').select('id, name, start_date, end_date, is_active').order('start_date', { ascending: false }),
    ])

    const profileRow = profileRes.data
    setBio(profileRow?.bio ?? null)
    setIsBanned(!!profileRow?.is_banned)
    setIsMonitor(!!profileRow?.is_monitor)
    setIsApproved(!!profileRow?.is_approved)
    setSuspendedUntil(profileRow?.suspended_until ?? null)
    setRating(profileRow?.current_rating ?? null)
    setPeakRating(profileRow?.peak_rating ?? null)
    setWins(profileRow?.wins ?? null)
    setLosses(profileRow?.losses ?? null)

    if (rhRes.data && rhRes.data.length > 0) {
      const points = (rhRes.data as { rating_after: number; created_at: string }[]).map((r, i) => ({
        matchIndex: i + 1,
        rating: r.rating_after,
      }))
      setRatingHistory(points)
    }

    if (memberRes.error) {
      console.error('memberError:', memberRes.error)
      setPageError('所属チーム情報の取得に失敗しました')
    }

    if (memberRes.data?.team_id) {
      const { data: teamRow, error: teamError } = await supabase
        .from('teams')
        .select('id, name, owner_user_id, created_at, rating, wins, losses, matches_played')
        .eq('id', memberRes.data.team_id)
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

    // Build and save rating history points
    const rhPoints = (rhRes.data && rhRes.data.length > 0)
      ? (rhRes.data as { rating_after: number; created_at: string }[]).map((r, i) => ({ matchIndex: i + 1, rating: r.rating_after }))
      : []

    setCache('mypage_data', {
      rating: profileRow?.current_rating ?? null,
      wins: profileRow?.wins ?? null,
      losses: profileRow?.losses ?? null,
      bio: profileRow?.bio ?? null,
      ratingHistory: rhPoints,
    })

    const seasonList = (seasonRes.data ?? []) as SeasonOption[]
    setSeasons(seasonList)
    const activeSeason = seasonList.find((s) => s.is_active) ?? seasonList[0]
    if (activeSeason) {
      setSelectedSeasonId(activeSeason.id)
      await fetchSeasonStats(authUser.id, activeSeason)
    }

    setLoading(false)
  }

  async function fetchSeasonStats(userId: string, season: SeasonOption) {
    setSeasonLoading(true)
    try {
      const [rhRes, rankingRes] = await Promise.all([
        supabase.from('rating_history').select('rating_after, created_at').eq('user_id', userId).gte('created_at', season.start_date).lte('created_at', season.end_date + 'T23:59:59.999Z').order('created_at', { ascending: true }),
        supabase.rpc('rpc_get_season_ranking', { p_season_id: season.id }),
      ])

      if (rhRes.data && rhRes.data.length > 0) {
        const points = (rhRes.data as { rating_after: number; created_at: string }[]).map((r, i) => ({
          matchIndex: i + 1,
          rating: r.rating_after,
        }))
        setSeasonRatingHistory(points)
      } else {
        setSeasonRatingHistory([])
      }

      const rows = (rankingRes.data ?? []) as { user_id: string; wins: number; losses: number }[]
      const myRow = rows.find((r) => r.user_id === userId)
      setSeasonWins(myRow?.wins ?? 0)
      setSeasonLosses(myRow?.losses ?? 0)
    } catch (e) {
      console.error('fetchSeasonStats error:', e)
    } finally {
      setSeasonLoading(false)
    }
  }

  const handleSeasonChange = async (seasonId: string) => {
    setSelectedSeasonId(seasonId)
    const season = seasons.find((s) => s.id === seasonId)
    if (!season || !profile) return
    await fetchSeasonStats(profile.auth_user_id, season)
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

  const totalGames = (wins ?? 0) + (losses ?? 0)
  const winRate = totalGames > 0 ? (((wins ?? 0) / totalGames) * 100).toFixed(1) : '0.0'

  if (loading) {
    return (
      <main>
        <div className="eyebrow">MY PAGE</div>
        <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
          <em>MY PAGE</em>
        </h1>
        <LoadingSkeleton cards={3} />
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">MY PAGE</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
        <em>マイページ</em>
        {isMonitor && (
          <span className="badge amber" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
            <span className="badge-dot" />監視ユーザー
          </span>
        )}
        {isApproved && (
          <span className="badge success" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
            <span className="badge-dot" />承認ユーザー
          </span>
        )}
      </h1>
      <p className="muted">チーム状況や対戦導線をここから管理します</p>

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => router.push('/profile/edit')}>プロフィール編集</button>
        <button className="btn-ghost" onClick={handleLogout}>ログアウト</button>
      </div>

      {pageError && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--danger)' }}>
            <p className="danger">
              <strong>エラー:</strong> {pageError}
            </p>
          </div>
        </div>
      )}

      {/* ── Profile card ── */}
      <div className="section">
        <div className="card-strong">
          <div className="sec-title">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            プロフィール
          </div>

          {suspendedUntil && new Date(suspendedUntil) > new Date() && (
            <div className="card" style={{ borderColor: 'var(--warning, orange)', marginBottom: 12 }}>
              <span className="badge amber" style={{ marginBottom: 6 }}>
                <span className="badge-dot" />一時停止中
              </span>
              <p style={{ color: 'var(--warning, orange)', fontWeight: 700, margin: '4px 0' }}>
                解除: {new Date(suspendedUntil).toLocaleString('ja-JP')}
              </p>
              <p className="muted">マッチへの参加が制限されています。</p>
            </div>
          )}

          {isBanned && (
            <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
              <span className="badge danger" style={{ marginBottom: 6 }}>
                <span className="badge-dot" />BAN
              </span>
              <p className="danger" style={{ fontWeight: 700, margin: '4px 0' }}>このアカウントは BAN されています</p>
              <p className="muted">マッチへの参加が制限されています。心当たりがない場合は運営にお問い合わせください。</p>
            </div>
          )}

          {/* Profile top: avatar + info left, circular rating right */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Left: avatar + name/tag/bio */}
            <div style={{ flex: '1 1 200px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div className="avatar" style={{ width: 54, height: 54, fontSize: 20, flexShrink: 0 }}>
                {(profile?.display_name ?? '?')[0]?.toUpperCase()}
              </div>
              <div className="stack-sm">
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-strong)' }}>
                  {profile?.display_name || '未設定'}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {profile?.activision_id ? `@${profile.activision_id}` : 'Activision ID 未設定'}
                  {profile?.controller ? ` / ${profile.controller}` : ''}
                </div>
                {bio ? (
                  <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 13 }}>{bio}</p>
                ) : (
                  <p className="dim" style={{ margin: '4px 0 0', fontSize: 13 }}>自己紹介未設定</p>
                )}
              </div>
            </div>

            {/* Right: circular rating */}
            <CircularRating rating={rating} peakRating={peakRating} />
          </div>

          {/* Stats row */}
          <div className="grid grid-3" style={{ marginTop: 20 }}>
            <div className="card">
              <div className="stat">
                <span className="stat-label">SR</span>
                <span className="stat-val mono tabular" style={{ color: 'var(--cyan)' }}>{rating ?? '-'}</span>
              </div>
            </div>
            <div className="card">
              <div className="stat">
                <span className="stat-label">戦績</span>
                <span className="stat-val mono tabular">
                  <span className="success">{wins ?? 0}</span>
                  {' '}
                  <span className="dim" style={{ fontSize: 14 }}>W</span>
                  {'  '}
                  <span className="danger">{losses ?? 0}</span>
                  {' '}
                  <span className="dim" style={{ fontSize: 14 }}>L</span>
                </span>
              </div>
            </div>
            <div className="card">
              <div className="stat">
                <span className="stat-label">勝率</span>
                <span className="stat-val mono tabular">{winRate}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Rating chart section ── */}
      {ratingHistory.length > 1 && (
        <div className="section">
          <div className="card-strong">
            <div className="sec-title">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18M7 16l4-4 4 4 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              通算レート推移
            </div>
            <RatingChart data={ratingHistory} />
          </div>
        </div>
      )}

      {/* ── Season section ── */}
      {seasons.length > 0 && (
        <div className="section">
          <div className="card-strong">
            <div className="rowx" style={{ marginBottom: 16 }}>
              <div className="sec-title" style={{ margin: 0 }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18M7 16l4-4 4 4 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                シーズン別 戦績 / レート推移
              </div>
              <select
                value={selectedSeasonId}
                onChange={(e) => void handleSeasonChange(e.target.value)}
                style={{ width: 'auto', maxWidth: 260 }}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.start_date} 〜 {s.end_date}){s.is_active ? ' [現在]' : ''}
                  </option>
                ))}
              </select>
            </div>

            {seasonLoading ? (
              <p className="muted">読み込み中...</p>
            ) : (
              <>
                <div className="grid grid-2">
                  <div className="card">
                    <div className="stat">
                      <span className="stat-label">シーズン戦績</span>
                      <span className="stat-val mono tabular">
                        <span className="success">{seasonWins ?? 0}</span>
                        {' '}
                        <span className="dim" style={{ fontSize: 14 }}>W</span>
                        {'  '}
                        <span className="danger">{seasonLosses ?? 0}</span>
                        {' '}
                        <span className="dim" style={{ fontSize: 14 }}>L</span>
                      </span>
                    </div>
                  </div>
                  <div className="card">
                    <div className="stat">
                      <span className="stat-label">シーズン勝率</span>
                      <span className="stat-val mono tabular">
                        {(seasonWins ?? 0) + (seasonLosses ?? 0) > 0
                          ? (((seasonWins ?? 0) / ((seasonWins ?? 0) + (seasonLosses ?? 0))) * 100).toFixed(1)
                          : '0.0'}%
                      </span>
                    </div>
                  </div>
                </div>

                {seasonRatingHistory.length > 1 ? (
                  <div style={{ marginTop: 16 }}>
                    <RatingChart data={seasonRatingHistory} />
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: 12 }}>
                    このシーズンのレート推移データはまだありません。
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Team section ── */}
      <div className="section">
        <div className="card-strong">
          <div className="sec-title">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            所属チーム
          </div>

          {team ? (
            <div
              className="card glow-hover"
              style={{ cursor: 'pointer' }}
              onClick={() => router.push(`/team/${team.id}`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-strong)' }}>
                    {team.name}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    ID: {team.id.slice(0, 8)}
                  </div>
                </div>
                <div className="stat" style={{ textAlign: 'right' }}>
                  <span className="stat-label">TEAM RATING</span>
                  <span className="stat-val mono tabular" style={{ color: 'var(--cyan)' }}>{team.rating}</span>
                </div>
              </div>
              <div className="div" />
              <div className="grid grid-3">
                <div className="stat">
                  <span className="stat-label">試合数</span>
                  <span className="mono tabular" style={{ fontWeight: 700 }}>{team.matches_played}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">勝敗</span>
                  <span className="mono tabular" style={{ fontWeight: 700 }}>
                    <span className="success">{team.wins}</span> / <span className="danger">{team.losses}</span>
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">勝率</span>
                  <span className="mono tabular" style={{ fontWeight: 700 }}>
                    {team.matches_played > 0
                      ? ((team.wins / team.matches_played) * 100).toFixed(1)
                      : '0.0'}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">
              <p className="muted" style={{ marginBottom: 12 }}>まだチームに所属していません</p>
              <p className="dim" style={{ fontSize: 12 }}>ソロでも対戦に参加できます</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
