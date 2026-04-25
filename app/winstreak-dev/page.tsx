'use client'

import { useState } from 'react'
import { TIERS, tierFor, triggerWinStreak, type TierConfig } from '@/components/WinStreakCelebration'

const tierList: TierConfig[] = [TIERS.streak, TIERS.rampage, TIERS.unstoppable, TIERS.godlike]

export default function WinStreakDevPage() {
  const [customCount, setCustomCount] = useState(12)

  const fire = (count: number, tierKey?: string) => triggerWinStreak(count, tierKey as Parameters<typeof triggerWinStreak>[1])

  return (
    <main>
      <div className="rowx mb-l">
        <div>
          <div className="eyebrow">DEV / QA TOOLS</div>
          <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', marginTop: 6 }}>
            連勝演出<em>プレビュー v2。</em>
          </h1>
          <p className="muted mt-s" style={{ maxWidth: 620 }}>
            パチンコ保留演出 × 特進表示 × ガラス破片 × 心拍音 × ルーピングスティンガー。
            色段階チェンジで保留を煽り、虹で大当たり、特進で煽り返す。
          </p>
        </div>
        <div className="row">
          <span className="badge" style={{ background: 'var(--amber-soft, rgba(255,176,32,0.15))', color: 'var(--warning)', borderColor: 'rgba(255, 176, 32, 0.3)' }}>
            <span className="badge-dot" />DEV ONLY · SEASON BEST
          </span>
        </div>
      </div>

      {/* Custom count input */}
      <div className="ws-dev-custom">
        <input
          type="number"
          className="input"
          min={1}
          max={99}
          value={customCount}
          onChange={(e) => setCustomCount(+e.target.value || 1)}
          placeholder="任意の連勝数"
        />
        <button className="btn-primary" style={{ padding: '10px 16px', fontSize: 13, borderRadius: 10 }} onClick={() => fire(customCount)}>
          自動判定で再生
        </button>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-soft)', letterSpacing: '0.15em' }}>
          → {tierFor(customCount)?.key?.toUpperCase() || 'NO TIER'}
        </span>
      </div>

      {/* Tier cards */}
      <div className="ws-dev-grid">
        {tierList.map((t) => (
          <div key={t.key} className="card-strong ws-dev-card" style={{ '--tier-color': t.glow } as React.CSSProperties}>
            <div className="rowx">
              <h4>{t.key}</h4>
              <span className="mono" style={{ fontSize: 11, color: t.glow, letterSpacing: '0.1em' }}>
                {t.threshold}+ WINS
              </span>
            </div>
            <div className="ws-dev-desc">{t.desc}</div>
            <div className="ws-dev-meta muted">
              保留: {(t.holdDur / 1000).toFixed(1)}s &nbsp;·&nbsp; 総尺: {(t.totalDur / 1000).toFixed(1)}s &nbsp;·&nbsp; 色段階: {['WHITE', 'BLUE', 'YELLOW', 'GREEN', 'RED', 'RAINBOW'][t.stopStep]}
            </div>
            <div className="ws-dev-meta muted">
              特進: {t.rankFrom}位 → {t.rankTo}位 (+{t.rankFrom - t.rankTo})
            </div>
            <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
              <button
                className="btn-ghost"
                style={{ flex: 1, borderColor: t.glow, color: t.glow, padding: '10px 16px', fontSize: 13, borderRadius: 10 }}
                onClick={() => fire(t.threshold, t.key)}
              >
                フル再生
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Chain test */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          連鎖テスト
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          3連 → 5連 → 7連 → 10連 を順に再生
        </p>
        <div className="row mt-m">
          <button
            className="btn-primary"
            style={{ padding: '14px 22px', fontSize: 14, borderRadius: 14 }}
            onClick={async () => {
              const order: Array<{ key: string; threshold: number; totalDur: number }> = [
                TIERS.streak, TIERS.rampage, TIERS.unstoppable, TIERS.godlike,
              ]
              for (const k of order) {
                fire(k.threshold, k.key)
                await new Promise((r) => setTimeout(r, k.totalDur + 500))
              }
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            全段階を順に再生
          </button>
        </div>
      </div>

      {/* Flow documentation */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" stroke="currentColor" strokeWidth="1.6" /></svg>
          演出フロー
        </div>
        <ol style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-soft)', marginTop: 8, paddingLeft: 22 }}>
          <li><b style={{ color: '#fff' }}>保留フェーズ</b> — 画面暗転、心拍音が鳴り、中央のゲージが色段階でチェンジ（白→青→黄→緑→赤→虹）。各色変化で「キラン！」</li>
          <li><b style={{ color: '#fff' }}>大当たり確定</b> — ガラス破片が画面外へ散る、サブベース＋金属スティンガー、虹のショックウェーブ</li>
          <li><b style={{ color: '#fff' }}>メインテキスト</b> — 段階別のタイポが爆発表示、同じスティンガーが「カーン！カーン！カーン！」とピッチアップしながらループ</li>
          <li><b style={{ color: '#fff' }}>特進表示</b> — ランキング順位がカウントアップで飛び上がる、SR数値も同時更新、煽り再生</li>
        </ol>
      </div>

      {/* Usage code */}
      <div className="card-strong mt-l">
        <div className="sec-title">
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          コード使用例
        </div>
        <pre style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-soft)', background: 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 10, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>
{`import { triggerWinStreak } from '@/components/WinStreakCelebration'

// 連勝数に応じて自動判定
triggerWinStreak(5)  // → RAMPAGE

// 段階を明示的に指定
triggerWinStreak(10, 'godlike')

// 試合結果確定後に発火する例
if (winStreak >= 3) {
  triggerWinStreak(winStreak)
}`}
        </pre>
      </div>
    </main>
  )
}
