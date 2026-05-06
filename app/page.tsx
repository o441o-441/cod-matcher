'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePageView } from '@/lib/usePageView'

type TourneyRow = { id: string; title: string; format: string; status: string; capacity: number; entry_deadline: string | null }
type AnnouncementRow = { id: string; title: string; created_at: string }
type ReviewRow = { id: string; slug: string; title: string; excerpt: string | null; controller_name: string | null; published_at: string | null }

const MODES = [
  { id: 'ranked', name: 'RANKED', sub: 'ランクマッチ', color: 'var(--cyan)', border: 'rgba(0,229,255,0.3)', soft: 'rgba(0,229,255,0.06)', glyph: 'R',
    headline: 'Eloレート 4v4', desc: 'BAN/PICK制でマップとサイドを選択。勝敗でレートが変動するメインモード。',
    bullets: ['Eloレート制', 'BAN/PICK', 'シーズン集計'], href: '/match', action: 'ログインして始める', actionLoggedIn: 'マッチング開始',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { id: 'eights', name: '8s', sub: '8人カスタム', color: 'var(--violet)', border: 'rgba(139,92,246,0.3)', soft: 'rgba(139,92,246,0.06)', glyph: '8',
    headline: '即席カスタム', desc: '8人ロビーで即席4v4。レート + 武器ロールを考慮した自動振り分け。レート変動なし。',
    bullets: ['自動振り分け', 'レート変動なし', '気軽に集まれる'], href: '/custom', action: 'ログインして始める', actionLoggedIn: 'ロビーへ',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="6" cy="6" r="2" fill="currentColor"/><circle cx="12" cy="6" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="currentColor"/><circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="18" cy="12" r="2" fill="currentColor"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="12" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/></svg> },
  { id: 'scrim', name: 'SCRIM', sub: 'スクリム', color: 'var(--magenta)', border: 'rgba(255,43,214,0.3)', soft: 'rgba(255,43,214,0.06)', glyph: 'S',
    headline: 'パーティ vs パーティ', desc: 'チーム同士の練習試合。PEAKレート平均でマッチング。HP全マップを実施。',
    bullets: ['PEAK平均マッチ', 'HP全マップ', 'チーム前提'], href: '/custom', action: 'ログインして始める', actionLoggedIn: 'スクリム募集',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M3 7l4 2v6l-4 2V7zM21 7l-4 2v6l4 2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2"/></svg> },
  { id: 'tournament', name: 'TOURNAMENT', sub: '大会', color: 'var(--amber)', border: 'rgba(255,176,32,0.3)', soft: 'rgba(255,176,32,0.06)', glyph: 'T',
    headline: '誰でも大会開催', desc: 'シングル/ダブルエリミ・リーグ・ブロックリーグに対応。誰でも開催・参加可能。',
    bullets: ['ダブルエリミ対応', 'リーグ戦', '誰でも開催'], href: '/tournaments', action: '大会一覧へ', actionLoggedIn: '大会を見る',
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M7 4h10v5a5 5 0 01-10 0V4zM5 5H3v2a3 3 0 003 3M19 5h2v2a3 3 0 01-3 3M9 19h6M12 14v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
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
        supabase.from('tournaments').select('id, title, format, status, capacity, entry_deadline').in('status', ['recruit', 'live']).order('created_at', { ascending: false }).limit(3),
        supabase.from('announcements').select('id, title, created_at').order('created_at', { ascending: false }).limit(3),
        supabase.from('blog_posts').select('id, slug, title, excerpt, controller_name, published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(2),
      ])
      setTourneys((tData ?? []) as TourneyRow[])
      setAnnouncements((aData ?? []) as AnnouncementRow[])
      setReviews((rData ?? []) as ReviewRow[])
    } else {
      // Load tournaments for non-logged-in users too
      const { data: tData } = await supabase.from('tournaments').select('id, title, format, status, capacity, entry_deadline').in('status', ['recruit', 'live']).order('created_at', { ascending: false }).limit(3)
      setTourneys((tData ?? []) as TourneyRow[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const goTo = (path: string) => router.push(signedIn ? path : '/login')

  if (loading) return <main style={{ paddingTop: 32 }}><div className="card" style={{ textAlign: 'center', padding: 40 }}><span className="muted">読み込み中...</span></div></main>

  return (
    <main style={{ paddingTop: 28, paddingBottom: 32 }}>
      {/* Hero — compact */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, alignItems: 'end', marginBottom: 22 }}>
        <div>
          <div className="eyebrow">GA COMPLIANT · CoD 4v4 PLATFORM</div>
          <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 5vw, 3.4rem)', marginTop: 6 }}>
            {signedIn ? <>今日も、<em>4v4。</em></> : <>4v4を、<em>本気で</em>。</>}
          </h1>
          <p className="muted" style={{ marginTop: 10, fontSize: 14, maxWidth: 520, lineHeight: 1.6 }}>
            {signedIn
              ? `おかえりなさい、${displayName ?? 'プレイヤー'}。`
              : 'ランクマッチ・カスタム・スクリム・大会まで。CoDの競技シーンを1つにまとめた、4v4プレイヤーのためのプラットフォーム。'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          {signedIn ? (
            <>
              <button type="button" className="btn-ghost btn-lg" onClick={() => router.push('/mypage')}>マイページ</button>
              <button type="button" className="btn-primary btn-lg" onClick={() => router.push('/match')}>対戦開始 →</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost btn-lg" onClick={() => router.push('/rules')}>ルールを読む</button>
              <button type="button" className="btn-primary btn-lg" onClick={() => router.push('/login')}>無料で始める →</button>
            </>
          )}
        </div>
      </section>

      {/* 4 Mode Cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {MODES.map((m) => (
          <button key={m.id} type="button" onClick={() => m.id === 'tournament' ? router.push(m.href) : goTo(m.href)} style={{
            position: 'relative', padding: 20, borderRadius: 14, textAlign: 'left', cursor: 'pointer', minHeight: 240,
            border: `1px solid ${m.border}`, background: `linear-gradient(160deg, ${m.soft}, rgba(10,14,32,0.72) 60%, rgba(10,14,32,0.92))`,
            display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden',
            boxShadow: 'var(--shadow)', transition: 'transform 0.2s, box-shadow 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 24px 60px rgba(0,0,0,0.55), 0 0 32px ${m.soft}` }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow)' }}
          >
            {/* Big glyph */}
            <div style={{ position: 'absolute', right: -12, top: -16, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 130, lineHeight: 1, color: m.color, opacity: 0.07, pointerEvents: 'none', userSelect: 'none' }} aria-hidden="true">{m.glyph}</div>

            <div className="row" style={{ gap: 12, position: 'relative' }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.5)', border: `1px solid ${m.border}`, color: m.color, boxShadow: `0 0 16px ${m.soft}` }}>{m.icon}</div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: m.color, letterSpacing: '0.06em' }}>{m.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{m.sub}</div>
              </div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', position: 'relative' }}>{m.headline}</div>
            <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, position: 'relative' }}>{m.desc}</p>

            <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6, position: 'relative' }}>
              {m.bullets.map(b => (
                <span key={b} style={{ fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-soft)', padding: '3px 8px', borderRadius: 999, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>{b}</span>
              ))}
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 4, borderTop: '1px solid var(--line)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: m.color }}>
              <span>{signedIn ? m.actionLoggedIn : m.action}</span>
              <span style={{ fontSize: 14 }}>›</span>
            </div>
          </button>
        ))}
      </section>

      {/* Bottom section: Tournament strip (logged out) OR 3-column feed (logged in) */}
      {!signedIn ? (
        /* Tournament strip */
        tourneys.length > 0 && (
          <section style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20, alignItems: 'center', padding: '14px 20px', borderRadius: 12, border: '1px solid rgba(255,176,32,0.25)', background: 'linear-gradient(90deg, rgba(255,176,32,0.08), transparent)' }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="badge amber" style={{ fontSize: 10 }}><span className="badge-dot" />LIVE</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: '0.12em', color: 'var(--text-strong)' }}>開催中・募集中の大会</span>
            </div>
            <div className="row" style={{ gap: 16, overflow: 'hidden' }}>
              {tourneys.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 14px', borderLeft: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }} onClick={() => router.push(`/tournaments/${t.id}`)}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{t.title}</div>
                  <div className="muted mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{t.format === 'league' ? 'リーグ' : 'トーナメント'} · {t.status === 'recruit' ? '募集中' : '開催中'}</div>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => router.push('/tournaments')}>大会一覧 →</button>
          </section>
        )
      ) : (
        /* 3-column feed for logged-in */
        <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 14 }}>
          {/* Announcements */}
          <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--line-bright)', background: 'linear-gradient(160deg, rgba(0,229,255,0.04), rgba(10,14,32,0.5))' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '0.2em', color: 'var(--cyan)', textTransform: 'uppercase' }}>運営からのお知らせ</span>
              <span className="muted mono" style={{ fontSize: 10 }}>{announcements.length} 件</span>
            </div>
            {announcements.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>お知らせはありません</p> : (
              <div className="stack-sm">
                {announcements.map((a, i) => (
                  <div key={a.id} style={{ paddingTop: i === 0 ? 0 : 8, borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.4 }}>{a.title}</div>
                    <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>{new Date(a.created_at).toLocaleDateString('ja-JP')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tournaments */}
          <div style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(255,176,32,0.3)', background: 'linear-gradient(160deg, rgba(255,176,32,0.06), rgba(10,14,32,0.5))' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '0.2em', color: 'var(--amber)', textTransform: 'uppercase' }}>大会告知</span>
              {tourneys.length > 0 && <span className="badge amber" style={{ fontSize: 9 }}><span className="badge-dot" />LIVE</span>}
            </div>
            {tourneys.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>現在大会はありません</p> : (
              <div className="stack-sm">
                {tourneys.map((t, i) => (
                  <div key={t.id} style={{ paddingTop: i === 0 ? 0 : 8, borderTop: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }} onClick={() => router.push(`/tournaments/${t.id}`)}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-strong)' }}>{t.title}</div>
                    <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>{t.format === 'league' ? 'リーグ' : 'トーナメント'} · {t.status === 'recruit' ? '募集中' : '開催中'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reviews */}
          <div style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(139,92,246,0.3)', background: 'linear-gradient(160deg, rgba(139,92,246,0.06), rgba(10,14,32,0.5))' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '0.2em', color: 'var(--violet)', textTransform: 'uppercase' }}>新着レビュー</span>
              <span className="muted mono" style={{ fontSize: 10 }}>{reviews.length} 件</span>
            </div>
            {reviews.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>レビューはまだありません</p> : (
              <div className="stack-sm">
                {reviews.map((r, i) => (
                  <div key={r.id} style={{ paddingTop: i === 0 ? 0 : 8, borderTop: i === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' }} onClick={() => router.push(`/blog/${r.slug}`)}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-strong)' }}>{r.controller_name ?? r.title}</div>
                    {r.excerpt && <p className="muted" style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5 }}>{r.excerpt.slice(0, 60)}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
