'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingSkeleton } from '@/components/UIState'

type MyTournament = {
  id: string; title: string; format: string; status: string
  entry_mode: string; elimination_type: string; event_start: string | null
}

export default function MyTournamentsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [tournaments, setTournaments] = useState<MyTournament[]>([])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id ?? null
      if (!uid) { router.push('/login'); return }

      // Get tournament IDs where I have an entry
      const { data: entries } = await supabase
        .from('tournament_entries')
        .select('tournament_id')
        .eq('user_id', uid)
        .in('status', ['registered', 'active'])

      const tIds = [...new Set(((entries ?? []) as { tournament_id: string }[]).map(e => e.tournament_id))]

      if (tIds.length > 0) {
        // Also check team entries
        const { data: teamMember } = await supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle()
        if (teamMember) {
          const { data: teamEntries } = await supabase
            .from('tournament_entries')
            .select('tournament_id')
            .eq('team_id', (teamMember as { team_id: string }).team_id)
            .in('status', ['registered', 'active'])
          for (const e of ((teamEntries ?? []) as { tournament_id: string }[])) {
            if (!tIds.includes(e.tournament_id)) tIds.push(e.tournament_id)
          }
        }

        const { data: tData } = await supabase
          .from('tournaments')
          .select('id, title, format, status, entry_mode, elimination_type, event_start')
          .in('id', tIds)
          .in('status', ['recruit', 'live', 'seeding'])
          .order('created_at', { ascending: false })

        setTournaments((tData ?? []) as MyTournament[])
      } else {
        // Check team entries too
        const { data: teamMember } = await supabase.from('team_members').select('team_id').eq('user_id', uid).maybeSingle()
        if (teamMember) {
          const { data: teamEntries } = await supabase
            .from('tournament_entries')
            .select('tournament_id')
            .eq('team_id', (teamMember as { team_id: string }).team_id)
            .in('status', ['registered', 'active'])
          const teamTIds = ((teamEntries ?? []) as { tournament_id: string }[]).map(e => e.tournament_id)
          if (teamTIds.length > 0) {
            const { data: tData } = await supabase
              .from('tournaments')
              .select('id, title, format, status, entry_mode, elimination_type, event_start')
              .in('id', teamTIds)
              .in('status', ['recruit', 'live', 'seeding'])
              .order('created_at', { ascending: false })
            setTournaments((tData ?? []) as MyTournament[])
          }
        }
      }
      setLoading(false)
    }
    void load()
  }, [router])

  const statusLabel = (s: string) => s === 'recruit' ? '募集中' : s === 'live' ? '開催中' : s === 'seeding' ? '準備中' : s
  const statusColor = (s: string) => s === 'recruit' ? 'var(--cyan)' : s === 'live' ? 'var(--magenta)' : 'var(--amber)'

  if (loading) return <main><LoadingSkeleton cards={2} /></main>

  return (
    <main>
      <div className="eyebrow">MY TOURNAMENTS</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', marginTop: 6 }}>
        <em>出場予定の大会</em>
      </h1>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn-ghost" onClick={() => router.push('/menu')}>← メニューに戻る</button>
        <button type="button" className="btn-ghost" onClick={() => router.push('/tournaments')}>大会一覧</button>
      </div>

      <div className="section">
        {tournaments.length === 0 ? (
          <div className="empty" style={{ padding: 40 }}>
            <p>エントリー中の大会はありません</p>
            <button type="button" className="btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => router.push('/tournaments')}>大会を探す</button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {tournaments.map(t => (
              <div key={t.id} className="card glow-hover" style={{ padding: '16px 20px', cursor: 'pointer' }} onClick={() => router.push(`/tournaments/${t.id}`)}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</div>
                    <div className="row" style={{ gap: 8, marginTop: 4 }}>
                      <span className="badge" style={{ fontSize: 9 }}>{t.format === 'league' ? 'LEAGUE' : 'TOURNAMENT'}</span>
                      <span className="badge" style={{ fontSize: 9 }}>{t.entry_mode === 'team' ? 'TEAM' : 'SOLO'}</span>
                      {t.event_start && <span className="muted mono" style={{ fontSize: 11 }}>{new Date(t.event_start).toLocaleDateString('ja-JP')}</span>}
                    </div>
                  </div>
                  <span className="badge" style={{ fontSize: 10, color: statusColor(t.status), borderColor: statusColor(t.status) + '44', background: statusColor(t.status) + '11' }}>
                    <span className="badge-dot" style={{ background: statusColor(t.status) }} />{statusLabel(t.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
