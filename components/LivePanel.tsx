'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ============================================================
// 「いまのASCENT」ライブパネル
// ランクマ待機・8sロビー・今日の交流戦・混成ルーム募集を1行で可視化し、
// 人がいる場所へユーザーを誘導する (rpc_live_stats を30秒ポーリング)。
// すべて0のときは数字を出さず、ボードへの静かな導線に切り替える。
// ============================================================

type LiveStats = {
  queue_waiting: number
  eights_lobbies: number
  eights_players: number
  scrims_today: number
  mixed_rooms_open: number
}

export default function LivePanel() {
  const router = useRouter()
  const [stats, setStats] = useState<LiveStats | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc('rpc_live_stats')
      if (!cancelled && !error && data) setStats(data as LiveStats)
    }
    void load()
    const iv = setInterval(() => void load(), 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  if (!stats) return null

  const allQuiet =
    stats.queue_waiting === 0 && stats.eights_lobbies === 0 &&
    stats.scrims_today === 0 && stats.mixed_rooms_open === 0

  const itemStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5,
    background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0',
    color: 'var(--text)', whiteSpace: 'nowrap',
  }
  const divider = <span style={{ width: 1, height: 14, background: 'rgba(140,160,220,0.25)', flex: 'none' }} />

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 16px', marginBottom: 18 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--cyan)', flex: 'none' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: allQuiet ? 'var(--text-dim)' : 'var(--cyan)', boxShadow: allQuiet ? 'none' : '0 0 10px var(--cyan)', animation: allQuiet ? undefined : 'pulse-glow 2.4s ease-in-out infinite' }} />
        いまのASCENT
      </span>

      {allQuiet ? (
        <button type="button" style={{ ...itemStyle, color: 'var(--text-soft)' }} onClick={() => router.push('/custom/board')}>
          いまは静かです — 交流戦ボードで今週の予定を立てよう →
        </button>
      ) : (
        <>
          {stats.queue_waiting > 0 && (
            <>
              {divider}
              <button type="button" style={itemStyle} onClick={() => router.push('/match')}>
                ランクマ待機 <strong className="mono" style={{ color: 'var(--cyan)' }}>{stats.queue_waiting}人</strong>
                {stats.queue_waiting < 8
                  ? <span style={{ color: 'var(--amber)', fontWeight: 700 }}>あと{8 - stats.queue_waiting}人で成立!</span>
                  : <span style={{ color: 'var(--success)', fontWeight: 700 }}>成立間近!</span>}
              </button>
            </>
          )}
          {stats.eights_lobbies > 0 && (
            <>
              {divider}
              <button type="button" style={itemStyle} onClick={() => router.push('/custom')}>
                8sロビー <strong className="mono" style={{ color: 'var(--violet)' }}>{stats.eights_lobbies}件</strong>
                <span className="muted">({stats.eights_players}/{stats.eights_lobbies * 8}人)</span>
              </button>
            </>
          )}
          {stats.scrims_today > 0 && (
            <>
              {divider}
              <button type="button" style={itemStyle} onClick={() => router.push('/custom/board')}>
                今日の交流戦 <strong className="mono" style={{ color: 'var(--magenta)' }}>{stats.scrims_today}件</strong>
              </button>
            </>
          )}
          {stats.mixed_rooms_open > 0 && (
            <>
              {divider}
              <button type="button" style={itemStyle} onClick={() => router.push('/custom/board')}>
                混成ルーム募集中 <strong className="mono" style={{ color: '#c9b8ff' }}>{stats.mixed_rooms_open}件</strong>
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
