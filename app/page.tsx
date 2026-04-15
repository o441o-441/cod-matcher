'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { usePageView } from '@/lib/usePageView'

type AnnouncementRow = {
  id: string
  title: string
  body: string
  created_at: string
}

type TournamentRow = {
  id: string
  title: string
  body: string
  event_date: string | null
  event_date_end: string | null
  entry_deadline: string | null
  created_at: string
}

type PopularPostRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  published_at: string | null
  view_count: number
  score: number
  like_count: number
  comment_count: number
  controller_name: string | null
  rating: number | null
}

type RecentPostRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  published_at: string | null
  controller_name: string | null
  rating: number | null
}

export default function Home() {
  const router = useRouter()
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [popularPosts, setPopularPosts] = useState<PopularPostRow[]>([])
  const [recentPosts, setRecentPosts] = useState<RecentPostRow[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])

  const fetchTournaments = async () => {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, title, body, event_date, event_date_end, entry_deadline, created_at')
      .eq('is_active', true)
      .order('entry_deadline', { ascending: true, nullsFirst: false })
      .limit(5)
    if (error) {
      console.error('fetchTournaments error:', error)
      return
    }
    setTournaments((data ?? []) as TournamentRow[])
  }

  usePageView('/')

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

    const { data: posts, error: pErr } = await supabase
      .from('posts')
      .select('id, slug, title, excerpt, published_at, view_count, controller_name, rating')
      .eq('status', 'published')
    if (pErr) {
      console.error('fetchPopularPosts error:', pErr)
      return
    }
    const postList = (posts ?? []) as { id: string; slug: string; title: string; excerpt: string | null; published_at: string | null; view_count: number; controller_name: string | null; rating: number | null }[]
    if (postList.length === 0) { setPopularPosts([]); return }

    const postIds = postList.map((p) => p.id)

    const [{ data: commentRows }, { data: likeRows }] = await Promise.all([
      supabase.from('post_comments').select('post_id').gte('created_at', since).in('post_id', postIds),
      supabase.from('post_likes').select('post_id').gte('created_at', since).in('post_id', postIds),
    ])

    const commentCounts = new Map<string, number>()
    ;((commentRows ?? []) as { post_id: string }[]).forEach((r) => {
      commentCounts.set(r.post_id, (commentCounts.get(r.post_id) ?? 0) + 1)
    })

    const likeCounts = new Map<string, number>()
    ;((likeRows ?? []) as { post_id: string }[]).forEach((r) => {
      likeCounts.set(r.post_id, (likeCounts.get(r.post_id) ?? 0) + 1)
    })

    const scored: PopularPostRow[] = postList.map((p) => {
      const cc = commentCounts.get(p.id) ?? 0
      const lc = likeCounts.get(p.id) ?? 0
      return {
        ...p,
        comment_count: cc,
        like_count: lc,
        score: p.view_count + lc * 3 + cc * 5,
      }
    })

    scored.sort((a, b) => b.score - a.score)
    setPopularPosts(scored.slice(0, 5).filter((p) => p.score > 0))
  }

  const fetchRecentPosts = async () => {
    const { data, error } = await supabase
      .from('posts')
      .select('id, slug, title, excerpt, published_at, controller_name, rating')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(5)
    if (error) {
      console.error('fetchRecentPosts error:', error)
      return
    }
    setRecentPosts((data ?? []) as RecentPostRow[])
  }

  useEffect(() => {
    void fetchAnnouncements()
    void fetchPopularPosts()
    void fetchRecentPosts()
    void fetchTournaments()
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session?.user)
    })
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user)
    })

    return () => {
      authSub.subscription.unsubscribe()
    }
  }, [])

  return (
    <main>
      <div className="section card-strong">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>ASCENT</h1>
            <p className="muted">
              Black Ops 7 / 4v4 / GA準拠のレート対戦プラットフォーム
            </p>
          </div>

          <div className="row" style={{ alignItems: 'center' }}>
            {signedIn ? (
              <>
                <span className="muted">ログイン中</span>
                <button onClick={() => router.push('/menu')}>メニュー</button>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut()
                    setSignedIn(false)
                  }}
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button onClick={() => router.push('/login')}>ログイン</button>
            )}
            <button onClick={() => router.push('/ranking')}>ランキング</button>
            <button onClick={() => router.push('/blog')}>レビュー</button>
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

      {tournaments.length > 0 && (
        <div className="section card-strong" style={{ borderColor: 'var(--accent-violet, #8b5cf6)' }}>
          <h2>大会告知</h2>
          <div className="stack">
            {tournaments.map((t) => (
              <div key={t.id} className="card">
                <h3 style={{ marginTop: 0 }}>{t.title}</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{t.body}</p>
                {t.entry_deadline && (() => {
                  const remaining = Math.floor((new Date(t.entry_deadline).getTime() - Date.now()) / 1000)
                  const closed = remaining <= 0
                  const days = Math.floor(remaining / 86400)
                  const hours = Math.floor((remaining % 86400) / 3600)
                  const mins = Math.floor((remaining % 3600) / 60)
                  const label = closed ? '締切済み' : days > 0 ? `残り ${days}日 ${hours}時間` : hours > 0 ? `残り ${hours}時間 ${mins}分` : `残り ${mins}分`
                  return (
                    <p style={{
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      color: closed ? 'var(--danger, #ff4d6d)' : remaining < 86400 ? 'var(--danger, #ff4d6d)' : 'var(--accent-cyan, #00e5ff)',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: closed ? 'rgba(255,77,109,0.1)' : remaining < 86400 ? 'rgba(255,77,109,0.1)' : 'rgba(0,229,255,0.1)',
                      display: 'inline-block',
                    }}>
                      応募締切: {new Date(t.entry_deadline).toLocaleString('ja-JP')} ({label})
                    </p>
                  )
                })()}
                {t.event_date && (
                  <p style={{ color: 'var(--accent-violet, #8b5cf6)', fontWeight: 'bold' }}>
                    開催: {new Date(t.event_date).toLocaleString('ja-JP')}
                    {t.event_date_end && ` 〜 ${new Date(t.event_date_end).toLocaleString('ja-JP')}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section grid-ad-layout">
        <div className="card-strong">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>新着レビュー</h2>
            <button onClick={() => router.push('/blog')}>レビュー一覧</button>
          </div>
          {recentPosts.length === 0 ? (
            <p className="muted">まだ記事がありません</p>
          ) : (
            <div className="stack">
              {recentPosts.map((p) => (
                <div key={p.id} className="card">
                  <h3 style={{ marginTop: 0 }}>
                    <Link href={`/blog/${p.slug}`}>{p.title}</Link>
                  </h3>
                  {p.controller_name && (
                    <p className="muted">
                      {p.controller_name}
                      {p.rating != null && (
                        <span style={{ marginLeft: 8 }}>
                          {'★'.repeat(p.rating)}{'☆'.repeat(5 - p.rating)}
                        </span>
                      )}
                    </p>
                  )}
                  {p.excerpt && <p>{p.excerpt}</p>}
                  <p className="muted">
                    {p.published_at
                      ? new Date(p.published_at).toLocaleString('ja-JP')
                      : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card-strong" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ fontSize: '0.7rem', marginBottom: 8 }}>広告</p>
          <a
            href="https://fuhen.jp/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', borderRadius: 12, overflow: 'hidden' }}
          >
            <img
              src="/fuhen-ad.png"
              alt="FUHEN Laboratory"
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 12 }}
            />
          </a>
        </div>
      </div>

      <div className="section card-strong">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>週間人気レビュー</h2>
          <button onClick={() => router.push('/blog')}>レビュー一覧</button>
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
                {p.controller_name && (
                  <p className="muted">
                    {p.controller_name}
                    {p.rating != null && (
                      <span style={{ marginLeft: 8 }}>
                        {'★'.repeat(p.rating)}{'☆'.repeat(5 - p.rating)}
                      </span>
                    )}
                  </p>
                )}
                {p.excerpt && <p>{p.excerpt}</p>}
                <p className="muted">
                  閲覧 {p.view_count} / いいね {p.like_count} / コメント {p.comment_count}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section card-strong">
        <h2>ルール概要</h2>

        <div className="grid grid-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>試合形式</h3>
            <p>・4v4 チーム戦</p>
            <p>・Black Ops 7 GA（ジェントルマンズアグリーメント）準拠</p>
            <p>
              ・対象モード: ハードポイント / サーチ&amp;デストロイ / オーバーロード
            </p>
            <p>・マップは公式ルールで指定されたものに限定</p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>マッチング & 結果</h3>
            <p>・レートが近いチームと自動マッチング</p>
            <p>・試合前にマップ/モードのバンピックを実施</p>
            <p>・試合結果は相手チームの承認で確定</p>
            <p>・承認後にレート・個人戦績へ自動反映</p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>使用制限</h3>
            <p>・使用可能な武器・アタッチメントは厳格に制限</p>
            <p>・パーク / 装備 / スコアストリークにも制限あり</p>
            <p>・グリッチ（スネーク・階段）禁止</p>
            <p className="danger">
              ・参加前に「詳細ルール」を必ず確認してください
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>違反への対応</h3>
            <p>・違反プレイヤーは「通報」から運営へ報告できます</p>
            <p>・運営が確認後、状況に応じて対応します</p>
            <p>・通報はマイページ &gt; 通報履歴 から確認可能</p>
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
              <strong>1. Discordでログイン</strong>
            </p>
            <p className="muted">
              右上の「ログイン」から Discord 認証で参加。アカウント作成は不要です。
            </p>
          </div>

          <div className="card">
            <p>
              <strong>2. プロフィールを登録</strong>
            </p>
            <p className="muted">
              表示名・Activision ID・使用デバイスを入力。初回ログイン時に一度だけ求められます。
            </p>
          </div>

          <div className="card">
            <p>
              <strong>3. メニューから対戦開始</strong>
            </p>
            <p className="muted">
              ソロでもチームでも参加できます。フレンドを誘ってパーティを組むことも可能。
            </p>
          </div>

          <div className="card">
            <p>
              <strong>4. マッチング → バンピック → 試合</strong>
            </p>
            <p className="muted">
              レートが近いチームと自動マッチング。マップ・モードのバンピックを経て対戦開始です。
            </p>
          </div>

          <div className="card">
            <p>
              <strong>5. 結果を報告 → 相手の承認で確定</strong>
            </p>
            <p className="muted">
              試合後にスコアを報告し、相手チームの承認でレートと戦績が反映されます。
            </p>
          </div>
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'center', gap: 16 }}>
        <a href="/terms">利用規約</a>
        <a href="/privacy">プライバシーポリシー</a>
      </div>
    </main>
  )
}