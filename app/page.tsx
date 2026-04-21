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
  const [seasonName, setSeasonName] = useState<string | null>(null)

  usePageView('/')

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
      return { ...p, comment_count: cc, like_count: lc, score: p.view_count + lc * 3 + cc * 5 }
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
    void supabase
      .from('seasons')
      .select('name')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle<{ name: string }>()
      .then(({ data }) => { if (data?.name) setSeasonName(data.name) })
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session?.user)
    })
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user)
    })
    return () => { authSub.subscription.unsubscribe() }
  }, [])

  return (
    <main>
      {/* ── HERO ── */}
      <div style={{ position: 'relative', padding: '40px 0 56px' }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 24 }}>
          <div style={{ position: 'absolute', width: 600, height: 600, left: '60%', top: '-20%', background: 'radial-gradient(circle, rgba(139, 92, 246, 0.25), transparent 65%)', filter: 'blur(10px)' }} />
          <div style={{ position: 'absolute', width: 500, height: 500, left: '-10%', top: '20%', background: 'radial-gradient(circle, rgba(0, 229, 255, 0.18), transparent 65%)' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="badge mb-m">
            <span className="badge-dot" />{seasonName ?? 'SEASON'} / LIVE
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(2.4rem, 5vw, 4.5rem)' }}>
            <em>GENTLEMEN&apos;S<br />AGREEMENT.</em><br />RANKED 4v4.
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-soft)', maxWidth: 520, marginTop: 18, lineHeight: 1.7 }}>
            GA準拠の制限ルールで公正に戦う、レート対戦プラットフォーム。
            ソロから固定4人まで対応。自動マッチング / バンピック / 結果承認まで一気通貫。
          </p>
          <div className="row mt-m" style={{ gap: 14 }}>
            {signedIn ? (
              <button className="btn-primary" style={{ padding: '18px 30px', fontSize: 15, borderRadius: 14, letterSpacing: '0.1em' }} onClick={() => router.push('/menu')}>
                対戦を始める
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ) : (
              <button className="btn-primary" style={{ padding: '18px 30px', fontSize: 15, borderRadius: 14, letterSpacing: '0.1em' }} onClick={() => router.push('/login')}>
                ログインして始める
              </button>
            )}
            <button className="btn-ghost" style={{ padding: '18px 30px', fontSize: 15, borderRadius: 14 }} onClick={() => router.push('/ranking')}>
              ランキングを見る
            </button>
          </div>
        </div>
      </div>

      {/* ── Announcements + Tournaments ── */}
      <div className="grid-2 mt-l" style={{ alignItems: 'start' }}>
        {/* Announcements */}
        <div className="card-strong">
          <div className="sec-title">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 1112 0v4l2 3H4l2-3V9zM10 19a2 2 0 004 0" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            運営からのお知らせ
          </div>
          {announcements.length === 0 ? (
            <p className="muted">現在お知らせはありません</p>
          ) : (
            <div className="stack">
              {announcements.map((a) => (
                <div key={a.id} className="card glow-hover" style={{ padding: 14 }}>
                  <div className="rowx" style={{ marginBottom: 6 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>{a.title}</div>
                    <span className="muted mono" style={{ fontSize: 10 }}>
                      {new Date(a.created_at).toLocaleDateString('ja-JP')}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {a.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tournaments */}
        <div className="card-strong" style={{ borderColor: 'rgba(139, 92, 246, 0.4)' }}>
          <div className="sec-title" style={{ color: 'var(--violet)' }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M7 4h10v4a5 5 0 11-10 0V4zM5 5H3a3 3 0 003 3m12-3h2a3 3 0 01-3 3M9 21h6M12 14v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            大会告知
          </div>
          {tournaments.length === 0 ? (
            <p className="muted">現在予定されている大会はありません</p>
          ) : (
            <div className="stack">
              {tournaments.map((t) => {
                const remaining = t.entry_deadline ? Math.floor((new Date(t.entry_deadline).getTime() - Date.now()) / 1000) : null
                const closed = remaining != null && remaining <= 0
                const days = remaining ? Math.floor(remaining / 86400) : 0
                const hours = remaining ? Math.floor((remaining % 86400) / 3600) : 0
                const deadlineLabel = closed ? '締切済み' : days > 0 ? `残り ${days}日 ${hours}時間` : hours > 0 ? `残り ${hours}時間` : remaining != null ? `残り ${Math.floor((remaining % 3600) / 60)}分` : ''

                return (
                  <div key={t.id}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>{t.title}</div>
                    <p style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{t.body}</p>
                    <div className="grid-2 mt-s" style={{ gap: 10 }}>
                      {t.entry_deadline && (
                        <div className="card" style={{ padding: 12, borderColor: closed ? 'rgba(255, 77, 109, 0.3)' : 'rgba(0, 229, 255, 0.3)', background: closed ? 'rgba(255, 77, 109, 0.05)' : 'rgba(0, 229, 255, 0.05)' }}>
                          <div className="stat-label" style={{ color: closed ? 'var(--danger)' : 'var(--cyan)' }}>応募締切</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                            {new Date(t.entry_deadline).toLocaleString('ja-JP')}
                          </div>
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{deadlineLabel}</div>
                        </div>
                      )}
                      {t.event_date && (
                        <div className="card" style={{ padding: 12, borderColor: 'rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.05)' }}>
                          <div className="stat-label" style={{ color: 'var(--violet)' }}>開催日</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                            {new Date(t.event_date).toLocaleString('ja-JP')}
                          </div>
                          {t.event_date_end && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                              〜 {new Date(t.event_date_end).toLocaleString('ja-JP')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Reviews ── */}
      <div className="card-strong mt-l">
        <div className="rowx mb-s">
          <div className="sec-title" style={{ margin: 0 }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="11" rx="5" stroke="currentColor" strokeWidth="1.6" /><path d="M6 12h4M8 10v4M15 11h0M17 13h0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            新着レビュー
          </div>
          <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: 11, borderRadius: 6 }} onClick={() => router.push('/blog')}>
            ALL REVIEWS
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        {recentPosts.length === 0 ? (
          <p className="muted">まだ記事がありません</p>
        ) : (
          <div className="grid-3">
            {recentPosts.slice(0, 3).map((p) => (
              <Link key={p.id} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card glow-hover" style={{ cursor: 'pointer', height: '100%' }}>
                  <div className="muted mono" style={{ fontSize: 10 }}>
                    {p.published_at ? new Date(p.published_at).toLocaleDateString('ja-JP') : ''}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginTop: 8, lineHeight: 1.35 }}>
                    {p.title}
                  </div>
                  {p.excerpt && (
                    <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 8, lineHeight: 1.6 }}>
                      {p.excerpt}
                    </div>
                  )}
                  {p.rating != null && (
                    <div className="mt-s" style={{ color: 'var(--amber)', letterSpacing: 2 }}>
                      {'★'.repeat(p.rating)}
                      <span style={{ color: 'var(--text-dim)' }}>{'★'.repeat(5 - p.rating)}</span>
                    </div>
                  )}
                  {p.controller_name && (
                    <div className="mt-xs">
                      <span className="badge" style={{ fontSize: 9, padding: '2px 8px' }}>
                        {p.controller_name}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── Popular Reviews ── */}
      {popularPosts.length > 0 && (
        <div className="card-strong mt-l">
          <div className="rowx mb-s">
            <div className="sec-title" style={{ margin: 0 }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M12 2c2 4 6 5 6 11a6 6 0 11-12 0c0-3 2-4 2-7 1 1 3 2 4 0-1-2 0-3 0-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
              週間人気レビュー
            </div>
            <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: 11, borderRadius: 6 }} onClick={() => router.push('/blog')}>
              ALL REVIEWS
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {popularPosts.map((p, i) => (
              <Link key={p.id} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card glow-hover" style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '30px 1fr auto', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: i === 0 ? 'var(--tier-gold)' : i === 1 ? 'var(--tier-silver)' : i === 2 ? 'var(--tier-bronze)' : 'var(--text-dim)' }}>
                    #{i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {p.controller_name && <span>{p.controller_name} · </span>}
                      {p.rating != null && <span style={{ color: 'var(--amber)' }}>{'★'.repeat(p.rating)} </span>}
                      <span className="mono">閲覧 {p.view_count} / ♡ {p.like_count} / 💬 {p.comment_count}</span>
                    </div>
                  </div>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-dim)' }}>
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Rules Overview ── */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" stroke="currentColor" strokeWidth="1.6" /></svg>
          ルール概要
        </div>
        <div className="grid-2">
          {[
            { t: '試合形式', items: ['4v4 チーム戦', 'GA（ジェントルマンズアグリーメント）準拠', 'HP / SND / オーバーロード'] },
            { t: 'マッチング', items: ['レートが近いチームと自動マッチング', 'バンピックでマップ/モード選択', '結果は相手チームの承認で確定'] },
            { t: '使用制限', items: ['武器・アタッチメント厳格制限', 'パーク / 装備 / ストリーク制限', 'グリッチ（スネーク・階段）禁止'] },
            { t: '違反対応', items: ['通報から運営へ報告', '運営確認後、状況に応じて対応', '通報履歴はマイページから確認'] },
          ].map((sec, i) => (
            <div key={i} className="card">
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{sec.t}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.9 }}>
                {sec.items.map((item, j) => (
                  <li key={j}>・{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-m">
          <button className="btn-ghost" style={{ width: '100%' }} onClick={() => router.push('/rules')}>
            詳細ルールを見る
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          はじめかた
        </div>
        <div className="g4">
          {[
            { n: '01', t: 'Discord ログイン', d: 'アカウント作成不要。Discord認証で即参加。' },
            { n: '02', t: 'プロフィール登録', d: '表示名 / Activision ID / 使用デバイスを入力。' },
            { n: '03', t: 'パーティ編成', d: 'ソロ / デュオ / トリオ / 固定4人。フレンド招待も可。' },
            { n: '04', t: '試合 → レート反映', d: 'バンピック → 試合 → 結果承認でレート更新。' },
          ].map((s, i) => (
            <div key={i} className="card">
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, background: 'linear-gradient(135deg, var(--cyan), var(--violet))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {s.n}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, marginTop: 6 }}>{s.t}</div>
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 6, lineHeight: 1.6 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
