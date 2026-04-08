'use client'

import { useEffect, useRef, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type AnnouncementRow = {
  id: string
  title: string
  body: string
  created_at: string
}

type PopularPostRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  published_at: string | null
  comment_count: number
}

export default function Home() {
  const router = useRouter()
  const [waitingCount, setWaitingCount] = useState<number>(0)
  const [loadingStats, setLoadingStats] = useState(true)
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [popularPosts, setPopularPosts] = useState<PopularPostRow[]>([])
  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchAnnouncements = async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) {
      console.error('fetchAnnouncements error:', error)
      return
    }
    setAnnouncements((data ?? []) as AnnouncementRow[])
  }

  const fetchPopularPosts = async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: commentRows, error: cErr } = await supabase
      .from('post_comments')
      .select('post_id, created_at')
      .gte('created_at', since)
    if (cErr) {
      console.error('fetchPopularPosts comments error:', cErr)
      return
    }

    const counts = new Map<string, number>()
    ;((commentRows ?? []) as { post_id: string }[]).forEach((r) => {
      counts.set(r.post_id, (counts.get(r.post_id) ?? 0) + 1)
    })

    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (top.length === 0) {
      setPopularPosts([])
      return
    }

    const ids = top.map(([id]) => id)
    const { data: posts, error: pErr } = await supabase
      .from('posts')
      .select('id, slug, title, excerpt, published_at, status')
      .in('id', ids)
      .eq('status', 'published')

    if (pErr) {
      console.error('fetchPopularPosts posts error:', pErr)
      return
    }

    const byId = new Map(
      ((posts ?? []) as Omit<PopularPostRow, 'comment_count'>[]).map((p) => [p.id, p])
    )
    const ordered: PopularPostRow[] = top
      .map(([id, c]) => {
        const p = byId.get(id)
        return p ? { ...p, comment_count: c } : null
      })
      .filter((x): x is PopularPostRow => x !== null)

    setPopularPosts(ordered)
  }

  const fetchStats = async () => {
    const { count, error } = await supabase
      .from('match_queue')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('fetchStats error:', error)
      setLoadingStats(false)
      return
    }

    setWaitingCount(count || 0)
    setLoadingStats(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchStats)
    void fetchAnnouncements()
    void fetchPopularPosts()

    const channel = supabase
      .channel('home-waiting-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_queue',
        },
        async () => {
          await fetchStats()
        }
      )
      .subscribe((status) => {
        console.log('home realtime status:', status)
      })

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [])

  return (
    <main>
      <div className="card-strong">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>ASCENT</h1>
            <p className="muted">
              Black Ops 7 / 4v4 / CDLルール準拠のレート対戦プラットフォーム
            </p>
          </div>

          <div className="row">
            <button onClick={() => router.push('/login')}>ログイン</button>
            <button onClick={() => router.push('/ranking')}>ランキング</button>
            <button onClick={() => router.push('/blog')}>ブログ</button>
          </div>
        </div>
      </div>

      {announcements.length > 0 && (
        <div className="section card-strong">
          <h2>運営からのお知らせ</h2>
          <div className="stack">
            {announcements.map((a) => (
              <div key={a.id} className="card">
                <h3 style={{ marginTop: 0 }}>{a.title}</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
                <p className="muted">
                  {new Date(a.created_at).toLocaleString('ja-JP')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section grid grid-2">
        <div className="card">
          <h2>現在の状況</h2>
          <div className="stack">
            <p>
              <strong>待機中チーム数:</strong>{' '}
              {loadingStats ? '取得中...' : `${waitingCount}チーム`}
            </p>
            <p className="muted">
              待機中チーム数は自動更新されます
            </p>
          </div>
        </div>

        <div className="card">
          <h2>このサイトでできること</h2>
          <div className="stack">
            <p>・Discordログインで参加</p>
            <p>・チーム作成 / メンバー管理</p>
            <p>・ランダムマッチング</p>
            <p>・試合結果の報告 / 承認 / 却下</p>
            <p>・レート変動とランキング表示</p>
            <p>・マッチ履歴の確認</p>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>週間人気ブログ</h2>
          <button onClick={() => router.push('/blog')}>ブログ一覧</button>
        </div>
        {popularPosts.length === 0 ? (
          <p className="muted">直近7日間で盛り上がっている記事はまだありません</p>
        ) : (
          <div className="stack">
            {popularPosts.map((p) => (
              <div key={p.id} className="card">
                <h3 style={{ marginTop: 0 }}>
                  <Link href={`/blog/${p.slug}`}>{p.title}</Link>
                </h3>
                {p.excerpt && <p>{p.excerpt}</p>}
                <p className="muted">コメント {p.comment_count} 件 / 直近7日</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section card-strong">
        <h2>ルール概要</h2>

        <div className="grid grid-2">
          <div className="card">
            <p>・4v4 チーム戦</p>
            <p>・Black Ops 7 / CDLルール準拠</p>
            <p>・3モード中2勝でシリーズ勝利</p>
          </div>

          <div className="card">
            <p>・対象モード: Hardpoint / S&amp;D / Overload</p>
            <p>・結果は相手チームの承認で確定</p>
            <p>・直近2試合の相手は再戦回避</p>
          </div>
        </div>

        <div className="section row">
          <button onClick={() => router.push('/rules')}>詳細ルールを見る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>はじめかた</h2>

        <div className="stack">
          <div className="card">
            <p>
              <strong>1.</strong> Discordでログイン
            </p>
          </div>

          <div className="card">
            <p>
              <strong>2.</strong> チームを作成
            </p>
          </div>

          <div className="card">
            <p>
              <strong>3.</strong> 対戦開始
            </p>
          </div>

          <div className="card">
            <p>
              <strong>4.</strong> 試合結果を報告
            </p>
          </div>
        </div>

        <div className="section row">
          <button onClick={() => router.push('/login')}>ログインして始める</button>
          <button onClick={() => router.push('/ranking')}>ランキングを見る</button>
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'center', gap: 16 }}>
        <a href="/terms">利用規約</a>
        <a href="/privacy">プライバシーポリシー</a>
      </div>
    </main>
  )
}