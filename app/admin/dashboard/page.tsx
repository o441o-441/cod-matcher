'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'

type Stats = {
  totalUsers: number
  activeUsersThisMonth: number
  newUsersThisMonth: number
  totalMatchesAllTime: number
  matchesThisMonth: number
  blogPostsThisMonth: number
  commentsThisMonth: number
  totalBlogPosts: number
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

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

      const [
        { count: totalUsers },
        { count: totalMatchesAllTime },
        { count: matchesThisMonth },
        { count: totalBlogPosts },
        { count: blogPostsThisMonth },
        { count: commentsThisMonth },
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', monthStart),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published').gte('created_at', monthStart),
        supabase.from('post_comments').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      ])

      const { data: activeData } = await supabase
        .from('rating_history')
        .select('user_id')
        .gte('created_at', monthStart)
      const activeSet = new Set((activeData ?? []).map((r: { user_id: string }) => r.user_id))

      const { data: newUsers } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart)

      setStats({
        totalUsers: totalUsers ?? 0,
        activeUsersThisMonth: activeSet.size,
        newUsersThisMonth: (newUsers as unknown as { count: number })?.count ?? 0,
        totalMatchesAllTime: totalMatchesAllTime ?? 0,
        matchesThisMonth: matchesThisMonth ?? 0,
        totalBlogPosts: totalBlogPosts ?? 0,
        blogPostsThisMonth: blogPostsThisMonth ?? 0,
        commentsThisMonth: commentsThisMonth ?? 0,
      })

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
  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>運営ダッシュボード</h1>
          <p className="muted">KPI / プラットフォーム統計</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      {stats && (
        <>
          <div className="section card-strong">
            <h2>ユーザー</h2>
            <div className="grid grid-3">
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">総登録者数</p>
                <h3>{stats.totalUsers}</h3>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">{monthLabel} アクティブ</p>
                <h3>{stats.activeUsersThisMonth}</h3>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">{monthLabel} 新規登録</p>
                <h3>{stats.newUsersThisMonth}</h3>
              </div>
            </div>
          </div>

          <div className="section card-strong">
            <h2>試合</h2>
            <div className="grid grid-2">
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">総試合数（全期間）</p>
                <h3>{stats.totalMatchesAllTime}</h3>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">{monthLabel} の試合数</p>
                <h3>{stats.matchesThisMonth}</h3>
              </div>
            </div>
          </div>

          <div className="section card-strong">
            <h2>ブログ</h2>
            <div className="grid grid-3">
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">総投稿数</p>
                <h3>{stats.totalBlogPosts}</h3>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">{monthLabel} の投稿</p>
                <h3>{stats.blogPostsThisMonth}</h3>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="muted">{monthLabel} のコメント</p>
                <h3>{stats.commentsThisMonth}</h3>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
