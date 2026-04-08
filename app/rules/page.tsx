'use client'

import { useRouter } from 'next/navigation'

export default function RulesPage() {
  const router = useRouter()

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ルール一覧</h1>
          <p className="muted">Black Ops 7 GA（ジェントルマンズアグリーメント）</p>
        </div>
        <div className="row">
          <button onClick={() => router.back()}>戻る</button>
          <button onClick={() => router.push('/')}>トップへ</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>マップ & モード</h2>

        <div className="grid grid-3">
          <div className="card">
            <h3>サーチ&デストロイ</h3>
            <ul>
              <li>コロッサス</li>
              <li>デン</li>
              <li>エクスポージャー</li>
              <li>レイド</li>
              <li>スカー</li>
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
              <li>ブラックハート</li>
              <li>コロッサス</li>
              <li>デン</li>
              <li>エクスポージャー</li>
              <li>スカー</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>ゲーム設定の注意点</h2>
        <ul>
          <li>設定後に再度確認しようとすると設定がリセットされることがあるので注意。</li>
          <li>試合後に設定がリセットされることがあるので注意。</li>
          <li>チームシャッフルバグは修正済み。</li>
          <li>サーチ&デストロイは CDL モードが使えないため、通常モードをカスタムして使用。</li>
        </ul>
      </div>

      <div className="section card-strong">
        <h2>ハードポイント設定</h2>

        <div className="card">
          <h3>CDL ハードポイント</h3>
          <p>「CDL ハードポイント」を選択。<strong>ルール設定の変更はありません。</strong></p>
        </div>

        <div className="card">
          <h3>通常ハードポイント（カスタム）</h3>
          <p>通常の「ハードポイント」を選択 → ルール設定で以下を変更</p>

          <div className="grid grid-2">
            <div>
              <strong>ゲーム</strong>
              <ul>
                <li>マッチ開始時間: 30秒</li>
                <li>入力切替許可: オフ</li>
                <li>コールアウトピンを許可: オフ</li>
              </ul>
            </div>
            <div>
              <strong>アドバンス</strong>
              <ul>
                <li>初期ゾーン有効化遅延: オフ</li>
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
                <li>リスポーン遅延: 3秒</li>
                <li>セルフキルスポーン遅延: 1秒</li>
                <li>チーム割り当て: オン（シャッフルバグ対策）</li>
                <li>味方への誤射: オン</li>
              </ul>
            </div>
            <div>
              <strong>ゲームプレイ</strong>
              <ul>
                <li>スコアストリーク遅延: 10秒</li>
                <li>装備リミット: オフ</li>
                <li>バトルチャッター: オフ</li>
                <li>自動ドア: オフ</li>
                <li>マップのギミック: オフ</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>サーチ&デストロイ設定</h2>

        <div className="card">
          <p className="danger">
            <strong>注意:</strong> CDL サーチ&デストロイはデス後のカメラがバグっており、敵位置やボム設置が見えてしまうため使用しない。
          </p>
        </div>

        <div className="card">
          <h3>通常サーチ&デストロイ（カスタム）</h3>
          <p>通常の「サーチアンドデストロイ」を選択 → ルール設定で以下を変更</p>

          <div className="grid grid-2">
            <div>
              <strong>ゲーム</strong>
              <ul>
                <li>ラウンド制限時間: 1分30秒</li>
                <li>マッチ開始時間: 30秒</li>
                <li>入力切替許可: オフ</li>
                <li>コールアウトピンを許可: オフ</li>
              </ul>
            </div>
            <div>
              <strong>アドバンス</strong>
              <ul>
                <li>解除時間: 7.5秒</li>
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
                <li>チーム割り当て: オン（シャッフルバグ対策）</li>
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

      <div className="section card-strong">
        <h2>オーバーロード設定</h2>
        <div className="card">
          <p>「CDL オーバーロード」を選択。<strong>ルール設定の変更はありません。</strong></p>
        </div>
      </div>

      <div className="section card-strong">
        <h2>使用可能武器</h2>

        <div className="grid grid-2">
          <div className="card">
            <h3>AR</h3>
            <p>M15 MOD 0</p>
            <p className="muted">マズル禁止 / 等倍サイト必須</p>
          </div>

          <div className="card">
            <h3>SMG</h3>
            <p>DRAVEC 45</p>
          </div>

          <div className="card">
            <h3>SR</h3>
            <p>VS RECON</p>
            <p className="muted">アタッチメント全て禁止 / S&D で 1 人のみ使用可</p>
          </div>

          <div className="card">
            <h3>HG</h3>
            <p>JAGER 45</p>
            <p className="muted">アタッチメントはサイトのみ可</p>
          </div>

          <div className="card">
            <h3>近接武器</h3>
            <p>KNIFE</p>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>装備</h2>

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
              <li>スモーク（S&D のみ 1 人まで可）</li>
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

      <div className="section card-strong">
        <h2>パーク</h2>

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

        <div className="card" style={{ marginTop: 12 }}>
          <p className="danger">
            <strong>禁止:</strong> フラックジャケット と テックマスク の同時使用は禁止
          </p>
          <p className="muted">コンバットスペシャルのタクティシャンは使用可</p>
        </div>
      </div>

      <div className="section card-strong">
        <h2>スコアストリーク</h2>
        <div className="card">
          <p>ヘルストームのみ使用可能</p>
        </div>
      </div>

      <div className="section card-strong">
        <h2>アタッチメント制限</h2>
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
            <li>HG はサイト以外禁止</li>
          </ul>
        </div>
      </div>

      <div className="section card-strong">
        <h2>その他</h2>
        <div className="card">
          <ul>
            <li className="danger">スネークグリッチ禁止</li>
            <li className="danger">階段グリッチ禁止</li>
          </ul>
        </div>
      </div>
    </main>
  )
}
