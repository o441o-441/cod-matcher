'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'
import { usePageView } from '@/lib/usePageView'

type PlayerRow = {
  user_id: string
  display_name: string | null
  games_played: number
  wins: number
  losses: number
  rating_change: number
  end_rating: number | null
}

type SeasonOption = {
  id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
}

function getTier(rating: number | null): { label: string; color: string } {
  if (rating == null) return { label: 'BRONZE', color: 'var(--tier-bronze)' }
  if (rating >= 2200) return { label: 'ASCENDANT', color: 'var(--tier-ascendant)' }
  if (rating >= 2000) return { label: 'RAINBOW', color: 'var(--tier-crimson)' }
  if (rating >= 1800) return { label: 'CRIMSON', color: 'var(--tier-crimson)' }
  if (rating >= 1600) return { label: 'DIAMOND', color: 'var(--tier-diamond)' }
  if (rating >= 1400) return { label: 'PLATINUM', color: 'var(--tier-platinum)' }
  if (rating >= 1200) return { label: 'GOLD', color: 'var(--tier-gold)' }
  if (rating >= 1000) return { label: 'SILVER', color: 'var(--tier-silver)' }
  return { label: 'BRONZE', color: 'var(--tier-bronze)' }
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name.slice(0, 2).toUpperCase()
}

export default function RankingPage() {
  const router = useRouter()

  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('')
  const [selectedSeasonName, setSelectedSeasonName] = useState('')

  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [controllers, setControllers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  usePageView('/ranking')

  const fetchTeamNames = async (userIds: string[]) => {
    if (userIds.length === 0) return
    const { data: memberData } = await supabase
      .from('team_members')
      .select('user_id, team_id')
      .in('user_id', userIds)

    if (memberData && memberData.length > 0) {
      const teamIds = [...new Set((memberData as { user_id: string; team_id: string }[]).map((m) => m.team_id))]
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', teamIds)
        .eq('is_disbanded', false)

      const teamMap: Record<string, string> = {}
      for (const t of (teamsData || []) as { id: string; name: string }[]) {
        teamMap[t.id] = t.name
      }
      const userTeamMap: Record<string, string> = {}
      for (const m of memberData as { user_id: string; team_id: string }[]) {
        if (teamMap[m.team_id]) {
          userTeamMap[m.user_id] = teamMap[m.team_id]
        }
      }
      setTeamNames(userTeamMap)
    }
  }

  const fetchControllers = async (userIds: string[]) => {
    if (userIds.length === 0) return
    const { data } = await supabase
      .from('users')
      .select('auth_user_id, controller')
      .in('auth_user_id', userIds)

    if (data) {
      const map: Record<string, string> = {}
      for (const u of data as { auth_user_id: string; controller: string | null }[]) {
        if (u.controller) map[u.auth_user_id] = u.controller
      }
      setControllers(map)
    }
  }

  const fetchSeason = async (seasonId: string) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('rpc_get_season_ranking', {
      p_season_id: seasonId,
    })

    if (error) {
      console.error('season ranking error:', error)
      setLoading(false)
      return
    }

    const rows = (data || []) as PlayerRow[]
    setPlayers(rows)
    const ids = rows.map((r) => r.user_id)
    await Promise.all([fetchTeamNames(ids), fetchControllers(ids)])
    setLoading(false)
  }

  useEffect(() => {
    const init = async () => {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, name, start_date, end_date, is_active')
        .order('start_date', { ascending: false })

      const seasonList = (seasonData ?? []) as SeasonOption[]
      setSeasons(seasonList)

      const active = seasonList.find((s) => s.is_active) ?? seasonList[0]
      if (active) {
        setSelectedSeasonId(active.id)
        setSelectedSeasonName(active.name)
        await fetchSeason(active.id)
      } else {
        setLoading(false)
      }
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSeasonChange = async (seasonId: string) => {
    setSelectedSeasonId(seasonId)
    const s = seasons.find((s) => s.id === seasonId)
    setSelectedSeasonName(s?.name ?? '')
    await fetchSeason(seasonId)
  }

  return (
    <main>
      {/* Header */}
      <div>
        <div className="eyebrow">LEADERBOARD</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          ASCENT <em>ランキング</em>
        </h1>
        <p className="muted">
          {selectedSeasonName || 'シーズンを選択してください'}
        </p>
      </div>

      {/* Season / filter controls */}
      <div className="section card-strong">
        <div className="sec-title">FILTERS</div>
        <div className="row" style={{ gap: 12 }}>
          <select
            value={selectedSeasonId}
            onChange={(e) => void handleSeasonChange(e.target.value)}
            style={{ maxWidth: 360 }}
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.start_date} 〜 {s.end_date}){s.is_active ? ' [現在]' : ''}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost"
            onClick={() => router.push('/ranking/controllers')}
          >
            コントローラー別
          </button>
          <button
            className="btn-ghost"
            onClick={() => router.push('/ranking/games-played')}
          >
            プレイ回数別
          </button>
        </div>
      </div>

      {/* Player list */}
      <div className="section card-strong">
        <div className="sec-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tier-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z" />
            </svg>
            SEASON RANKING
          </span>
        </div>

        {loading ? (
          <LoadingCard message="ランキングを読み込み中..." />
        ) : seasons.length === 0 ? (
          <div className="empty">
            <p style={{ fontWeight: 700, marginBottom: 6 }}>シーズンが未設定です</p>
            <p className="muted">管理者がシーズンを作成してください。</p>
          </div>
        ) : players.length === 0 ? (
          <div className="empty">
            <p style={{ fontWeight: 700, marginBottom: 6 }}>{selectedSeasonName} のデータがありません</p>
            <p className="muted">この期間に完了した試合がありません。</p>
          </div>
        ) : (
          <div className="stack">
            {players.map((p, index) => {
              const tier = getTier(p.end_rating)
              const rankColor =
                index === 0
                  ? 'var(--tier-gold)'
                  : index === 1
                    ? 'var(--tier-silver)'
                    : index === 2
                      ? 'var(--tier-bronze)'
                      : 'var(--text-dim)'

              return (
                <div
                  key={p.user_id}
                  className="card glow-hover"
                  style={{ padding: '12px 18px', cursor: 'pointer' }}
                  onClick={() => router.push(`/users/${p.user_id}`)}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '36px 32px 1fr auto auto auto',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    {/* Rank */}
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 20,
                        fontWeight: 700,
                        color: rankColor,
                        textAlign: 'center',
                      }}
                    >
                      {index + 1}
                    </span>

                    {/* Avatar */}
                    <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                      {getInitials(p.display_name)}
                    </div>

                    {/* Name + tag */}
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700 }}>
                        {p.display_name || '(名前未設定)'}
                      </span>
                      {teamNames[p.user_id] && (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--text-soft)',
                            marginLeft: 8,
                          }}
                        >
                          {teamNames[p.user_id]}
                        </span>
                      )}
                    </div>

                    {/* Tier badge */}
                    <span
                      className="badge"
                      style={{
                        color: tier.color,
                        borderColor: tier.color,
                        background: `color-mix(in srgb, ${tier.color} 12%, transparent)`,
                        fontSize: 9,
                        padding: '3px 8px',
                      }}
                    >
                      <span className="badge-dot" style={{ background: tier.color, boxShadow: `0 0 10px ${tier.color}` }} />
                      {tier.label}
                    </span>

                    {/* Win / Loss */}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 13,
                        color: 'var(--text-soft)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.wins}W {p.losses}L
                    </span>

                    {/* Rating */}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 18,
                        fontWeight: 700,
                        color: 'var(--cyan)',
                        minWidth: 60,
                        textAlign: 'right',
                      }}
                    >
                      {p.end_rating ?? '-'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="row section" style={{ justifyContent: 'center', gap: 12 }}>
        <button
          className="btn-ghost"
          onClick={() => router.push('/ranking/controllers')}
        >
          コントローラー別
        </button>
        <button
          className="btn-ghost"
          onClick={() => router.push('/ranking/games-played')}
        >
          プレイ回数別
        </button>
      </div>
    </main>
  )
}
