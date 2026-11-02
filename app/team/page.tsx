'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const init = async () => {
      const [{ data, error }, sessionRes] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, rating, wins, losses, matches_played')
          .eq('is_disbanded', false)
          .order('rating', { ascending: false })
          .limit(50),
        supabase.auth.getSession(),
      ])

      if (error) {
        console.error('teams list error:', error)
      } else {
        setTeams((data ?? []) as TeamRow[])
      }

      // 管理者のみチーム詳細ページへのリンクを表示 (詳細ページは管理者バイパスあり)
      const uid = sessionRes.data.session?.user?.id
      if (uid) {
        const { data: me } = await supabase
          .from('profiles').select('is_admin').eq('id', uid)
          .maybeSingle<{ is_admin: boolean | null }>()
        setIsAdmin(!!me?.is_admin)
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
            {/* チームページは所属メンバーのみ閲覧可のため、一般ユーザーにはリンクしない。
                管理者のみ詳細ページへ飛べる (詳細ページ側に管理者バイパスあり) */}
            {teams.map((t) => (
              <div
                key={t.id}
                className={isAdmin ? 'card glow-hover' : 'card'}
                style={isAdmin ? { cursor: 'pointer' } : undefined}
                onClick={isAdmin ? () => router.push(`/team/${t.id}`) : undefined}
                role={isAdmin ? 'button' : undefined}
                tabIndex={isAdmin ? 0 : undefined}
                onKeyDown={isAdmin ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/team/${t.id}`) } } : undefined}
              >
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
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
