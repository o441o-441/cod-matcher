'use client'

import { useEffect, useRef, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const [waitingCount, setWaitingCount] = useState<number>(0)
  const [loadingStats, setLoadingStats] = useState(true)
  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchStats = async () => {
    const { count, error } = await supabase
      .from('match_queue')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('fetchStats error:', error)
      setLoadingStats(false)
      return
    }

    setWaitingCount(count || 0)
    setLoadingStats(false)
  }

  useEffect(() => {
    void Promise.resolve().then(fetchStats)

    const channel = supabase
      .channel('home-waiting-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_queue',
        },
        async () => {
          await fetchStats()
        }
      )
      .subscribe((status) => {
        console.log('home realtime status:', status)
      })

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [])

  return (
    <main>
      <div className="card-strong">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>COD マッチングサイト</h1>
            <p className="muted">
              BO7 / 4v4 / CDLルール準拠のレート対戦プラットフォーム
            </p>
          </div>

          <div className="row">
            <button onClick={() => router.push('/login')}>ログイン</button>
            <button onClick={() => router.push('/ranking')}>ランキング</button>
          </div>
        </div>
      </div>

      <div className="section grid grid-2">
        <div className="card">
          <h2>現在の状況</h2>
          <div className="stack">
            <p>
              <strong>待機中チーム数:</strong>{' '}
              {loadingStats ? '取得中...' : `${waitingCount}チーム`}
            </p>
            <p className="muted">
              待機中チーム数は自動更新されます
            </p>
          </div>
        </div>

        <div className="card">
          <h2>このサイトでできること</h2>
          <div className="stack">
            <p>・Discordログインで参加</p>
            <p>・チーム作成 / メンバー管理</p>
            <p>・ランダムマッチング</p>
            <p>・試合結果の報告 / 承認 / 却下</p>
            <p>・レート変動とランキング表示</p>
            <p>・マッチ履歴の確認</p>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>ルール概要</h2>

        <div className="grid grid-2">
          <div className="card">
            <p>・4v4 チーム戦</p>
            <p>・BO7 / CDLルール準拠</p>
            <p>・3モード中2勝でシリーズ勝利</p>
          </div>

          <div className="card">
            <p>・対象モード: Hardpoint / S&amp;D / Overload</p>
            <p>・結果は相手チームの承認で確定</p>
            <p>・直近2試合の相手は再戦回避</p>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>はじめかた</h2>

        <div className="stack">
          <div className="card">
            <p>
              <strong>1.</strong> Discordでログイン
            </p>
          </div>

          <div className="card">
            <p>
              <strong>2.</strong> チームを作成
            </p>
          </div>

          <div className="card">
            <p>
              <strong>3.</strong> 対戦開始
            </p>
          </div>

          <div className="card">
            <p>
              <strong>4.</strong> 試合結果を報告
            </p>
          </div>
        </div>

        <div className="section row">
          <button onClick={() => router.push('/login')}>ログインして始める</button>
          <button onClick={() => router.push('/ranking')}>ランキングを見る</button>
        </div>
      </div>
    </main>
  )
}