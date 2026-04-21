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
            <div className="stat-val" style={{ color: 'var(--tier-platinum)' }}>1400 / 1500</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>オンボーディングで「初級者」を選んだ場合は 1400、それ以外は 1500 からスタートします。</p>
          </div>
          <div className="card">
            <div className="stat-label">レート変動</div>
            <div className="stat-val" style={{ color: 'var(--cyan)' }}>ELO</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>勝敗とレート差に基づいて変動します。格上に勝つと大きく上がります。</p>
          </div>
          <div className="card">
            <div className="stat-label">ピークレート</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginTop: 4 }}>記録</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>シーズン中の最高レートがプロフィールに記録されます。</p>
          </div>
          <div className="card">
            <div className="stat-label">シーズン</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginTop: 4 }}>リセット制</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>シーズン終了時にレートがリセットされます。リセット後の開始レートはシーズン中のピークレートに応じて決まります。</p>
          </div>
        </div>
      </div>
      {/* Season reset rules */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          シーズンリセット時の開始レート
        </div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
          シーズンリセット時の開始レートは、前シーズン中に一度でも到達したピークレートに基づいて決まります。
        </p>
        <div className="stack" style={{ gap: 8 }}>
          <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '12px 16px' }}>
            <div>
              <div style={{ fontWeight: 700 }}>ピークレートが 1600 以上</div>
              <div className="muted" style={{ fontSize: 12 }}>一度でも 1600 を上回った場合</div>
            </div>
            <div className="mono tabular" style={{ fontSize: 20, fontWeight: 700, color: 'var(--tier-diamond)' }}>→ 1600</div>
          </div>
          <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '12px 16px' }}>
            <div>
              <div style={{ fontWeight: 700 }}>ピークレートが 1500 以上</div>
              <div className="muted" style={{ fontSize: 12 }}>一度でも 1500 を上回った場合</div>
            </div>
            <div className="mono tabular" style={{ fontSize: 20, fontWeight: 700, color: 'var(--tier-platinum)' }}>→ 1500</div>
          </div>
          <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '12px 16px' }}>
            <div>
              <div style={{ fontWeight: 700 }}>初級者スタート（ピーク 1500 未満）</div>
              <div className="muted" style={{ fontSize: 12 }}>オンボーディングで「初級者」を選択し、1500 に到達していない場合</div>
            </div>
            <div className="mono tabular" style={{ fontSize: 20, fontWeight: 700, color: 'var(--tier-gold)' }}>→ 1400</div>
          </div>
        </div>
      </div>
    </main>
  )
}
