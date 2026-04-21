'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type TeamRow = {
  id: string
  name: string
  rating: number | null
  wins: number | null
  losses: number | null
  matches_played: number | null
}

export default function TeamsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [teams, setTeams] = useState<TeamRow[]>([])

  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, rating, wins, losses, matches_played')
        .eq('is_disbanded', false)
        .order('rating', { ascending: false })
        .limit(50)

      if (error) {
        console.error('teams list error:', error)
      } else {
        setTeams((data ?? []) as TeamRow[])
      }
      setLoading(false)
    }

    void Promise.resolve().then(init)
  }, [])

  return (
    <main>
      <div className="eyebrow">TEAMS</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Teams</em>
      </h1>
      <p className="muted">登録されているチーム一覧</p>

      <div className="section card-strong">
        <div className="sec-title">チーム一覧</div>
        {loading ? (
          <LoadingCard message="読み込み中..." />
        ) : teams.length === 0 ? (
          <EmptyCard title="チームがありません" message="" />
        ) : (
          <div className="stack">
            {teams.map((t) => (
              <Link key={t.id} href={`/team/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card glow-hover">
                  <div className="rowx">
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem' }}>
                        {t.name}
                      </div>
                      <p className="muted">
                        {t.wins ?? 0}勝 {t.losses ?? 0}敗 / {t.matches_played ?? 0}試合
                      </p>
                    </div>
                    <div className="stat">
                      <span className="stat-label">RATING</span>
                      <span className="stat-val">{t.rating ?? '-'}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
