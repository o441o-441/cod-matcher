'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePageView } from '@/lib/usePageView'

type TourneyRow = { id: string; title: string; format: string; status: string }
type AnnouncementRow = { id: string; title: string; created_at: string }
type ReviewRow = { id: string; slug: string; title: string; excerpt: string | null; controller_name: string | null }

const MODES = [
  { id: 'ranked', name: 'RANKED', sub: 'ランクマッチ', color: 'var(--cyan)', border: 'rgba(0,229,255,0.3)', soft: 'rgba(0,229,255,0.06)', glyph: 'R',
    headline: 'Eloレート 4v4', desc: 'BAN/PICK制でマップとサイドを選択。勝敗でレートが変動するメインモード。',
    bullets: ['Eloレート制', 'BAN/PICK', 'シーズン集計'], cta: 'マッチング開始', href: '/match',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { id: 'eights', name: '8s', sub: '8人カスタム', color: 'var(--violet)', border: 'rgba(139,92,246,0.3)', soft: 'rgba(139,92,246,0.06)', glyph: '8',
    headline: '即席カスタム', desc: '8人ロビーで即席4v4。レート + 武器ロールを考慮した自動振り分け。レート変動なし。',
    bullets: ['自動振り分け', 'レート変動なし', '気軽に集まれる'], cta: 'ロビーへ', href: '/custom',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="2" fill="currentColor"/><circle cx="12" cy="6" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="currentColor"/><circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="18" cy="12" r="2" fill="currentColor"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="12" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/></svg> },
  { id: 'scrim', name: 'SCRIM', sub: 'スクリム', color: 'var(--magenta)', border: 'rgba(255,43,214,0.3)', soft: 'rgba(255,43,214,0.06)', glyph: 'S',
    headline: 'パーティ vs パーティ', desc: 'チーム同士の練習試合。PEAKレート平均でマッチング。HP全マップを実施。',
    bullets: ['PEAK平均マッチ', 'HP全マップ', 'チーム前提'], cta: 'スクリム募集', href: '/custom',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d="M3 7l4 2v6l-4 2V7zM21 7l-4 2v6l4 2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2"/></svg> },
  { id: 'tournament', name: 'TOURNAMENT', sub: '大会', color: 'var(--amber)', border: 'rgba(255,176,32,0.3)', soft: 'rgba(255,176,32,0.06)', glyph: 'T',
    headline: '誰でも大会開催', desc: 'シングル/ダブルエリミ・リーグ・ブロックリーグに対応。誰でも開催・参加可能。',
    bullets: ['ダブルエリミ対応', 'リーグ戦', '誰でも開催'], cta: '大会を見る', href: '/tournaments',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d="M7 4h10v5a5 5 0 01-10 0V4zM5 5H3v2a3 3 0 003 3M19 5h2v2a3 3 0 01-3 3M9 19h6M12 14v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
]

export default function HomePage() {
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [tourneys, setTourneys] = useState<TourneyRow[]>([])
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [reviews, setReviews] = useState<ReviewRow[]>([])

  usePageView('/')

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setSignedIn(!!uid)
    if (uid) {
      const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle()
      setDisplayName((prof as { display_name: string | null } | null)?.display_name ?? null)
      const [{ data: tData }, { data: aData }, { data: rData }] = await Promise.all([
        supabase.from('tournaments').select('id,title,format,status').in('status', ['recruit', 'live']).order('created_at', { ascending: false }).limit(3),
        supabase.from('announcements').select('id,title,created_at').order('created_at', { ascending: false }).limit(3),
        supabase.from('posts').select('id,slug,title,excerpt,controller_name').eq('status', 'published').order('published_at', { ascending: false }).limit(2),
      ])
      setTourneys((tData ?? []) as TourneyRow[])
      setAnnouncements((aData ?? []) as AnnouncementRow[])
      setReviews((rData ?? []) as ReviewRow[])
    } else {
      const { data: tData } = await supabase.from('tournaments').select('id,title,format,status').in('status', ['recruit', 'live']).order('created_at', { ascending: false }).limit(3)
      setTourneys((tData ?? []) as TourneyRow[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const go = (path: string) => router.push(signedIn ? path : '/login')

  if (loading) return <main><div className="card" style={{ textAlign: 'center', padding: 40 }}><span className="muted">読み込み中...</span></div></main>

  return (
    <main>
      {/* Hero — Variant B: Wordmark center */}
      <section className="hero-frame anim-keep">
        <span className="hud-tick tl" /><span className="hud-tick tr" /><span className="hud-tick bl" /><span className="hud-tick br" />
        <span className="hero-coord l mono">SEASON 03</span>
        <span className="hero-coord r mono">CoD · 4v4 · GA</span>

        <div className="hero-B">
          <div className="eyebrow"><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--cyan)', marginRight: 8, boxShadow: '0 0 10px var(--cyan)', verticalAlign: 'middle' }} />GA COMPLIANT · CoD 4v4 PLATFORM</div>
          <div className="hero-B-word">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo_yoko.png" alt="ASCENT — GA Compliant CoD 4v4 Platform" />
          </div>
          <p className="muted" style={{ fontSize: 15, maxWidth: 580, lineHeight: 1.65, margin: 0 }}>
            ランクマッチ・カスタム・スクリム・大会まで。CoDの競技シーンを1つにまとめた、4v4プレイヤーのためのプラットフォーム。
          </p>
          <div className="hero-cta" style={{ justifyContent: 'center' }}>
            {signedIn ? (
              <><button type="button" className="btn-primary btn-xl" onClick={() => router.push('/match')}>対戦開始 →</button>
              <button type="button" className="btn-ghost btn-xl" onClick={() => router.push('/mypage')}>マイページ</button></>
            ) : (
              <><button type="button" className="btn-primary btn-xl" onClick={() => router.push('/login')}>無料で始める →</button>
              <button type="button" className="btn-ghost btn-xl" onClick={() => router.push('/rules')}>ルールを読む</button></>
            )}
          </div>
          <div className="row" style={{ gap: 18, marginTop: 4, justifyContent: 'center' }}>
            <span className="badge"><span className="badge-dot" />Elo Rating</span>
            <span className="badge amber"><span className="badge-dot" />BAN/PICK</span>
            <span className="badge violet"><span className="badge-dot" />SR Season</span>
          </div>
        </div>
      </section>

      {/* 4 Mode Cards */}
      <section className="grid-2" style={{ gap: 14, marginBottom: 18 }}>
        {MODES.map(m => (
          <button key={m.id} type="button" className="mode-card" onClick={() => m.id === 'tournament' ? router.push(m.href) : go(m.href)}
            style={{ border: `1px solid ${m.border}`, background: `linear-gradient(160deg, ${m.soft}, rgba(10,14,32,0.72) 60%, rgba(10,14,32,0.92))` }}>
            <span className="glyph" aria-hidden="true" style={{ color: m.color }}>{m.glyph}</span>
            <div className="row" style={{ gap: 12, position: 'relative' }}>
              <div className="mode-icon" style={{ color: m.color, borderColor: m.border, boxShadow: `0 0 16px ${m.soft}` }}>{m.icon}</div>
              <div><div className="mode-name" style={{ color: m.color }}>{m.name}</div><div className="mode-sub">{m.sub}</div></div>
            </div>
            <div className="mode-headline">{m.headline}</div>
            <p className="mode-desc">{m.desc}</p>
            <div className="mode-bullets">{m.bullets.map(b => <span key={b}>{b}</span>)}</div>
            {signedIn && <div className="mode-cta" style={{ color: m.color }}><span>{m.cta}</span><span style={{ fontSize: 14 }}>›</span></div>}
          </button>
        ))}
      </section>

      {/* Bottom: Tournament strip (logged out) or 3-col feed (logged in) */}
      {!signedIn ? (
        tourneys.length > 0 && (
          <section className="tour-strip">
            <div className="row" style={{ gap: 10 }}>
              <span className="badge amber"><span className="badge-dot" />LIVE</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: '0.12em', color: 'var(--text-strong)' }}>開催中・募集中の大会</span>
            </div>
            <div className="row" style={{ gap: 0, overflow: 'hidden' }}>
              {tourneys.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 18px', borderLeft: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }} onClick={() => router.push(`/tournaments/${t.id}`)}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{t.title}</div>
                  <div className="muted mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{t.format === 'league' ? 'リーグ' : 'トーナメント'} · {t.status === 'recruit' ? '募集中' : '開催中'}</div>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => router.push('/tournaments')}>大会一覧 →</button>
          </section>
        )
      ) : (
        <section className="grid-3" style={{ marginTop: 14 }}>
          <div className="feed-card">
            <div className="feed-head"><span className="feed-eyebrow">運営からのお知らせ</span><span className="muted mono" style={{ fontSize: 10 }}>{announcements.length} 件</span></div>
            {announcements.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>お知らせはありません</p> : (
              <div className="stack-sm">{announcements.map((a, i) => (
                <div key={a.id} style={{ paddingTop: i === 0 ? 0 : 10, borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)' }}>{a.title}</div>
                  <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>{new Date(a.created_at).toLocaleDateString('ja-JP')}</div>
                </div>
              ))}</div>
            )}
          </div>
          <div className="feed-card amber">
            <div className="feed-head"><span className="feed-eyebrow amber">大会告知</span>{tourneys.length > 0 && <span className="badge amber" style={{ fontSize: 9 }}><span className="badge-dot" />LIVE</span>}</div>
            {tourneys.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>大会はありません</p> : (
              <div className="stack-sm">{tourneys.map((t, i) => (
                <div key={t.id} style={{ paddingTop: i === 0 ? 0 : 10, borderTop: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }} onClick={() => router.push(`/tournaments/${t.id}`)}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-strong)' }}>{t.title}</div>
                  <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>{t.format === 'league' ? 'リーグ' : 'トーナメント'} · {t.status === 'recruit' ? '募集中' : '開催中'}</div>
                </div>
              ))}</div>
            )}
          </div>
          <div className="feed-card violet">
            <div className="feed-head"><span className="feed-eyebrow violet">新着レビュー</span><span className="muted mono" style={{ fontSize: 10 }}>{reviews.length} 件</span></div>
            {reviews.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>レビューはまだありません</p> : (
              <div className="stack-sm">{reviews.map((r, i) => (
                <div key={r.id} style={{ paddingTop: i === 0 ? 0 : 10, borderTop: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }} onClick={() => router.push(`/blog/${r.slug}`)}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-strong)' }}>{r.controller_name ?? r.title}</div>
                  {r.excerpt && <p className="muted" style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5 }}>{r.excerpt.slice(0, 60)}</p>}
                </div>
              ))}</div>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
