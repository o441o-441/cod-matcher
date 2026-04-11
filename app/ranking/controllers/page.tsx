'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type ControllerRow = {
  controller: string
  user_count: number
  avg_rating: number
  avg_wins: number
  avg_losses: number
  avg_win_rate: number
}

type AffiliateUrl = {
  controller_name: string
  url: string
}

export default function ControllerRankingPage() {
  const router = useRouter()
  const [data, setData] = useState<ControllerRow[]>([])
  const [affiliateUrls, setAffiliateUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [minGames, setMinGames] = useState(5)

  const fetchRanking = async (min: number) => {
    setLoading(true)
    const [{ data: rows, error }, { data: urls }] = await Promise.all([
      supabase.rpc('rpc_get_controller_ranking', { p_min_games: min }),
      supabase.from('affiliate_urls').select('controller_name, url'),
    ])

    if (error) {
      console.error('controller ranking error:', error)
      setLoading(false)
      return
    }

    setData((rows ?? []) as ControllerRow[])

    const urlMap: Record<string, string> = {}
    for (const u of (urls ?? []) as AffiliateUrl[]) {
      urlMap[u.controller_name] = u.url
    }
    setAffiliateUrls(urlMap)
    setLoading(false)
  }

  useEffect(() => {
    void fetchRanking(minGames)
  }, [minGames])

  const handleClickLink = async (controllerName: string, url: string) => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    await supabase.from('link_clicks').insert({
      controller_name: controllerName,
      user_id: session?.user?.id ?? null,
    })

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>コントローラーランキング</h1>
          <p className="muted">使用者の平均レートが高い順</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/ranking')}>レートランキング</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section row" style={{ alignItems: 'center' }}>
        <span className="muted">最低試合数:</span>
        <select
          value={minGames}
          onChange={(e) => setMinGames(Number(e.target.value))}
        >
          <option value={1}>1試合以上</option>
          <option value={3}>3試合以上</option>
          <option value={5}>5試合以上</option>
          <option value={10}>10試合以上</option>
        </select>
      </div>

      <div className="section card-strong">
        {loading ? (
          <LoadingCard message="ランキングを読み込み中..." />
        ) : data.length === 0 ? (
          <EmptyCard
            title="データがありません"
            message="条件に合うプレイヤーがまだいません。"
          />
        ) : (
          <div className="stack">
            {data.map((row, index) => (
              <div key={row.controller} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p className="muted">#{index + 1}</p>
                    <h3 style={{ marginTop: 0 }}>{row.controller}</h3>
                    <p className="muted" style={{ marginTop: 2 }}>
                      使用者 {row.user_count}人
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <h3 style={{ marginTop: 0 }}>平均レート {row.avg_rating}</h3>
                    <p className="muted">
                      平均 {row.avg_wins}勝 {row.avg_losses}敗 / 勝率 {row.avg_win_rate}%
                    </p>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <button
                    onClick={() => router.push(`/blog?controller=${encodeURIComponent(row.controller)}`)}
                  >
                    レビューを見る
                  </button>
                  {affiliateUrls[row.controller] && (
                    <button
                      onClick={() => handleClickLink(row.controller, affiliateUrls[row.controller])}
                      style={{
                        background: 'linear-gradient(180deg, var(--accent-cyan, #00e5ff), var(--accent-strong, #00b3ff))',
                        color: '#fff',
                        fontWeight: 'bold',
                        boxShadow: 'var(--glow-cyan)',
                      }}
                    >
                      購入リンク
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
