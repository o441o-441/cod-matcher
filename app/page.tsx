'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usePageView } from '@/lib/usePageView'

export default function HomePage() {
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)

  usePageView('/')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(!!session?.user)
      setLoading(false)
    })
  }, [])

  const features = [
    {
      title: 'RANKED MATCH',
      sub: 'ランクマッチ',
      desc: 'レート制マッチメイキングで実力の近い相手と4v4。バンピックでマップ・サイドを選択し、勝敗でレートが変動。',
      color: 'var(--cyan)',
      href: '/match',
      primary: true,
    },
    {
      title: '8s',
      sub: '8人カスタム',
      desc: '8人集めて即席4v4。レート+武器ロールを考慮した自動振り分け。レート変動なし。',
      color: 'var(--violet)',
      href: '/custom',
    },
    {
      title: 'SCRIM',
      sub: 'スクリム',
      desc: 'パーティ単位でPEAK平均が近い相手とマッチ。HP全マップ実施の練習試合。レート変動なし。',
      color: 'var(--magenta)',
      href: '/custom',
    },
    {
      title: 'TOURNAMENT',
      sub: '大会',
      desc: '誰でも大会を開催可能。シングル/ダブルエリミ、リーグ、ブロックリーグに対応。',
      color: 'var(--amber)',
      href: '/tournaments',
    },
    {
      title: 'RANKING',
      sub: 'ランキング',
      desc: 'シーズン別ランキング、ティア制度、コントローラー別統計。',
      color: 'var(--success)',
      href: '/ranking',
    },
    {
      title: 'REVIEWS',
      sub: 'レビュー',
      desc: 'コントローラーのレビューを投稿・閲覧。購入の参考に。',
      color: 'var(--text-soft)',
      href: '/blog',
    },
  ]

  return (
    <main>
      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '40px 0 20px' }}>
        <div className="eyebrow" style={{ fontSize: 12, letterSpacing: '0.4em' }}>GA COMPLIANT CoD 4v4 PLATFORM</div>
        <h1 className="display" style={{ fontSize: 'clamp(2.8rem, 7vw, 5rem)', marginTop: 12, lineHeight: 0.95 }}>
          <em>ASCENT.</em>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--text-soft)', marginTop: 16, maxWidth: 640, marginInline: 'auto', lineHeight: 1.7 }}>
          Call of Duty の <strong style={{ color: 'var(--text-strong)' }}>GA準拠</strong> 4v4対戦プラットフォーム。<br />
          レート制ランクマッチ、8s、スクリム、大会をワンストップで。
        </p>

        <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 28 }}>
          {!loading && (
            signedIn ? (
              <>
                <button className="btn-primary btn-xl" onClick={() => router.push('/match')}>
                  ランクマッチを始める
                </button>
                <button className="btn-ghost btn-lg" onClick={() => router.push('/menu')}>
                  メニュー
                </button>
              </>
            ) : (
              <>
                <button className="btn-primary btn-xl" onClick={() => router.push('/login')}>
                  始める
                </button>
                <button className="btn-ghost btn-lg" onClick={() => router.push('/rules')}>
                  ルールを見る
                </button>
              </>
            )
          )}
        </div>
      </div>

      {/* What is ASCENT */}
      <div className="section" style={{ textAlign: 'center', maxWidth: 700, marginInline: 'auto' }}>
        <div className="stat-label" style={{ marginBottom: 12 }}>WHAT IS ASCENT?</div>
        <div className="grid-3" style={{ gap: 16 }}>
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>4v4</div>
            <div className="muted" style={{ fontSize: 12 }}>GA準拠のルールで<br />公平な対戦環境</div>
          </div>
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>Elo</div>
            <div className="muted" style={{ fontSize: 12 }}>レーティングシステムで<br />実力を可視化</div>
          </div>
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>BAN/PICK</div>
            <div className="muted" style={{ fontSize: 12 }}>マップ・サイド選択で<br />戦略的な試合展開</div>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <div className="section">
        <div className="stat-label" style={{ textAlign: 'center', marginBottom: 16 }}>FEATURES</div>
        <div className="stack" style={{ gap: 12, maxWidth: 900, marginInline: 'auto' }}>
          {features.map((f) => (
            <button
              key={f.title}
              type="button"
              className="card glow-hover"
              style={{
                display: 'flex', alignItems: 'center', gap: 20, padding: f.primary ? '24px 28px' : '18px 24px',
                cursor: 'pointer', textAlign: 'left', width: '100%',
                border: f.primary ? `2px solid ${f.color}` : undefined,
                boxShadow: f.primary ? `0 0 24px ${f.color}33` : undefined,
              }}
              onClick={() => router.push(f.href)}
            >
              <div style={{
                width: f.primary ? 56 : 44, height: f.primary ? 56 : 44, borderRadius: 'var(--r-md)', flexShrink: 0,
                background: `linear-gradient(135deg, ${f.color}, transparent)`,
                display: 'grid', placeItems: 'center',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: f.primary ? 16 : 12, color: '#fff' }}>
                  {f.title.split(' ')[0].charAt(0)}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: f.primary ? 18 : 15, color: f.color }}>
                    {f.title}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>{f.sub}</span>
                  {f.primary && <span className="badge" style={{ fontSize: 9, background: `${f.color}22`, color: f.color, borderColor: `${f.color}44` }}>MAIN</span>}
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{f.desc}</p>
              </div>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="section" style={{ maxWidth: 700, marginInline: 'auto' }}>
        <div className="stat-label" style={{ textAlign: 'center', marginBottom: 16 }}>HOW IT WORKS</div>
        <div className="card-strong" style={{ padding: 24 }}>
          <div className="stack" style={{ gap: 16 }}>
            {[
              { step: '1', label: 'Discordでログイン', desc: 'アカウント作成は不要。Discordアカウントで即開始。' },
              { step: '2', label: 'パーティを組む', desc: 'ソロでもOK。フレンドやチームメンバーを招待できます。' },
              { step: '3', label: 'マッチング', desc: 'キューに入ると自動でレートが近い相手を検索。' },
              { step: '4', label: 'バンピック → 対戦', desc: 'マップとサイドを選んでプライベートマッチで対戦。' },
              { step: '5', label: '結果報告', desc: '勝敗を報告して相手が承認。レートが変動します。' },
            ].map((s) => (
              <div key={s.step} className="row" style={{ gap: 16 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 16, color: '#04050c',
                }}>
                  {s.step}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{s.label}</div>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA bottom */}
      <div className="section" style={{ textAlign: 'center', padding: '32px 0' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
          さあ、始めよう。
        </p>
        {!loading && (
          signedIn ? (
            <button className="btn-primary btn-xl" onClick={() => router.push('/match')}>
              ランクマッチを始める
            </button>
          ) : (
            <button className="btn-primary btn-xl" onClick={() => router.push('/login')}>
              Discordでログイン
            </button>
          )
        )}
      </div>
    </main>
  )
}
