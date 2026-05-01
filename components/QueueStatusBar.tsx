'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { playMatchFound } from '@/lib/sounds'

export default function QueueStatusBar() {
  const router = useRouter()
  const pathname = usePathname()
  const [waiting, setWaiting] = useState(false)
  const [matchFoundId, setMatchFoundId] = useState<string | null>(null)
  const [waitSec, setWaitSec] = useState(0)
  const waitStartRef = useRef<number | null>(null)
  const redirectedRef = useRef(false)
  const cachedUidRef = useRef<string | null>(null)

  const checkQueue = useCallback(async () => {
    let uid = cachedUidRef.current
    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession()
      uid = session?.user?.id ?? null
      cachedUidRef.current = uid
    }
    if (!uid) { setWaiting(false); return }

    // 1. アクティブマッチがあるか（match_team_membersから直接検索）
    const { data: activeMatchData } = await supabase
      .from('match_team_members')
      .select('match_teams!inner(match_id, matches!inner(id, status))')
      .eq('user_id', uid)

    type ActiveRow = { match_teams: { match_id: string; matches: { id: string; status: string }[] }[] }
    const activeRows = (activeMatchData ?? []) as unknown as ActiveRow[]
    for (const row of activeRows) {
      const teams = Array.isArray(row.match_teams) ? row.match_teams : [row.match_teams]
      for (const team of teams) {
        const matches = Array.isArray(team.matches) ? team.matches : [team.matches]
        const bm = matches.find((m: { status: string }) => m?.status === 'banpick')
        if (bm) {
          setWaiting(false)
          waitStartRef.current = null
          setMatchFoundId(bm.id)
          return
        }
      }
    }

    // 2. waitingキューがあるか（パーティ経由）
    const { data: pm } = await supabase
      .from('party_members')
      .select('party_id')
      .eq('user_id', uid)

    const partyIds = [...new Set((pm ?? []).map((r: { party_id: string }) => r.party_id))]
    if (partyIds.length === 0) { setWaiting(false); return }

    const { data: waitingEntries } = await supabase
      .from('queue_entries')
      .select('id,created_at')
      .in('party_id', partyIds)
      .eq('status', 'waiting')
      .limit(1)

    if (waitingEntries && waitingEntries.length > 0) {
      setWaiting(true)
      if (!waitStartRef.current) {
        waitStartRef.current = new Date(waitingEntries[0].created_at).getTime()
      }
      return
    }

    setWaiting(false)
    waitStartRef.current = null
  }, [])

  // Realtime + 30秒フォールバック
  useEffect(() => {
    void checkQueue()

    const channel = supabase
      .channel('queue-status-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, () => void checkQueue())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void checkQueue())
      .subscribe()

    const fallback = setInterval(() => void checkQueue(), 30000)
    return () => {
      clearInterval(fallback)
      void supabase.removeChannel(channel)
    }
  }, [checkQueue])

  // カウントアップ
  useEffect(() => {
    if (!waiting) { setWaitSec(0); return }
    const tick = () => {
      if (waitStartRef.current) {
        setWaitSec(Math.floor((Date.now() - waitStartRef.current) / 1000))
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [waiting])

  // マッチ成立 → 自動遷移
  useEffect(() => {
    if (!matchFoundId) return
    if (redirectedRef.current) return
    // 既にbanpickページにいる場合はスキップ
    if (pathname.includes(`/match/${matchFoundId}/banpick`)) return
    redirectedRef.current = true
    playMatchFound()
    router.push(`/match/${matchFoundId}/banpick`)
  }, [matchFoundId, pathname, router])

  // マッチ画面自体にいる場合はバーを表示しない（match/page.tsx側で独自表示している）
  if (pathname === '/match') return null

  if (!waiting) return null

  const min = Math.floor(waitSec / 60)
  const sec = String(waitSec % 60).padStart(2, '0')

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9000,
        background: 'linear-gradient(135deg, rgba(0,0,0,0.95), rgba(20,20,40,0.95))',
        borderTop: '2px solid var(--cyan)',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--cyan)',
            boxShadow: '0 0 10px var(--cyan)',
            animation: 'pulse-glow 1.5s ease-in-out infinite',
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          対戦相手を検索中...
        </span>
        <span className="mono" style={{ fontSize: 16, color: 'var(--cyan)', fontWeight: 700 }}>
          {min}:{sec}
        </span>
      </div>
      <button
        className="btn-ghost btn-sm"
        onClick={() => router.push('/match')}
        style={{ fontSize: 12 }}
      >
        マッチ画面へ
      </button>
    </div>
  )
}
