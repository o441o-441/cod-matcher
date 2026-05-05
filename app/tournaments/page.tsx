'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingSkeleton, EmptyCard } from '@/components/UIState'

type TournamentRow = {
  id: string
  title: string
  description: string | null
  format: string
  entry_mode: string
  match_format: string
  status: string
  capacity: number
  rate_cap: number | null
  seeding_method: string
  entry_deadline: string | null
  event_start: string | null
  host_user_id: string
  prize: string | null
  winner_info: { name?: string } | null
  created_at: string
  entry_count?: number
  host_name?: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  recruit: '募集中',
  seeding: 'シード中',
  live: '進行中',
  completed: '完了',
  cancelled: '中止',
}

const STATUS_COLOR: Record<string, string> = {
  recruit: 'var(--cyan)',
  live: 'var(--magenta)',
  completed: 'var(--success)',
  cancelled: 'var(--text-soft)',
  seeding: 'var(--violet)',
  draft: 'var(--text-soft)',
}

export default function TournamentsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) setMyUserId(session.user.id)

      const { data, error } = await supabase
        .from('tournaments')
        .select('*')
        .in('status', ['recruit', 'live', 'seeding', 'completed'])
        .order('created_at', { ascending: false })

      if (error) {
        showToast('大会一覧の取得に失敗しました', 'error')
        setLoading(false)
        return
      }

      const rows = (data ?? []) as TournamentRow[]

      // エントリー数と主催者名を取得
      if (rows.length > 0) {
        const ids = rows.map(r => r.id)
        const hostIds = [...new Set(rows.map(r => r.host_user_id))]

        const [entryCounts, hostProfiles] = await Promise.all([
          supabase.from('tournament_entries').select('tournament_id').in('tournament_id', ids),
          supabase.from('profiles').select('id, display_name').in('id', hostIds),
        ])

        const countMap = new Map<string, number>()
        for (const e of (entryCounts.data ?? []) as { tournament_id: string }[]) {
          countMap.set(e.tournament_id, (countMap.get(e.tournament_id) ?? 0) + 1)
        }

        const nameMap = new Map(
          (hostProfiles.data ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name])
        )

        for (const r of rows) {
          r.entry_count = countMap.get(r.id) ?? 0
          r.host_name = nameMap.get(r.host_user_id) ?? undefined
        }
      }

      setTournaments(rows)
      setLoading(false)
    }

    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <main>
        <div className="eyebrow">TOURNAMENTS</div>
        <h1 className="display"><em>大会</em></h1>
        <LoadingSkeleton cards={3} />
      </main>
    )
  }

  const openTournaments = tournaments.filter(t => t.status === 'recruit' || t.status === 'live' || t.status === 'seeding')
  const closedTournaments = tournaments.filter(t => t.status === 'completed')

  return (
    <main>
      <div className="eyebrow">TOURNAMENTS</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        <em>大会</em>
      </h1>
      <p className="muted">リーグ・トーナメント。誰でも開ける、誰でも参加できる。</p>

      <div className="section row">
        <button className="btn-primary" onClick={() => router.push('/tournaments/create')}>
          大会を開催する
        </button>
      </div>

      {/* 募集中・進行中 */}
      <div className="section">
        <p className="sec-title">募集中・進行中</p>
        {openTournaments.length === 0 ? (
          <EmptyCard title="現在開催中の大会はありません" message="自分で大会を開催してみましょう" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {openTournaments.map(t => (
              <TournamentCard key={t.id} t={t} onClick={() => router.push(`/tournaments/${t.id}`)} />
            ))}
          </div>
        )}
      </div>

      {/* 完了 */}
      {closedTournaments.length > 0 && (
        <div className="section">
          <p className="sec-title">過去の大会</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {closedTournaments.map(t => (
              <TournamentCard key={t.id} t={t} onClick={() => router.push(`/tournaments/${t.id}`)} />
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

function TournamentCard({ t, onClick }: { t: TournamentRow; onClick: () => void }) {
  const pct = t.capacity > 0 ? Math.min(100, ((t.entry_count ?? 0) / t.capacity) * 100) : 0

  return (
    <div className="card-strong" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }} onClick={onClick}>
      <div className="row" style={{ gap: 8 }}>
        <span className="badge" style={{ fontSize: 9, background: t.format === 'tournament' ? 'var(--cyan-dim)' : 'var(--violet-dim, rgba(139,92,246,0.15))', color: t.format === 'tournament' ? 'var(--cyan)' : 'var(--violet, #8b5cf6)' }}>
          {t.format === 'tournament' ? 'TOURNAMENT' : 'LEAGUE'}
        </span>
        <span className="badge" style={{ fontSize: 9 }}>
          {t.entry_mode === 'team' ? 'TEAM 4v4' : 'SOLO → 4v4'}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[t.status] ?? 'var(--text-soft)' }}>
          {STATUS_LABEL[t.status] ?? t.status}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: 16 }}>{t.title}</h3>

      {t.winner_info?.name && (
        <div className="row" style={{ gap: 6 }}>
          <span className="badge" style={{ fontSize: 9, background: 'rgba(255,215,0,0.15)', color: 'var(--gold, #ffd700)' }}>CHAMPION</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold, #ffd700)' }}>{t.winner_info.name}</span>
        </div>
      )}

      <div className="row" style={{ gap: 12, fontSize: 12, color: 'var(--text-soft)' }}>
        <span><strong>{t.entry_count ?? 0}</strong>/{t.capacity} {t.entry_mode === 'team' ? 'teams' : 'players'}</span>
        {t.rate_cap && <span style={{ color: 'var(--amber, #f59e0b)' }}>≤ {t.rate_cap}</span>}
        {t.event_start && <span>{new Date(t.event_start).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {t.status === 'recruit' && (
        <div className="bar" style={{ height: 4, marginTop: 4 }}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 }}>
        <span className="muted" style={{ fontSize: 11 }}>HOST · {t.host_name ?? '不明'}</span>
        {t.prize && <span style={{ fontSize: 11, color: 'var(--gold, #ffd700)' }}>{t.prize}</span>}
      </div>
    </div>
  )
}
