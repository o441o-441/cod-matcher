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
  roster_mode: 'members' | 'solo' | null
  guest_game_ids: string[] | null
}

type MemberRow = {
  user_id: string
  role: string
  display_name: string | null
}

export default function TeamsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [membersByTeam, setMembersByTeam] = useState<Record<string, MemberRow[]>>({})
  const [membersLoadingId, setMembersLoadingId] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const [{ data, error }, sessionRes] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, rating, wins, losses, matches_played, roster_mode, guest_game_ids')
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

  // メンバー一覧は誰でも閲覧可 (詳細ページ自体はメンバー+管理者限定のまま)
  const toggleMembers = async (teamId: string) => {
    if (expandedId === teamId) {
      setExpandedId(null)
      return
    }
    setExpandedId(teamId)

    if (membersByTeam[teamId]) return

    setMembersLoadingId(teamId)
    const { data, error } = await supabase
      .from('team_members')
      .select('user_id, role, profiles(display_name)')
      .eq('team_id', teamId)

    if (error) {
      console.error('team members error:', error)
      setMembersLoadingId(null)
      return
    }

    type RawMember = {
      user_id: string
      role: string
      profiles: { display_name: string | null } | { display_name: string | null }[] | null
    }
    const rows: MemberRow[] = ((data ?? []) as unknown as RawMember[])
      .map((m) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] ?? null : m.profiles
        return { user_id: m.user_id, role: m.role, display_name: p?.display_name ?? null }
      })
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0))

    setMembersByTeam((prev) => ({ ...prev, [teamId]: rows }))
    setMembersLoadingId(null)
  }

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
            {/* カードをタップするとメンバー一覧を展開表示 (誰でも閲覧可)。
                チーム詳細ページ自体は所属メンバー+管理者のみのまま */}
            {teams.map((t) => {
              const expanded = expandedId === t.id
              const members = membersByTeam[t.id]
              const guestIds = t.roster_mode === 'solo' ? t.guest_game_ids ?? [] : []
              return (
                <div
                  key={t.id}
                  className="card glow-hover"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleMembers(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMembers(t.id) } }}
                  aria-expanded={expanded}
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
                    <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                      <div className="stat">
                        <span className="stat-label">RATING</span>
                        <span className="stat-val">{t.rating ?? '-'}</span>
                      </div>
                      <span className="muted" style={{ fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                      <div className="div" />
                      <div className="stat-label" style={{ marginBottom: 8 }}>メンバー</div>

                      {membersLoadingId === t.id ? (
                        <p className="muted" style={{ fontSize: 13, margin: 0 }}>読み込み中...</p>
                      ) : !members || (members.length === 0 && guestIds.length === 0) ? (
                        <p className="muted" style={{ fontSize: 13, margin: 0 }}>メンバー情報がありません</p>
                      ) : (
                        <div className="stack-sm">
                          {members.map((m) => (
                            <div key={m.user_id} className="row" style={{ gap: 10, fontSize: 13.5 }}>
                              <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
                                {(m.display_name || '?')[0].toUpperCase()}
                              </div>
                              <span style={{ fontWeight: 600 }}>{m.display_name || '未設定'}</span>
                              {m.role === 'owner' && (
                                <span className="badge" style={{ fontSize: 9 }}>
                                  <span className="badge-dot" />
                                  OWNER
                                </span>
                              )}
                            </div>
                          ))}
                          {guestIds.map((gid) => (
                            <div key={`guest-${gid}`} className="row" style={{ gap: 10, fontSize: 13.5 }}>
                              <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
                                {gid[0]?.toUpperCase() || '?'}
                              </div>
                              <span style={{ fontWeight: 600 }}>{gid}</span>
                              <span className="badge" style={{ fontSize: 9 }}>
                                <span className="badge-dot" />
                                ゲームID登録
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {isAdmin && (
                        <div className="row" style={{ marginTop: 12 }}>
                          <button className="btn-sm btn-ghost" onClick={() => router.push(`/team/${t.id}`)}>
                            詳細ページへ (管理者)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
