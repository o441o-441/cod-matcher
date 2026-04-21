'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'
import RatingChart from '@/components/RatingChart'

type ProfileRow = {
  id: string
  display_name: string | null
  current_rating: number | null
  is_banned: boolean | null
  is_monitor: boolean | null
  is_approved: boolean | null
  bio: string | null
}

type LegacyUser = {
  controller: string | null
  activision_id: string | null
  discord_name: string | null
  platform: string | null
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
  const [teamName, setTeamName] = useState<string | null>(null)
  const [isMe, setIsMe] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [sendingFriend, setSendingFriend] = useState(false)

  type SeasonOption = { id: string; name: string; start_date: string; end_date: string; is_active: boolean }
  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('')
  const [seasonWins, setSeasonWins] = useState<number | null>(null)
  const [seasonLosses, setSeasonLosses] = useState<number | null>(null)
  const [seasonRatingHistory, setSeasonRatingHistory] = useState<{ matchIndex: number; rating: number }[]>([])
  const [seasonLoading, setSeasonLoading] = useState(false)

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

      // Parallel: profiles, users, team_members, seasons
      const [profileRes, legacyRes, memberRes, seasonRes] = await Promise.all([
        supabase.from('profiles').select('id, display_name, current_rating, is_banned, is_monitor, is_approved, bio').eq('id', userId).maybeSingle<ProfileRow>(),
        supabase.from('users').select('controller, activision_id, discord_name, platform').eq('auth_user_id', userId).maybeSingle<LegacyUser>(),
        supabase.from('team_members').select('team_id').eq('user_id', userId).maybeSingle<{ team_id: string }>(),
        supabase.from('seasons').select('id, name, start_date, end_date, is_active').order('start_date', { ascending: false }),
      ])

      setProfile(profileRes.data ?? null)
      setLegacy(legacyRes.data ?? null)

      if (memberRes.data?.team_id) {
        const { data: teamRow } = await supabase
          .from('teams')
          .select('name, is_disbanded')
          .eq('id', memberRes.data.team_id)
          .maybeSingle<{ name: string; is_disbanded: boolean }>()
        if (teamRow && !teamRow.is_disbanded) {
          setTeamName(teamRow.name)
        }
      }

      const seasonList = (seasonRes.data ?? []) as SeasonOption[]
      setSeasons(seasonList)
      const activeSeason = seasonList.find((s) => s.is_active) ?? seasonList[0]
      if (activeSeason) {
        setSelectedSeasonId(activeSeason.id)
        await fetchSeasonStatsForUser(userId, activeSeason)
      }

      setLoading(false)
    }

    async function fetchSeasonStatsForUser(uid: string, season: SeasonOption) {
      setSeasonLoading(true)
      try {
        const [rhRes, rankingRes] = await Promise.all([
          supabase.from('rating_history').select('rating_after, created_at').eq('user_id', uid).gte('created_at', season.start_date).lte('created_at', season.end_date + 'T23:59:59.999Z').order('created_at', { ascending: true }),
          supabase.rpc('rpc_get_season_ranking', { p_season_id: season.id }),
        ])

        if (rhRes.data && rhRes.data.length > 0) {
          setSeasonRatingHistory(
            (rhRes.data as { rating_after: number; created_at: string }[]).map((r, i) => ({
              matchIndex: i + 1,
              rating: r.rating_after,
            }))
          )
        } else {
          setSeasonRatingHistory([])
        }

        const rows = (rankingRes.data ?? []) as { user_id: string; wins: number; losses: number }[]
        const myRow = rows.find((r) => r.user_id === uid)
        setSeasonWins(myRow?.wins ?? 0)
        setSeasonLosses(myRow?.losses ?? 0)
      } catch (e) {
        console.error('fetchSeasonStatsForUser error:', e)
      } finally {
        setSeasonLoading(false)
      }
    }

    void Promise.resolve().then(load)
  }, [userId])

  const handleSeasonChange = async (seasonId: string) => {
    setSelectedSeasonId(seasonId)
    const season = seasons.find((s) => s.id === seasonId)
    if (!season || !userId) return
    setSeasonLoading(true)
    try {
      const [rhRes, rankingRes] = await Promise.all([
        supabase.from('rating_history').select('rating_after, created_at').eq('user_id', userId).gte('created_at', season.start_date).lte('created_at', season.end_date + 'T23:59:59.999Z').order('created_at', { ascending: true }),
        supabase.rpc('rpc_get_season_ranking', { p_season_id: season.id }),
      ])
      if (rhRes.data && rhRes.data.length > 0) {
        setSeasonRatingHistory(
          (rhRes.data as { rating_after: number; created_at: string }[]).map((r, i) => ({
            matchIndex: i + 1,
            rating: r.rating_after,
          }))
        )
      } else {
        setSeasonRatingHistory([])
      }
      const rows = (rankingRes.data ?? []) as { user_id: string; wins: number; losses: number }[]
      const myRow = rows.find((r) => r.user_id === userId)
      setSeasonWins(myRow?.wins ?? 0)
      setSeasonLosses(myRow?.losses ?? 0)
    } catch (e) {
      console.error('handleSeasonChange error:', e)
    } finally {
      setSeasonLoading(false)
    }
  }

  if (loading) {
    return (
      <main>
        <div className="eyebrow">PLAYER PROFILE</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Player</em>
        </h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (!profile) {
    return (
      <main>
        <div className="eyebrow">PLAYER PROFILE</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Player</em>
        </h1>
        <div className="section card-strong">
          <p className="muted">プレイヤー情報が見つかりません。</p>
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
      <div className="eyebrow">PLAYER PROFILE</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        {profile.display_name || <em>Player</em>}
      </h1>
      {teamName && <p className="muted">{teamName}</p>}
      {!teamName && <p className="muted">プレイヤープロフィール</p>}

      {/* Avatar + rating hero */}
      <div className="section">
        <div className="card-strong">
          <div className="row" style={{ gap: 20 }}>
            <div
              className="avatar"
              style={{ width: 64, height: 64, fontSize: 24 }}
            >
              {(profile.display_name || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div className="stat">
                <span className="stat-label">CURRENT RATING</span>
                <span className="stat-val big">{profile.current_rating ?? '-'}</span>
              </div>
            </div>
            {profile.is_banned && (
              <span className="badge danger">
                <span className="badge-dot" />
                BAN
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Basic info */}
      <div className="section">
        <div className="card-strong">
          <div className="sec-title">基本情報</div>
          <div className="g3" style={{ marginTop: 12 }}>
            <div className="stat">
              <span className="stat-label">DEVICE</span>
              <span className="stat-val" style={{ fontSize: 16 }}>{legacy?.controller || '未設定'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">PLATFORM</span>
              <span className="stat-val" style={{ fontSize: 16 }}>{legacy?.platform || '未設定'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">ACTIVISION ID</span>
              <span className="stat-val" style={{ fontSize: 16 }}>{legacy?.activision_id || '未設定'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">DISCORD</span>
              <span className="stat-val" style={{ fontSize: 16 }}>{legacy?.discord_name || '未設定'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">STATUS</span>
              <span className={`stat-val ${profile.is_banned ? 'danger' : ''}`} style={{ fontSize: 16 }}>
                {profile.is_banned ? 'BAN' : 'ACTIVE'}
              </span>
            </div>
          </div>

          <div className="div" />

          <div className="stat">
            <span className="stat-label">BIO</span>
          </div>
          {profile.bio ? (
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{profile.bio}</p>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>未設定</p>
          )}
        </div>
      </div>

      {/* Season stats */}
      {seasons.length > 0 && (
        <div className="section">
          <div className="card-strong">
            <div className="rowx" style={{ alignItems: 'center', marginBottom: 12 }}>
              <div className="sec-title" style={{ margin: 0 }}>シーズン戦績</div>
              <select
                value={selectedSeasonId}
                onChange={(e) => void handleSeasonChange(e.target.value)}
                style={{ maxWidth: 280 }}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.start_date} ~ {s.end_date}){s.is_active ? ' [NOW]' : ''}
                  </option>
                ))}
              </select>
            </div>

            {seasonLoading ? (
              <p className="muted">読み込み中...</p>
            ) : (
              <>
                <div className="g3" style={{ marginTop: 8 }}>
                  <div className="stat">
                    <span className="stat-label">RECORD</span>
                    <span className="stat-val">{seasonWins ?? 0}W {seasonLosses ?? 0}L</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">WIN RATE</span>
                    <span className="stat-val">
                      {(seasonWins ?? 0) + (seasonLosses ?? 0) > 0
                        ? (((seasonWins ?? 0) / ((seasonWins ?? 0) + (seasonLosses ?? 0))) * 100).toFixed(1)
                        : '0.0'}%
                    </span>
                  </div>
                </div>

                {seasonRatingHistory.length > 1 ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="stat-label" style={{ marginBottom: 8 }}>RATING HISTORY</div>
                    <RatingChart data={seasonRatingHistory} />
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: 8 }}>
                    このシーズンのレート推移データはまだありません。
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isMe && signedIn && (
        <div className="section">
          <div className="card-strong">
            <div className="sec-title">このプレイヤーと交流</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={handleSendFriendRequest} disabled={sendingFriend}>
                {sendingFriend ? '送信中...' : 'フレンド申請'}
              </button>
              <button onClick={() => router.push(`/dm/${userId}`)}>DMを送る</button>
              <button className="btn-danger" onClick={() => router.push(reportHref)}>通報する</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
