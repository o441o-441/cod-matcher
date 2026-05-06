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

  return (
    <main style={{ paddingTop: 24, paddingBottom: 48 }}>
      {/* Compact Hero */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <div className="eyebrow">GA COMPLIANT CoD 4v4 PLATFORM</div>
          <h1 className="display" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', marginTop: 4 }}>
            <em>ASCENT.</em>
          </h1>
        </div>
        {!loading && (
          <div className="row" style={{ gap: 8 }}>
            {signedIn ? (
              <button className="btn-primary" onClick={() => router.push('/menu')}>メニューへ</button>
            ) : (
              <>
                <button className="btn-primary" onClick={() => router.push('/login')}>始める</button>
                <button className="btn-ghost" onClick={() => router.push('/rules')}>ルール</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Feature Grid — all visible without scroll */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'auto auto', gap: 12 }}>

        {/* Ranked — spans 1 col */}
        <button type="button" className="card glow-hover" onClick={() => router.push(signedIn ? '/match' : '/login')} style={{
          padding: 20, cursor: 'pointer', textAlign: 'left',
          borderColor: 'rgba(0,229,255,0.3)', background: 'linear-gradient(135deg, rgba(0,229,255,0.06), var(--card))',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'linear-gradient(135deg, var(--cyan), var(--violet))', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: '#04050c' }}>R</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--cyan)' }}>RANKED</div>
              <div className="muted" style={{ fontSize: 10 }}>ランクマッチ</div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            Eloレート制4v4。バンピックでマップ・サイド選択。勝敗でレート変動。
          </p>
        </button>

        {/* 8s */}
        <button type="button" className="card glow-hover" onClick={() => router.push(signedIn ? '/custom' : '/login')} style={{
          padding: 20, cursor: 'pointer', textAlign: 'left',
          borderColor: 'rgba(139,92,246,0.3)', background: 'linear-gradient(135deg, rgba(139,92,246,0.06), var(--card))',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'linear-gradient(135deg, var(--violet), var(--magenta))', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: '#fff' }}>8</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--violet)' }}>8s</div>
              <div className="muted" style={{ fontSize: 10 }}>8人カスタム</div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            8人ロビーで即席4v4。レート+武器ロール考慮の自動振り分け。レート変動なし。
          </p>
        </button>

        {/* Scrim */}
        <button type="button" className="card glow-hover" onClick={() => router.push(signedIn ? '/custom' : '/login')} style={{
          padding: 20, cursor: 'pointer', textAlign: 'left',
          borderColor: 'rgba(255,43,214,0.3)', background: 'linear-gradient(135deg, rgba(255,43,214,0.06), var(--card))',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'linear-gradient(135deg, var(--magenta), var(--cyan))', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: '#fff' }}>S</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--magenta)' }}>SCRIM</div>
              <div className="muted" style={{ fontSize: 10 }}>スクリム</div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            パーティvsパーティの練習試合。PEAK平均マッチング。HP全マップ実施。
          </p>
        </button>

        {/* Tournament */}
        <button type="button" className="card glow-hover" onClick={() => router.push('/tournaments')} style={{
          padding: 20, cursor: 'pointer', textAlign: 'left',
          borderColor: 'rgba(255,176,32,0.3)', background: 'linear-gradient(135deg, rgba(255,176,32,0.06), var(--card))',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'linear-gradient(135deg, var(--amber), #ff6b20)', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: '#fff' }}>T</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--amber)' }}>TOURNAMENT</div>
              <div className="muted" style={{ fontSize: 10 }}>大会</div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            誰でも開催可能。シングル/ダブルエリミ、リーグ、ブロックリーグ対応。
          </p>
        </button>

        {/* Ranking */}
        <button type="button" className="card glow-hover" onClick={() => router.push('/ranking')} style={{
          padding: 20, cursor: 'pointer', textAlign: 'left',
          borderColor: 'rgba(0,245,160,0.3)', background: 'linear-gradient(135deg, rgba(0,245,160,0.06), var(--card))',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'linear-gradient(135deg, var(--success), var(--cyan))', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: '#04050c' }}>K</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--success)' }}>RANKING</div>
              <div className="muted" style={{ fontSize: 10 }}>ランキング</div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            シーズン別ランキング。ティア制度。コントローラー別統計。
          </p>
        </button>

        {/* Reviews */}
        <button type="button" className="card glow-hover" onClick={() => router.push('/blog')} style={{
          padding: 20, cursor: 'pointer', textAlign: 'left',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14, color: 'var(--text-soft)' }}>W</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>REVIEWS</div>
              <div className="muted" style={{ fontSize: 10 }}>レビュー</div>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            コントローラーレビューの投稿・閲覧。購入の参考に。
          </p>
        </button>
      </div>

      {/* Bottom bar — GA badge + quick info */}
      <div className="row" style={{ justifyContent: 'center', gap: 20, marginTop: 20 }}>
        <span className="badge" style={{ fontSize: 10 }}>GA準拠</span>
        <span className="badge" style={{ fontSize: 10 }}>4v4</span>
        <span className="badge" style={{ fontSize: 10 }}>Eloレート制</span>
        <span className="badge" style={{ fontSize: 10 }}>BAN/PICK</span>
        <span className="badge" style={{ fontSize: 10 }}>レート変動なし(8s/Scrim)</span>
        <span className="badge" style={{ fontSize: 10 }}>大会開催自由</span>
      </div>
    </main>
  )
}
