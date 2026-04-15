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
          {teamName && <p className="muted">{teamName}</p>}
          {!teamName && <p className="muted">プレイヤープロフィール</p>}
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
            <p className="muted">プラットフォーム</p>
            <h3>{legacy?.platform || '未設定'}</h3>
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

      {seasons.length > 0 && (
        <div className="section card-strong">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ marginTop: 0 }}>シーズン別 戦績 / レート推移</h2>
            <select
              value={selectedSeasonId}
              onChange={(e) => void handleSeasonChange(e.target.value)}
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
                  <p className="muted">シーズン戦績</p>
                  <h3>{seasonWins ?? 0}勝 {seasonLosses ?? 0}敗</h3>
                </div>
                <div className="card">
                  <p className="muted">シーズン勝率</p>
                  <h3>
                    {(seasonWins ?? 0) + (seasonLosses ?? 0) > 0
                      ? (((seasonWins ?? 0) / ((seasonWins ?? 0) + (seasonLosses ?? 0))) * 100).toFixed(1)
                      : '0.0'}%
                  </h3>
                </div>
              </div>

              {seasonRatingHistory.length > 1 ? (
                <div className="card" style={{ marginTop: 12 }}>
                  <p className="muted" style={{ marginBottom: 8 }}>シーズン レート推移</p>
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
      )}

      {!isMe && signedIn && (
        <div className="section card-strong">
          <h2>このプレイヤーと交流</h2>
          <div className="section row">
            <button onClick={handleSendFriendRequest} disabled={sendingFriend}>
              {sendingFriend ? '送信中...' : 'フレンド申請を送る'}
            </button>
            <button onClick={() => router.push(`/dm/${userId}`)}>DMを送る</button>
            <button onClick={() => router.push(reportHref)}>通報する</button>
          </div>
        </div>
      )}
    </main>
  )
}
