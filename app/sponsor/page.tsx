'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function SponsorPage() {
  const router = useRouter()
  const [totalUsers, setTotalUsers] = useState<number | null>(null)
  const [totalMatches, setTotalMatches] = useState<number | null>(null)

  useEffect(() => {
    const load = async () => {
      const [{ count: users }, { count: matches }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      ])
      setTotalUsers(users ?? 0)
      setTotalMatches(matches ?? 0)
    }
    void load()
  }, [])

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>スポンサー募集</h1>
          <p className="muted">ASCENT パートナーシップのご案内</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/')}>トップページへ</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>ASCENT とは</h2>
        <div className="card">
          <p style={{ lineHeight: 1.8 }}>
            ASCENT は Black Ops 7 の 4v4 レート対戦プラットフォームです。
            GA（ジェントルマンズアグリーメント）ルールに準拠した公正な対戦環境を提供し、
            プレイヤーのスキル向上とコミュニティの活性化を目指しています。
          </p>
          <p style={{ lineHeight: 1.8, marginTop: 12 }}>
            Discord ログインによる参加、自動マッチング、バンピック、レートシステム、
            シーズンランキング、ブログ、通報・監視システムなど、
            競技シーンに必要な機能を網羅しています。
          </p>
        </div>
      </div>

      <div className="section card-strong">
        <h2>プラットフォーム実績</h2>
        <div className="grid grid-2">
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">登録ユーザー数</p>
            <h3 style={{ fontSize: '2rem' }}>{totalUsers ?? '...'}</h3>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="muted">累計試合数</p>
            <h3 style={{ fontSize: '2rem' }}>{totalMatches ?? '...'}</h3>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>スポンサーメリット</h2>
        <div className="stack">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>ロゴ掲載</h3>
            <p className="muted">
              トップページ、マッチング画面、ランキングページにスポンサーロゴを掲載。
              全ユーザーの目に触れる位置に配置します。
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>お知らせ配信</h3>
            <p className="muted">
              トップページの「運営からのお知らせ」欄でスポンサー関連の告知を配信。
              新製品紹介やキャンペーン情報の発信が可能です。
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>大会冠スポンサー</h3>
            <p className="muted">
              定期開催トーナメントの冠スポンサーとして、大会名にブランド名を冠することができます。
              賞品提供と合わせてブランド認知度向上に貢献します。
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>コミュニティ連携</h3>
            <p className="muted">
              Discord サーバーでのスポンサー専用チャンネル開設、
              ブログでの製品レビュー記事掲載など、コミュニティと密接に連携した施策が可能です。
            </p>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>ユーザー層</h2>
        <div className="grid grid-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>ゲームタイトル</h3>
            <p>Call of Duty: Black Ops 7</p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>対戦形式</h3>
            <p>4v4 GA ルール準拠</p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>プラットフォーム</h3>
            <p>Battle.net / Steam / PlayStation / Xbox</p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>特徴</h3>
            <p>競技志向のプレイヤーが中心。デバイスやギアへの関心が高い層</p>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>お問い合わせ</h2>
        <div className="card">
          <p style={{ lineHeight: 1.8 }}>
            スポンサーシップに関するお問い合わせは、以下の方法でご連絡ください。
          </p>
          <div className="stack" style={{ marginTop: 12 }}>
            <p>Discord: ASCENT 公式サーバー</p>
            <p>X (Twitter): @ascent_esports</p>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            ご連絡いただければ、詳細な資料をお送りいたします。
          </p>
        </div>
      </div>

      <div className="section row" style={{ justifyContent: 'center', gap: 16 }}>
        <a href="/terms">利用規約</a>
        <a href="/privacy">プライバシーポリシー</a>
      </div>
    </main>
  )
}
