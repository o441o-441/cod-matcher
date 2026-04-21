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
  win_rate: number
  current_rating: number | null
}

type SeasonOption = {
  id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
}

const ALL_SEASONS_ID = '__all__'

export default function GamesPlayedRankingPage() {
  const router = useRouter()

  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState(ALL_SEASONS_ID)
  const [selectedSeasonName, setSelectedSeasonName] = useState('全シーズン')

  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  usePageView('/ranking/games-played')

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

  const fetchRanking = async (seasonId: string) => {
    setLoading(true)
    const params = seasonId === ALL_SEASONS_ID ? {} : { p_season_id: seasonId }
    const { data, error } = await supabase.rpc('rpc_get_games_played_ranking', params)

    if (error) {
      console.error('games played ranking error:', error)
      setLoading(false)
      return
    }

    const rows = (data || []) as PlayerRow[]
    setPlayers(rows)
    await fetchTeamNames(rows.map((r) => r.user_id))
    setLoading(false)
  }

  useEffect(() => {
    const init = async () => {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, name, start_date, end_date, is_active')
        .order('start_date', { ascending: false })

      setSeasons((seasonData ?? []) as SeasonOption[])
      await fetchRanking(ALL_SEASONS_ID)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSeasonChange = async (seasonId: string) => {
    setSelectedSeasonId(seasonId)
    if (seasonId === ALL_SEASONS_ID) {
      setSelectedSeasonName('全シーズン')
    } else {
      const s = seasons.find((s) => s.id === seasonId)
      setSelectedSeasonName(s?.name ?? '')
    }
    await fetchRanking(seasonId)
  }

  return (
    <main>
      <div>
        <div className="eyebrow">GAMES PLAYED</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          ASCENT <em>プレイ回数ランキング</em>
        </h1>
        <p className="muted">{selectedSeasonName}</p>
      </div>

      <div className="section row" style={{ alignItems: 'center' }}>
        <span className="muted">シーズン:</span>
        <select
          value={selectedSeasonId}
          onChange={(e) => void handleSeasonChange(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value={ALL_SEASONS_ID}>全シーズン</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.start_date} 〜 {s.end_date}){s.is_active ? ' [現在]' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="section">
        {loading ? (
          <LoadingCard message="ランキングを読み込み中..." />
        ) : players.length === 0 ? (
          <EmptyCard
            title="データがありません"
            message="完了した試合がまだありません。"
          />
        ) : (
          <div className="stack">
            {players.map((p, index) => (
              <div key={p.user_id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p className="muted">#{index + 1}</p>
                    <h3 style={{ marginTop: 0 }}>{p.display_name || '(名前未設定)'}</h3>
                    {teamNames[p.user_id] && (
                      <p className="muted" style={{ marginTop: 2 }}>{teamNames[p.user_id]}</p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <h3 style={{ marginTop: 0 }}>
                      {p.games_played}試合
                    </h3>
                    <p className="muted">
                      {p.wins}勝 {p.losses}敗 / 勝率 {p.win_rate}%
                    </p>
                    <p className="muted">
                      レート {p.current_rating ?? '-'}
                    </p>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn-sm" onClick={() => router.push(`/users/${p.user_id}`)}>
                    プロフィール
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
