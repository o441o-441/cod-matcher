'use client'

import { usePageView } from '@/lib/usePageView'

const TIERS = [
  { name: 'ASCENDANT', rating: '2200+', color: 'var(--tier-ascendant)', desc: '頂点に立つ者。圧倒的な実力と経験を兼ね備えた最上位ランク。' },
  { name: 'RAINBOW', rating: '2000+', color: 'var(--tier-crimson)', desc: 'あらゆる状況に対応できる万能プレイヤー。勝利への嗅覚が鋭い。', rainbow: true },
  { name: 'CRIMSON', rating: '1800+', color: 'var(--tier-crimson)', desc: '高い判断力とエイム力を持つ上級者。チームの柱となる存在。' },
  { name: 'DIAMOND', rating: '1600+', color: 'var(--tier-diamond)', desc: 'GA環境での立ち回りを理解し、安定したパフォーマンスを発揮する。' },
  { name: 'PLATINUM', rating: '1400+', color: 'var(--tier-platinum)', desc: '基礎が固まり、連携を意識したプレイができる中級者。初期レートはここからスタート。' },
  { name: 'GOLD', rating: '1200+', color: 'var(--tier-gold)', desc: 'ルールを理解し、チームプレイの基本が身についてきた段階。' },
  { name: 'SILVER', rating: '1000+', color: 'var(--tier-silver)', desc: 'GA環境に慣れ始めた段階。経験を積んで上を目指そう。' },
  { name: 'BRONZE', rating: '~1000未満', color: 'var(--tier-bronze)', desc: 'スタート地点。まずはルールを覚えて試合に慣れよう。' },
]

export default function TiersPage() {
  usePageView('/tiers')

  return (
    <main>
      <div className="eyebrow">RANK TIERS</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        ランク<em>ティア一覧。</em>
      </h1>
      <p className="muted">レートに応じて8段階のティアが割り当てられます。初期レートは 1500（PLATINUM）です。</p>

      <div className="stack mt-l" style={{ gap: 12 }}>
        {TIERS.map((t, i) => (
          <div
            key={t.name}
            className="card-strong"
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 140px 1fr',
              alignItems: 'center',
              gap: 20,
              padding: '20px 24px',
              borderColor: i === 0 ? 'rgba(255, 43, 214, 0.4)' : 'var(--line-strong)',
            }}
          >
            {/* Rank icon */}
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: t.rainbow
                  ? 'linear-gradient(135deg, #ff0000, #ff8800, #ffff00, #00ff00, #0088ff, #8800ff)'
                  : t.color,
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 16,
                color: '#04050c',
                boxShadow: `0 0 20px ${t.color}`,
              }}
            >
              {t.name[0]}
            </div>

            {/* Name + rating */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 18,
                  letterSpacing: '0.08em',
                  color: t.rainbow ? undefined : t.color,
                  ...(t.rainbow ? {
                    background: 'linear-gradient(90deg, #ff0000, #ff8800, #ffff00, #00ff00, #0088ff, #8800ff)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  } : {}),
                }}
              >
                {t.name}
              </div>
              <div className="mono tabular" style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 2 }}>
                SR {t.rating}
              </div>
            </div>

            {/* Description */}
            <div style={{ fontSize: 14, color: 'var(--text-soft)', lineHeight: 1.6 }}>
              {t.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Rating system explanation */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          レーティングシステム
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="card">
            <div className="stat-label">初期レート</div>
            <div className="stat-val" style={{ color: 'var(--tier-platinum)' }}>1500</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>全プレイヤーは PLATINUM ティアからスタートします。</p>
          </div>
          <div className="card">
            <div className="stat-label">レート変動</div>
            <div className="stat-val" style={{ color: 'var(--cyan)' }}>ELO</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>勝敗とレート差に基づいて変動します。格上に勝つと大きく上がります。</p>
          </div>
          <div className="card">
            <div className="stat-label">シーズン</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginTop: 4 }}>リセット制</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>シーズン終了時にレートがリセットされ、新シーズンは 1500 から再スタートです。</p>
          </div>
          <div className="card">
            <div className="stat-label">ピークレート</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginTop: 4 }}>記録</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>シーズン中の最高レートがプロフィールに記録されます。</p>
          </div>
        </div>
      </div>
    </main>
  )
}
