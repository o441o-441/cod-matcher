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
          <p className="muted">Black Ops 7 GA（ジェントルマンズアグリーメント）</p>
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
              <li>ルールを設定（S&Dのみ）</li>
              <li>ロビーコードをASCENTに送信</li>
              <li>勢力を確認（メンバーがJSOC、ギルドに正しく振り分けられているか）</li>
              <li>試合開始</li>
            </ol>
          </div>
          <img
            src="/tutorial.png"
            alt="プライベートマッチロビーの見方 - ロビーコード、JSOC（チーム1）、ギルド（チーム2）の位置"
            style={{ width: '100%', borderRadius: 'var(--r-lg)', marginTop: 16 }}
          />
        </div>
      </div>

      <div className="section">
        <p className="sec-title">マップ &amp; モード</p>
        <div className="card-strong">
          <div className="grid grid-3">
            <div className="card">
              <h3>サーチ&amp;デストロイ</h3>
              <ul>
                <li>プラザ</li>
                <li>デン</li>
                <li>グリッドロック</li>
                <li>レイド</li>
                <li>スカー</li>
                <li>フリンジ</li>
              </ul>
            </div>

            <div className="card">
              <h3>オーバーロード</h3>
              <ul>
                <li>デン</li>
                <li>エクスポージャー</li>
                <li>スカー</li>
              </ul>
            </div>

            <div className="card">
              <h3>ハードポイント</h3>
              <ul>
                <li>酒</li>
                <li>コロッサス</li>
                <li>デン</li>
                <li>クリフタウン</li>
                <li>スカー</li>
                <li>グリッドロック</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">ゲーム設定の注意点</p>
        <div className="card-strong">
          <ul>
            <li>設定後に再度確認しようとすると設定がリセットされることがあるので注意。</li>
            <li>試合後に設定がリセットされることがあるので注意。</li>
            <li>チームシャッフルバグは修正済み。</li>
            <li>サーチ&amp;デストロイは CDL モードが使えないため、通常モードをカスタムして使用。</li>
          </ul>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">ハードポイント設定</p>
        <div className="card-strong">
          <div className="card">
            <h3>CDL ハードポイント</h3>
            <p>「CDL ハードポイント」を選択。<strong>ルール設定の変更はありません。</strong></p>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">サーチ&amp;デストロイ設定</p>
        <div className="card-strong">
          <div className="card" style={{ borderColor: 'rgba(255,77,109,0.3)' }}>
            <p className="danger">
              <strong>注意:</strong> CDL サーチ&amp;デストロイはデス後のカメラがバグっており、敵位置やボム設置が見えてしまうため使用しない。
            </p>
          </div>

          <div className="card mt-s">
            <h3>通常サーチ&amp;デストロイ（カスタム）</h3>
            <p>通常の「サーチアンドデストロイ」を選択 → ルール設定で以下を変更</p>

            <div className="grid grid-2">
              <div>
                <strong>ゲーム</strong>
                <ul>
                  <li>ラウンド制限時間: <span className="mono">1分30秒</span></li>
                  <li>マッチ開始時間: <span className="mono">30秒</span></li>
                  <li>入力切替許可: オフ</li>
                  <li>コールアウトピンを許可: オフ</li>
                </ul>
              </div>
              <div>
                <strong>アドバンス</strong>
                <ul>
                  <li>解除時間: <span className="mono">7.5秒</span></li>
                  <li>サイレント設置: オン</li>
                </ul>
              </div>
              <div>
                <strong>プレイヤー</strong>
                <ul>
                  <li>武器固定: オフ</li>
                </ul>
              </div>
              <div>
                <strong>チーム</strong>
                <ul>
                  <li>キルカメラ: オフ</li>
                  <li>コンパス上の敵: オフ</li>
                  <li>味方への誤射: オン</li>
                </ul>
              </div>
              <div>
                <strong>ゲームプレイ</strong>
                <ul>
                  <li>装備リミット: オフ</li>
                  <li>バトルチャッター: オフ</li>
                  <li>自動ドア: オフ</li>
                  <li>マップのギミック: オフ</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">オーバーロード設定</p>
        <div className="card-strong">
          <div className="card">
            <p>「CDL オーバーロード」を選択。<strong>ルール設定の変更はありません。</strong></p>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">使用可能武器</p>
        <div className="card-strong">
          <div className="grid grid-2">
            <div className="card">
              <h3>AR</h3>
              <p className="mono">M15 MOD 0</p>
              <p className="muted">マズル禁止 / 等倍サイト必須</p>
            </div>

            <div className="card">
              <h3>SMG</h3>
              <p className="mono">DRAVEC 45</p>
            </div>

            <div className="card">
              <h3>SR</h3>
              <p className="mono">VS RECON</p>
              <p className="muted">アタッチメント全て禁止 / S&amp;D で 1 人のみ使用可</p>
            </div>

            <div className="card">
              <h3>HG</h3>
              <p className="mono">JAGER 45</p>
              <p className="muted">アタッチメントはサイトのみ可</p>
            </div>

            <div className="card">
              <h3>近接武器</h3>
              <p className="mono">KNIFE</p>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">装備</p>
        <div className="card-strong">
          <div className="grid grid-2">
            <div className="card">
              <h3>フィールドアップグレード</h3>
              <ul>
                <li>トロフィー（チーム内 2 人まで、高性能バッテリー必須）</li>
                <li>トロフィーを持たない人はミュートフィールドを持つ</li>
              </ul>
            </div>

            <div className="card">
              <h3>タクティカル</h3>
              <ul>
                <li>スタングレネード</li>
                <li>スモーク（S&amp;D のみ 1 人まで可）</li>
              </ul>
              <p className="muted">タクティカルはオーバークロック可</p>
            </div>

            <div className="card">
              <h3>リーサル</h3>
              <ul>
                <li>フラグ</li>
                <li>スティッキーグレネード</li>
              </ul>
              <p className="muted">リーサルのオーバークロックは「高密度爆薬」のみ使用可</p>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">パーク</p>
        <div className="card-strong">
          <div className="grid grid-2">
            <div className="card">
              <h3>PERK 1</h3>
              <ul>
                <li>ライトウェイト</li>
                <li>ニンジャ</li>
                <li>フラックジャケット</li>
              </ul>
            </div>

            <div className="card">
              <h3>PERK 2</h3>
              <ul>
                <li>テックマスク</li>
                <li>ファストハンド</li>
              </ul>
            </div>

            <div className="card">
              <h3>PERK 3</h3>
              <ul>
                <li>デクスタリティ</li>
              </ul>
            </div>

            <div className="card">
              <h3>ワイルドカード</h3>
              <ul>
                <li>PERK グリード</li>
              </ul>
            </div>
          </div>

          <div className="card mt-s" style={{ borderColor: 'rgba(255,77,109,0.3)' }}>
            <p className="danger">
              <strong>禁止:</strong> フラックジャケット と テックマスク の同時使用は禁止
            </p>
            <p className="muted">コンバットスペシャルのタクティシャンは使用可</p>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">スコアストリーク</p>
        <div className="card-strong">
          <div className="card">
            <p>ヘルストームのみ使用可能</p>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">アタッチメント制限</p>
        <div className="card-strong">
          <div className="card">
            <ul>
              <li>等倍以外のサイト禁止</li>
              <li>赤点を消すものは禁止</li>
              <li>ヘッドショット倍率を上げるものは禁止</li>
              <li>連射速度を上げるものは禁止</li>
              <li>レーザー禁止</li>
              <li>アンダーバレルの M335-X 系統は禁止</li>
              <li>プレステージアタッチメント禁止</li>
              <li>AR はマズル禁止</li>
              <li>VAS 収束フォアグリップ禁止</li>
              <li>HG はサイト以外禁止</li>
            </ul>
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
