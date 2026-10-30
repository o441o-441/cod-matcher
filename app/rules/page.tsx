'use client'

import { useRouter } from 'next/navigation'
import { usePageView } from '@/lib/usePageView'

export default function RulesPage() {
  const router = useRouter()
  usePageView('/rules')

  return (
    <main>
      <div className="rowx mb-s">
        <div>
          <p className="eyebrow">RULES &amp; FAQ</p>
          <h1 className="display"><em>ルール一覧</em></h1>
          <p className="muted">ASCENT独自ルール（Modern Warfare 4）</p>
        </div>
        <button className="btn-ghost" style={{ padding: '8px 14px' }} onClick={() => router.back()}>
          戻る
        </button>
      </div>

      <div id="lobby-guide" className="section">
        <p className="sec-title">プライベートマッチの作り方</p>
        <div className="card-strong">
          <div className="card">
            <ol>
              <li>マルチプレイヤー</li>
              <li>マッチを検索</li>
              <li>プライベートマッチ</li>
              <li>プライベートマッチを作成</li>
              <li>モード、マップを設定</li>
              <li>ルールを設定</li>
              <li>ロビーコードをASCENTに送信</li>
              <li>チーム振り分けを確認（メンバーがチーム1、チーム2に正しく振り分けられているか）</li>
              <li>試合開始</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">マップ &amp; モード</p>
        <div className="card-strong">
          <div className="card">
            <h3>ハードポイント</h3>
            <ul>
              <li>シルクウォーム</li>
              <li>ミューニション</li>
              <li>リアクター</li>
              <li>ルーフトップ</li>
              <li>ロータス</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">ゲーム設定の注意点</p>
        <div className="card-strong">
          <ul>
            <li>試合後に設定がリセットされるので注意。</li>
          </ul>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">ハードポイント設定</p>
        <div className="card-strong">
          <div className="card">
            <h3>CDL ハードポイント</h3>
            <p>「CDL ハードポイント」を選択。ルール設定から以下を変更してください。</p>
            <ul>
              <li>チームタブ → キルカメラ：<strong>ON</strong></li>
              <li>チームタブ → リスポーンの無効期間：<strong>3秒</strong></li>
              <li>チームタブ → 味方への誤射：<strong>処罰</strong></li>
              <li>チームタブ → 味方への誤射の処罰リミット：<strong>5キル</strong></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">使用禁止アイテム（主なもの）</p>
        <div className="card-strong">
          <div className="grid grid-3">
            <div className="card" style={{ borderColor: 'rgba(255,77,109,0.3)' }}>
              <h3>武器</h3>
              <ul>
                <li>ショットガン・LMG・スナイパー・マークスマン全種</li>
                <li>M4</li>
                <li>HYEON BURST</li>
                <li>KASTOV 762</li>
                <li>PATRIOT XMR</li>
                <li>ODEN</li>
                <li>AXION</li>
                <li>CRONEN SQUALL</li>
                <li>WZ.55 STRIGA</li>
                <li>PPSH-41</li>
                <li>X-58 Nyx</li>
                <li>その他新武器</li>
              </ul>
            </div>

            <div className="card" style={{ borderColor: 'rgba(255,77,109,0.3)' }}>
              <h3>サブ</h3>
              <ul>
                <li>ランチャー全種</li>
                <li>KRAIT P68</li>
                <li>.50 GS</li>
                <li>Mojave .357</li>
              </ul>
            </div>

            <div className="card" style={{ borderColor: 'rgba(255,77,109,0.3)' }}>
              <h3>アタッチメント</h3>
              <ul>
                <li>等倍以外の倍率スコープ</li>
                <li>レーザー</li>
                <li>サプレッサー（その他赤点を消す装備）</li>
                <li>HS倍率バレル</li>
                <li>連射系</li>
                <li>APEX</li>
                <li>アキンボ</li>
                <li>高速弾以外の特殊弾全般</li>
                <li>ピストル用全般</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">許可されているもの</p>
        <div className="card-strong">
          <div className="grid grid-2">
            <div className="card">
              <h3>AR</h3>
              <p className="mono">HAN 86</p>
            </div>

            <div className="card">
              <h3>SMG</h3>
              <p className="mono">ISO NIGHTSHADE / VEL 46</p>
            </div>

            <div className="card">
              <h3>サブ</h3>
              <p className="mono">SANG 9MM</p>
            </div>

            <div className="card">
              <h3>リーサル</h3>
              <p className="mono">Frag / Semtex</p>
            </div>

            <div className="card">
              <h3>タクティカル</h3>
              <p className="mono">コンカッショングレネード</p>
            </div>

            <div className="card">
              <h3>フィールドアップグレード</h3>
              <p className="mono">トロフィーのみ（チーム2人）</p>
            </div>

            <div className="card">
              <h3>キルストリーク</h3>
              <p className="mono">無し</p>
            </div>

            <div className="card">
              <h3>パーク</h3>
              <ul>
                <li>パーク1：キルチェーン</li>
                <li>パーク2：ファストハンド / ニンジャ</li>
                <li>パーク3：バトルハーデン</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">その他</p>
        <div className="card-strong">
          <div className="card" style={{ borderColor: 'rgba(255,77,109,0.3)' }}>
            <ul>
              <li className="danger">スネークグリッチ禁止</li>
              <li className="danger">階段グリッチ禁止</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="section" style={{ textAlign: 'center' }}>
        <button className="btn-ghost" onClick={() => router.push('/tiers')}>
          ティア一覧を見る
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </main>
  )
}
