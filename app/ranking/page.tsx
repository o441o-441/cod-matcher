'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type ProfileRow = {
  id: string
  display_name: string | null
  current_rating: number | null
  wins: number | null
  losses: number | null
  rating_games_played: number | null
}

type SeasonRow = {
  user_id: string
  display_name: string | null
  games_played: number
  wins: number
  losses: number
  rating_change: number
  end_rating: number | null
}

type Tab = 'overall' | 'season'

export default function RankingPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overall')

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  const [players, setPlayers] = useState<ProfileRow[]>([])
  const [seasonPlayers, setSeasonPlayers] = useState<SeasonRow[]>([])
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

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

  const fetchOverall = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, current_rating, wins, losses, rating_games_played')
      .gt('rating_games_played', 0)
      .order('current_rating', { ascending: false })
      .limit(100)

    if (error) {
      console.error('ranking error:', error)
      setLoading(false)
      return
    }

    const profileList = (data || []) as ProfileRow[]
    setPlayers(profileList)
    await fetchTeamNames(profileList.map((p) => p.id))
    setLoading(false)
  }

  const fetchSeason = async (year: number, month: number) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('rpc_get_season_ranking', {
      p_year: year,
      p_month: month,
    })

    if (error) {
      console.error('season ranking error:', error)
      setLoading(false)
      return
    }

    const rows = (data || []) as SeasonRow[]
    setSeasonPlayers(rows)
    await fetchTeamNames(rows.map((r) => r.user_id))
    setLoading(false)
  }

  useEffect(() => {
    if (tab === 'overall') {
      void fetchOverall()
    } else {
      void fetchSeason(selectedYear, selectedMonth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedYear, selectedMonth])

  const monthOptions: { year: number; month: number; label: string }[] = []
  const start = new Date(2026, 3, 1) // April 2026
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const cursor = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor >= start) {
    monthOptions.push({
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
      label: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`,
    })
    cursor.setMonth(cursor.getMonth() - 1)
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ランキング</h1>
          <p className="muted">
            {tab === 'overall' ? '通算個人レート順位' : `${selectedYear}年${selectedMonth}月のシーズンランキング`}
          </p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section row">
        <button
          onClick={() => setTab('overall')}
          style={{ fontWeight: tab === 'overall' ? 'bold' : 'normal' }}
        >
          通算
        </button>
        <button
          onClick={() => setTab('season')}
          style={{ fontWeight: tab === 'season' ? 'bold' : 'normal' }}
        >
          シーズン
        </button>
        {tab === 'season' && (
          <select
            value={`${selectedYear}-${selectedMonth}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number)
              setSelectedYear(y)
              setSelectedMonth(m)
            }}
          >
            {monthOptions.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="section card-strong">
        {loading ? (
          <LoadingCard message="ランキングを読み込み中..." />
        ) : tab === 'overall' ? (
          players.length === 0 ? (
            <EmptyCard title="まだランキングデータがありません" message="試合を行うとランキングに反映されます。" />
          ) : (
            <div className="stack">
              {players.map((p, index) => {
                const wins = p.wins ?? 0
                const losses = p.losses ?? 0
                const total = wins + losses
                const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0'

                return (
                  <div key={p.id} className="card">
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p className="muted">#{index + 1}</p>
                        <h3 style={{ marginTop: 0 }}>{p.display_name || '(名前未設定)'}</h3>
                        {teamNames[p.id] && (
                          <p className="muted" style={{ marginTop: 2 }}>{teamNames[p.id]}</p>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <h3 style={{ marginTop: 0 }}>{p.current_rating ?? '-'}</h3>
                        <p className="muted">{wins}勝 {losses}敗 / 勝率 {winRate}%</p>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button onClick={() => router.push(`/users/${p.id}`)}>
                        プロフィール
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          seasonPlayers.length === 0 ? (
            <EmptyCard
              title={`${selectedYear}年${selectedMonth}月のデータがありません`}
              message="この期間に完了した試合がありません。"
            />
          ) : (
            <div className="stack">
              {seasonPlayers.map((p, index) => {
                const total = p.wins + p.losses
                const winRate = total > 0 ? ((p.wins / total) * 100).toFixed(1) : '0.0'
                const changeSign = p.rating_change > 0 ? '+' : ''

                return (
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
                          {p.end_rating ?? '-'}
                          <span
                            className="muted"
                            style={{
                              fontSize: '0.75rem',
                              marginLeft: 6,
                              color: p.rating_change > 0 ? 'var(--success)' : p.rating_change < 0 ? 'var(--danger)' : undefined,
                            }}
                          >
                            ({changeSign}{p.rating_change})
                          </span>
                        </h3>
                        <p className="muted">
                          {p.wins}勝 {p.losses}敗 / 勝率 {winRate}% / {p.games_played}試合
                        </p>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button onClick={() => router.push(`/users/${p.user_id}`)}>
                        プロフィール
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </main>
  )
}
