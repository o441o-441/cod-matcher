'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'

type MonthlyData = {
  month: string
  matches: number
  activeUsers: number
  newUsers: number
}

type TopPlayer = {
  user_id: string
  display_name: string | null
  games: number
  wins: number
  rating: number | null
}

type ReportStats = {
  total: number
  open: number
  reviewing: number
  resolved: number
  dismissed: number
}

type ControllerStat = {
  controller: string
  count: number
}

type PlatformStat = {
  platform: string
  count: number
}

type ClickStat = {
  controller: string
  total: number
  thisMonth: number
}

type PageViewStat = {
  page: string
  total: number
  thisMonth: number
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const [totalUsers, setTotalUsers] = useState(0)
  const [activeThisMonth, setActiveThisMonth] = useState(0)
  const [newThisMonth, setNewThisMonth] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const [matchesThisMonth, setMatchesThisMonth] = useState(0)
  const [totalPosts, setTotalPosts] = useState(0)
  const [postsThisMonth, setPostsThisMonth] = useState(0)
  const [commentsThisMonth, setCommentsThisMonth] = useState(0)
  const [likesThisMonth, setLikesThisMonth] = useState(0)
  const [bannedCount, setBannedCount] = useState(0)
  const [suspendedCount, setSuspendedCount] = useState(0)
  const [monitorCount, setMonitorCount] = useState(0)
  const [approvedCount, setApprovedCount] = useState(0)
  const [reportStats, setReportStats] = useState<ReportStats>({ total: 0, open: 0, reviewing: 0, resolved: 0, dismissed: 0 })
  const [topPlayers, setTopPlayers] = useState<TopPlayer[]>([])
  const [controllers, setControllers] = useState<ControllerStat[]>([])
  const [platforms, setPlatforms] = useState<PlatformStat[]>([])
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([])
  const [disputedCount, setDisputedCount] = useState(0)
  const [voidedCount, setVoidedCount] = useState(0)
  const [clickStats, setClickStats] = useState<ClickStat[]>([])
  const [totalClicksThisMonth, setTotalClicksThisMonth] = useState(0)
  const [pageViewStats, setPageViewStats] = useState<PageViewStat[]>([])
  const [totalViewsThisMonth, setTotalViewsThisMonth] = useState(0)
  const [totalViewsAllTime, setTotalViewsAllTime] = useState(0)

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()

      if (!me?.is_admin) {
        showToast('このページにアクセスする権限がありません', 'error')
        router.push('/menu')
        return
      }

      setAuthorized(true)

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      // Basic counts
      const [
        { count: tu }, { count: tm }, { count: tmm },
        { count: tp }, { count: tpm }, { count: tcm }, { count: tlm },
        { count: bc }, { count: sc }, { count: mc }, { count: ac },
        { count: dc }, { count: vc },
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', monthStart),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published').gte('created_at', monthStart),
        supabase.from('post_comments').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
        supabase.from('post_likes').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_banned', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).gt('suspended_until', now.toISOString()),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_monitor', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_approved', true),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('disputed', true),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('approval_status', 'voided'),
      ])

      setTotalUsers(tu ?? 0)
      setTotalMatches(tm ?? 0)
      setMatchesThisMonth(tmm ?? 0)
      setTotalPosts(tp ?? 0)
      setPostsThisMonth(tpm ?? 0)
      setCommentsThisMonth(tcm ?? 0)
      setLikesThisMonth(tlm ?? 0)
      setBannedCount(bc ?? 0)
      setSuspendedCount(sc ?? 0)
      setMonitorCount(mc ?? 0)
      setApprovedCount(ac ?? 0)
      setDisputedCount(dc ?? 0)
      setVoidedCount(vc ?? 0)

      // Active users this month
      const { data: activeData } = await supabase.from('rating_history').select('user_id').gte('created_at', monthStart)
      const activeSet = new Set((activeData ?? []).map((r: { user_id: string }) => r.user_id))
      setActiveThisMonth(activeSet.size)

      // New users this month
      const { count: nu } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', monthStart)
      setNewThisMonth(nu ?? 0)

      // Report stats
      const { data: reports } = await supabase.from('reports').select('status')
      const rs: ReportStats = { total: 0, open: 0, reviewing: 0, resolved: 0, dismissed: 0 }
      for (const r of (reports ?? []) as { status: string }[]) {
        rs.total++
        if (r.status === 'open') rs.open++
        else if (r.status === 'reviewing') rs.reviewing++
        else if (r.status === 'resolved') rs.resolved++
        else if (r.status === 'dismissed') rs.dismissed++
      }
      setReportStats(rs)

      // Top players this month
      const { data: ratingData } = await supabase.from('rating_history').select('user_id, rating_delta').gte('created_at', monthStart)
      const playerMap = new Map<string, { games: number; wins: number }>()
      for (const r of (ratingData ?? []) as { user_id: string; rating_delta: number }[]) {
        const prev = playerMap.get(r.user_id) ?? { games: 0, wins: 0 }
        prev.games++
        if (r.rating_delta > 0) prev.wins++
        playerMap.set(r.user_id, prev)
      }
      const topIds = [...playerMap.entries()]
        .sort((a, b) => b[1].wins - a[1].wins)
        .slice(0, 5)
        .map(([id]) => id)

      if (topIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, display_name, current_rating').in('id', topIds)
        const profMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null; current_rating: number | null }) => [p.id, p]))
        const top: TopPlayer[] = topIds.map((id) => {
          const p = profMap.get(id)
          const s = playerMap.get(id)!
          return { user_id: id, display_name: p?.display_name ?? null, games: s.games, wins: s.wins, rating: p?.current_rating ?? null }
        })
        setTopPlayers(top)
      }

      // Controller distribution
      const { data: ctrlData } = await supabase.from('users').select('controller').not('controller', 'is', null)
      const ctrlMap = new Map<string, number>()
      for (const u of (ctrlData ?? []) as { controller: string | null }[]) {
        if (u.controller) ctrlMap.set(u.controller, (ctrlMap.get(u.controller) ?? 0) + 1)
      }
      setControllers([...ctrlMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([controller, count]) => ({ controller, count })))

      // Platform distribution
      const { data: platData } = await supabase.from('users').select('platform').not('platform', 'is', null)
      const platMap = new Map<string, number>()
      for (const u of (platData ?? []) as { platform: string | null }[]) {
        if (u.platform) platMap.set(u.platform, (platMap.get(u.platform) ?? 0) + 1)
      }
      setPlatforms([...platMap.entries()].sort((a, b) => b[1] - a[1]).map(([platform, count]) => ({ platform, count })))

      // Monthly trend (last 6 months)
      const months: MonthlyData[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const mStart = d.toISOString()
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
        const label = `${d.getFullYear()}/${d.getMonth() + 1}`

        const { count: mc2 } = await supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', mStart).lt('completed_at', mEnd)
        const { data: maData } = await supabase.from('rating_history').select('user_id').gte('created_at', mStart).lt('created_at', mEnd)
        const maSet = new Set((maData ?? []).map((r: { user_id: string }) => r.user_id))
        const { count: nu2 } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', mStart).lt('created_at', mEnd)

        months.push({ month: label, matches: mc2 ?? 0, activeUsers: maSet.size, newUsers: nu2 ?? 0 })
      }
      setMonthlyData(months)

      // Link click stats
      const { data: allClicks } = await supabase.from('link_clicks').select('controller_name, created_at')
      const clickMap = new Map<string, { total: number; thisMonth: number }>()
      let monthClicks = 0
      for (const c of (allClicks ?? []) as { controller_name: string; created_at: string }[]) {
        const prev = clickMap.get(c.controller_name) ?? { total: 0, thisMonth: 0 }
        prev.total++
        if (c.created_at >= monthStart) {
          prev.thisMonth++
          monthClicks++
        }
        clickMap.set(c.controller_name, prev)
      }
      setClickStats(
        [...clickMap.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([controller, s]) => ({ controller, ...s }))
      )
      setTotalClicksThisMonth(monthClicks)

      // Page view stats
      const { data: allViews } = await supabase.from('page_views').select('page_path, created_at')
      const pvMap = new Map<string, { total: number; thisMonth: number }>()
      let mvTotal = 0
      let mvMonth = 0
      for (const v of (allViews ?? []) as { page_path: string; created_at: string }[]) {
        const prev = pvMap.get(v.page_path) ?? { total: 0, thisMonth: 0 }
        prev.total++
        mvTotal++
        if (v.created_at >= monthStart) {
          prev.thisMonth++
          mvMonth++
        }
        pvMap.set(v.page_path, prev)
      }
      setPageViewStats(
        [...pvMap.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([page, s]) => ({ page, ...s }))
      )
      setTotalViewsAllTime(mvTotal)
      setTotalViewsThisMonth(mvMonth)

      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading || !authorized) {
    return (
      <main>
        <h1>運営ダッシュボード</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  const now = new Date()
  const ml = `${now.getFullYear()}年${now.getMonth() + 1}月`

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>運営ダッシュボード</h1>
          <p className="muted">プラットフォーム統計 / KPI</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/admin/reports')}>通報管理</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>ユーザー概況</h2>
        <div className="grid grid-3">
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">総登録者数</p>
            <h3 style={{ fontSize: '1.5rem' }}>{totalUsers}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} アクティブ</p>
            <h3 style={{ fontSize: '1.5rem' }}>{activeThisMonth}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} 新規登録</p>
            <h3 style={{ fontSize: '1.5rem' }}>{newThisMonth}</h3>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>試合統計</h2>
        <div className="grid grid-2">
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">総試合数</p>
            <h3 style={{ fontSize: '1.5rem' }}>{totalMatches}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} の試合数</p>
            <h3 style={{ fontSize: '1.5rem' }}>{matchesThisMonth}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">disputed 試合</p>
            <h3 style={{ fontSize: '1.5rem' }}>{disputedCount}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">無効試合</p>
            <h3 style={{ fontSize: '1.5rem' }}>{voidedCount}</h3>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>月間推移（直近6ヶ月）</h2>
        <div className="stack">
          <div className="card">
            <div className="grid grid-2" style={{ gap: 4 }}>
              <div className="muted" style={{ fontWeight: 'bold' }}>月</div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontWeight: 'bold', flex: 1, textAlign: 'center' }}>試合</span>
                <span className="muted" style={{ fontWeight: 'bold', flex: 1, textAlign: 'center' }}>アクティブ</span>
                <span className="muted" style={{ fontWeight: 'bold', flex: 1, textAlign: 'center' }}>新規</span>
              </div>
              {monthlyData.map((m) => (
                <>
                  <div key={`l-${m.month}`}>{m.month}</div>
                  <div key={`v-${m.month}`} className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ flex: 1, textAlign: 'center' }}>{m.matches}</span>
                    <span style={{ flex: 1, textAlign: 'center' }}>{m.activeUsers}</span>
                    <span style={{ flex: 1, textAlign: 'center' }}>{m.newUsers}</span>
                  </div>
                </>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>{ml} の上位プレイヤー</h2>
        {topPlayers.length === 0 ? (
          <p className="muted">データなし</p>
        ) : (
          <div className="stack">
            {topPlayers.map((p, i) => (
              <div key={p.user_id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="muted">#{i + 1} </span>
                    <strong>{p.display_name ?? '(不明)'}</strong>
                  </div>
                  <div className="muted">
                    {p.wins}勝 / {p.games}試合 / レート {p.rating ?? '-'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section card-strong">
        <h2>モデレーション</h2>
        <div className="grid grid-2">
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">BAN 中</p>
            <h3>{bannedCount}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">一時停止中</p>
            <h3>{suspendedCount}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">監視ユーザー</p>
            <h3>{monitorCount}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">承認ユーザー</p>
            <h3>{approvedCount}</h3>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>通報状況</h2>
        <div className="grid grid-3">
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">総通報数</p>
            <h3>{reportStats.total}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">受付中</p>
            <h3>{reportStats.open}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">確認中</p>
            <h3>{reportStats.reviewing}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">対応済み</p>
            <h3>{reportStats.resolved}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">却下</p>
            <h3>{reportStats.dismissed}</h3>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>ブログ活動</h2>
        <div className="grid grid-2">
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">総投稿数</p>
            <h3>{totalPosts}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} 投稿</p>
            <h3>{postsThisMonth}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} コメント</p>
            <h3>{commentsThisMonth}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} いいね</p>
            <h3>{likesThisMonth}</h3>
          </div>
        </div>
      </div>

      <div className="section grid grid-2">
        <div className="card-strong">
          <h2>コントローラー分布</h2>
          {controllers.length === 0 ? (
            <p className="muted">データなし</p>
          ) : (
            <div className="stack">
              {controllers.map((c) => (
                <div key={c.controller} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{c.controller}</span>
                    <span className="muted">{c.count}人</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card-strong">
          <h2>プラットフォーム分布</h2>
          {platforms.length === 0 ? (
            <p className="muted">データなし</p>
          ) : (
            <div className="stack">
              {platforms.map((p) => (
                <div key={p.platform} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{p.platform}</span>
                    <span className="muted">{p.count}人</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section card-strong">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>購入リンク クリック数</h2>
          <button onClick={() => router.push('/admin/affiliates')}>リンク管理</button>
        </div>
        <div className="card" style={{ textAlign: 'center', marginBottom: 12 }}>
          <p className="muted">{ml} の総クリック数</p>
          <h3 style={{ fontSize: '1.5rem' }}>{totalClicksThisMonth}</h3>
        </div>
        {clickStats.length === 0 ? (
          <p className="muted">クリックデータなし</p>
        ) : (
          <div className="stack">
            {clickStats.map((c) => (
              <div key={c.controller} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{c.controller}</span>
                  <span className="muted">
                    今月 {c.thisMonth} / 累計 {c.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section card-strong">
        <h2>ページ閲覧数</h2>
        <div className="grid grid-2" style={{ marginBottom: 12 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">総閲覧数（全期間）</p>
            <h3 style={{ fontSize: '1.5rem' }}>{totalViewsAllTime}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">{ml} の閲覧数</p>
            <h3 style={{ fontSize: '1.5rem' }}>{totalViewsThisMonth}</h3>
          </div>
        </div>
        {pageViewStats.length === 0 ? (
          <p className="muted">閲覧データなし</p>
        ) : (
          <div className="stack">
            {pageViewStats.map((pv) => (
              <div key={pv.page} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{pv.page}</span>
                  <span className="muted">今月 {pv.thisMonth} / 累計 {pv.total}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
