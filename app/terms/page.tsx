'use client'

import { useRouter } from 'next/navigation'

export default function TermsPage() {
  const router = useRouter()

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>利用規約</h1>
          <p className="muted">最終更新日: 2026年04月08日</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/')}>トップページに戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <p>
          本利用規約（以下「本規約」といいます）は、ASCENT（以下「本サービス」といいます）の提供条件および本サービスの利用に関する権利義務関係を定めるものです。
          本サービスを利用される方（以下「利用者」といいます）は、本規約に同意したうえで本サービスを利用するものとします。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第1条（適用）</h2>
        <p>
          本規約は、利用者と本サービスの運営者との間の本サービスの利用に関わる一切の関係に適用されます。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第2条（サービス内容）</h2>
        <p>
          本サービスは、Call of Duty 等の対戦型ゲームを対象とした、利用者同士のマッチング・パーティ編成・対戦結果記録・レーティング表示などの機能を提供します。
          サービスの内容は予告なく変更されることがあります。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第3条（アカウントの登録および管理）</h2>
        <ul>
          <li>本サービスの利用には Discord アカウントによる認証が必要です。</li>
          <li>利用者は虚偽の情報を登録してはなりません。</li>
          <li>利用者は自己のアカウントの管理責任を負い、第三者に譲渡・貸与することはできません。</li>
          <li>未成年の利用者は保護者の同意のうえで本サービスを利用するものとします。</li>
        </ul>
      </div>

      <div className="section card-strong">
        <h2>第4条（禁止事項）</h2>
        <p>利用者は、本サービスの利用にあたり以下の行為をしてはなりません。</p>
        <ul>
          <li>法令または公序良俗に反する行為</li>
          <li>犯罪行為に関連する行為</li>
          <li>他の利用者または第三者の権利・プライバシーを侵害する行為</li>
          <li>他の利用者または第三者を誹謗中傷し、名誉を毀損する行為</li>
          <li>本サービスの運営を妨害する行為</li>
          <li>不正アクセス、botの使用、システム改ざん等の不正行為</li>
          <li>マッチング結果やレーティングの不正操作（談合、放置、わざと負ける行為等）</li>
          <li>チート、外部ツール、マクロ等を使用した対戦結果の取得</li>
          <li>本サービスを通じた営利目的の宣伝・勧誘行為（運営が許可するものを除く）</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </ul>
      </div>

      <div className="section card-strong">
        <h2>第5条（利用制限・アカウント停止）</h2>
        <p>
          運営者は、利用者が本規約に違反したと判断した場合、事前の通知なく、当該利用者に対してアカウントの一時停止、削除、その他必要な措置を講じることができます。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第6条（知的財産権）</h2>
        <p>
          本サービスに含まれるテキスト、画像、ロゴ、ソースコード等の知的財産権は、運営者または正当な権利者に帰属します。
          利用者は運営者の事前の許可なくこれらを複製、転載、販売、改変等してはなりません。
        </p>
        <p className="muted">
          ※ Call of Duty、Black Ops 等のゲームタイトルおよび関連する商標は、Activision Publishing, Inc. および各権利者の商標または登録商標です。本サービスはこれらの権利者とは一切関係ありません。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第7条（免責事項）</h2>
        <ul>
          <li>運営者は、本サービスの内容の正確性、完全性、有用性について保証しません。</li>
          <li>運営者は、本サービスの利用または利用不能によって利用者に生じた損害について、一切の責任を負いません。</li>
          <li>運営者は、利用者間または利用者と第三者間で生じたトラブルについて、一切の責任を負いません。</li>
          <li>システム障害、サーバ障害、外部サービスの停止により本サービスが利用できない場合があります。</li>
        </ul>
      </div>

      <div className="section card-strong">
        <h2>第8条（サービスの変更・中断・終了）</h2>
        <p>
          運営者は、利用者への事前の通知なく本サービスの内容を変更し、または提供を中断・終了することができます。
          これによって利用者に生じた損害について、運営者は一切の責任を負いません。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第9条（規約の変更）</h2>
        <p>
          運営者は必要と判断した場合、利用者に通知することなく本規約を変更できるものとします。
          変更後の本規約は、本ページに掲載された時点から効力を生じます。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第10条（準拠法・管轄裁判所）</h2>
        <p>
          本規約の解釈にあたっては日本法を準拠法とします。
          本サービスに関して紛争が生じた場合には、運営者の所在地を管轄する裁判所を専属的合意管轄とします。
        </p>
      </div>

      <div className="section card-strong">
        <h2>第11条（運営者・問い合わせ先）</h2>
        <p>
          運営者: ASCENT運営チーム
          <br />
          連絡先: ascent.o441o@gmail.com
        </p>
      </div>
    </main>
  )
}
