'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'

// ============================================================
// 運営用: 交流戦キャンペーンの集計・抽選ページ
//   「期間中、毎週N回以上交流戦をしたチームから抽選でMチーム」
//   集計・抽選は rpc_scrim_campaign_stats / draw / history (管理者のみ)。
//   週の区切りは開始日から7日ごと (端数日は最終週に含む)。
//   抽選結果は campaign_draws に保存され、履歴として残る。
// ============================================================

type WeekRange = { start: string; end: string }
type TeamRow = {
  team_id: string
  name: string
  roster_mode: string
  disbanded: boolean
  weekly: number[]
  total: number
  eligible: boolean
}
type Stats = { start: string; end: string; weekly_required: number; weeks: WeekRange[]; teams: TeamRow[] }
type Winner = { team_id: string; name: string }
type DrawHistory = {
  id: string
  campaign: string
  period_start: string
  period_end: string
  weekly_required: number
  winners_count: number
  eligible_count: number
  winners: Winner[]
  drawn_at: string
  drawn_by_name: string | null
}

const md = (s: string) => {
  const d = new Date(s + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function AdminCampaignPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const [campaign, setCampaign] = useState('交流戦キャンペーン 2026-11')
  const [start, setStart] = useState('2026-11-06')
  const [end, setEnd] = useState('2026-11-27')
  const [weekly, setWeekly] = useState(2)
  const [winners, setWinners] = useState(5)

  const [stats, setStats] = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [lastDraw, setLastDraw] = useState<{ winners: Winner[]; eligible_count: number } | null>(null)
  const [history, setHistory] = useState<DrawHistory[]>([])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    const { data, error } = await supabase.rpc('rpc_scrim_campaign_stats', {
      p_start: start, p_end: end, p_weekly: weekly,
    })
    setStatsLoading(false)
    if (error) { showToast('集計に失敗しました: ' + error.message, 'error'); return }
    setStats(data as Stats)
  }, [start, end, weekly, showToast])

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.rpc('rpc_scrim_campaign_history')
    if (!error) setHistory((data ?? []) as DrawHistory[])
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }
      const { data: me } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()
      if (!me?.is_admin) { showToast('権限がありません', 'error'); router.push('/menu'); return }
      setAuthorized(true)
      await Promise.all([loadStats(), loadHistory()])
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDraw = async () => {
    const eligibleCount = stats?.teams.filter(t => t.eligible).length ?? 0
    if (!confirm(`対象 ${eligibleCount} チームから ${winners} チームを抽選します。結果は履歴に保存されます。実行しますか？`)) return
    setDrawing(true)
    const { data, error } = await supabase.rpc('rpc_scrim_campaign_draw', {
      p_campaign: campaign.trim() || 'キャンペーン',
      p_start: start, p_end: end, p_weekly: weekly, p_winners: winners,
    })
    setDrawing(false)
    if (error) { showToast('抽選に失敗しました: ' + error.message, 'error'); return }
    const res = data as { winners: Winner[]; eligible_count: number }
    setLastDraw(res)
    showToast('抽選が完了しました', 'success')
    void loadHistory()
  }

  if (loading || !authorized) {
    return (
      <main>
        <div className="eyebrow">ADMIN / CAMPAIGN</div>
        <h1 className="display" style={{ marginBottom: 8 }}><em>キャンペーン</em>集計</h1>
        <LoadingCard />
      </main>
    )
  }

  const eligibleTeams = stats?.teams.filter(t => t.eligible) ?? []

  return (
    <main>
      <div className="eyebrow">ADMIN / CAMPAIGN</div>
      <h1 className="display" style={{ marginBottom: 8 }}><em>キャンペーン</em>集計・抽選</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        期間を週単位 (開始日から7日ごと・端数は最終週) に区切り、全ての週で規定回数以上
        交流戦 (成立済み・キャンセル除外) をしたチームが抽選対象になります。
      </p>

      {/* 設定 */}
      <div className="section card-strong">
        <div className="sec-title">集計条件</div>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <div>
            <label className="stat-label">キャンペーン名</label>
            <input value={campaign} onChange={e => setCampaign(e.target.value)} style={{ marginTop: 4 }} />
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label className="stat-label">開始日</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ marginTop: 4 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="stat-label">終了日</label>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ marginTop: 4 }} />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="stat-label">週あたり必要回数</label>
              <input type="number" min={1} value={weekly} onChange={e => setWeekly(Math.max(1, Number(e.target.value)))} style={{ marginTop: 4 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="stat-label">当選チーム数</label>
              <input type="number" min={1} value={winners} onChange={e => setWinners(Math.max(1, Number(e.target.value)))} style={{ marginTop: 4 }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn-primary" onClick={() => void loadStats()} disabled={statsLoading}>
              {statsLoading ? '集計中...' : '集計する'}
            </button>
          </div>
        </div>
      </div>

      {/* 抽選結果 (直近実行分) */}
      {lastDraw && (
        <div className="section card-strong" style={{ borderLeft: '3px solid var(--amber)' }}>
          <div className="sec-title">🎉 抽選結果</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>対象 {lastDraw.eligible_count} チームから抽選</p>
          <div className="stack-sm">
            {lastDraw.winners.map((w, i) => (
              <div key={w.team_id} className="card" style={{ padding: '10px 14px' }}>
                <span className="mono" style={{ color: 'var(--amber)', fontWeight: 800, marginRight: 10 }}>#{i + 1}</span>
                <span style={{ fontWeight: 700 }}>{w.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 集計テーブル */}
      {stats && (
        <div className="section card-strong">
          <div className="rowx">
            <div className="sec-title" style={{ marginBottom: 0 }}>
              集計結果 — 対象 <span style={{ color: 'var(--success)' }}>{eligibleTeams.length}</span> チーム / 参加 {stats.teams.length} チーム
            </div>
            <button className="btn-primary" onClick={() => void handleDraw()} disabled={drawing || eligibleTeams.length === 0}>
              {drawing ? '抽選中...' : `抽選する (${winners}チーム)`}
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>チーム</th>
                  {stats.weeks.map((w, i) => (
                    <th key={i} style={{ padding: '6px 8px', textAlign: 'center' }} className="mono">
                      W{i + 1}<span className="muted" style={{ fontWeight: 400 }}> ({md(w.start)}–{md(w.end)})</span>
                    </th>
                  ))}
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>合計</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>対象</th>
                </tr>
              </thead>
              <tbody>
                {stats.teams.length === 0 ? (
                  <tr><td colSpan={stats.weeks.length + 3} className="muted" style={{ padding: 12 }}>期間内の交流戦はまだありません</td></tr>
                ) : stats.teams.map(t => (
                  <tr key={t.team_id} style={{ borderBottom: '1px solid var(--line)', opacity: t.disbanded ? 0.5 : 1 }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                      {t.name}
                      {t.roster_mode === 'solo' && <span className="badge" style={{ fontSize: 9, marginLeft: 6 }}>代表者のみ型</span>}
                      {t.disbanded && <span className="badge danger" style={{ fontSize: 9, marginLeft: 6 }}>解散済み</span>}
                    </td>
                    {t.weekly.map((c, i) => (
                      <td key={i} className="mono" style={{ padding: '6px 8px', textAlign: 'center', color: c >= stats.weekly_required ? 'var(--success)' : c > 0 ? 'var(--amber)' : 'var(--text-dim)' }}>
                        {c}
                      </td>
                    ))}
                    <td className="mono" style={{ padding: '6px 8px', textAlign: 'center' }}>{t.total}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>{t.eligible ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 抽選履歴 */}
      <div className="section card-strong">
        <div className="sec-title">抽選履歴</div>
        {history.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>まだ抽選は実行されていません</p>
        ) : (
          <div className="stack-sm">
            {history.map(h => (
              <div key={h.id} className="card" style={{ padding: '10px 14px' }}>
                <div className="rowx">
                  <span style={{ fontWeight: 700 }}>{h.campaign}</span>
                  <span className="muted mono" style={{ fontSize: 11 }}>{new Date(h.drawn_at).toLocaleString('ja-JP')}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  期間 {md(h.period_start)}〜{md(h.period_end)} · 週{h.weekly_required}回以上 · 対象{h.eligible_count}チーム
                  {h.drawn_by_name ? ` · 実行: ${h.drawn_by_name}` : ''}
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  🎉 {h.winners.map(w => w.name).join(' / ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
