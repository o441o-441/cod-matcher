'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'
import { usePageView } from '@/lib/usePageView'

type SeasonRow = {
  user_id: string
  display_name: string | null
  games_played: number
  wins: number
  losses: number
  rating_change: number
  end_rating: number | null
}

export default function RankingPage() {
  const router = useRouter()

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  const [players, setPlayers] = useState<SeasonRow[]>([])
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
    setPlayers(rows)
    const ids = rows.map((r) => r.user_id)
    await Promise.all([fetchTeamNames(ids), fetchControllers(ids)])
    setLoading(false)
  }

  useEffect(() => {
    void fetchSeason(selectedYear, selectedMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth])

  const monthOptions: { year: number; month: number; label: string }[] = []
  const start = new Date(2026, 3, 1)
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
          <p className="muted">{selectedYear}年{selectedMonth}月 シーズンランキング</p>
        </div>
        <div className="row">
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
          <button onClick={() => router.push('/ranking/controllers')}>コントローラー</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {loading ? (
          <LoadingCard message="ランキングを読み込み中..." />
        ) : players.length === 0 ? (
          <EmptyCard
            title={`${selectedYear}年${selectedMonth}月のデータがありません`}
            message="この期間に完了した試合がありません。"
          />
        ) : (
          <div className="stack">
            {players.map((p, index) => {
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
                      {controllers[p.user_id] && (
                        <p className="muted" style={{ marginTop: 2 }}>{controllers[p.user_id]}</p>
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
        )}
      </div>
    </main>
  )
}
