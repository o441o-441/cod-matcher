'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { playMatchFound } from '@/lib/sounds'

type ActiveMatch = { id: string; status: string }

export default function QueueStatusBar() {
  const router = useRouter()
  const pathname = usePathname()
  const [waiting, setWaiting] = useState(false)
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null)
  const [waitSec, setWaitSec] = useState(0)
  const waitStartRef = useRef<number | null>(null)
  const redirectedRef = useRef<string | null>(null)
  const cachedUidRef = useRef<string | null>(null)

  const checkQueue = useCallback(async () => {
    let uid = cachedUidRef.current
    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession()
      uid = session?.user?.id ?? null
      cachedUidRef.current = uid
    }
    if (!uid) { setWaiting(false); setActiveMatch(null); return }

    // 1. 自分が参加中のアクティブマッチを検索
    const { data: myMtm } = await supabase
      .from('match_team_members')
      .select('match_team_id')
      .eq('user_id', uid)

    const mtIds = (myMtm ?? []).map((r: { match_team_id: string }) => r.match_team_id)

    if (mtIds.length > 0) {
      const { data: myTeams } = await supabase
        .from('match_teams')
        .select('match_id')
        .in('id', mtIds)

      const matchIds = [...new Set((myTeams ?? []).map((r: { match_id: string }) => r.match_id))]

      if (matchIds.length > 0) {
        const { data: activeMatches } = await supabase
          .from('matches')
          .select('id, status')
          .in('id', matchIds)
          .in('status', ['banpick', 'ready', 'in_progress', 'report_pending'])
          .order('matched_at', { ascending: false })
          .limit(1)

        if (activeMatches && activeMatches.length > 0) {
          const match = activeMatches[0] as ActiveMatch
          setWaiting(false)
          waitStartRef.current = null
          setActiveMatch(match)
          return
        }
      }
    }

    setActiveMatch(null)

    // 2. waitingキューがあるか
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

  // Realtime + 10秒フォールバック
  useEffect(() => {
    void checkQueue()

    const channel = supabase
      .channel('queue-status-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, () => void checkQueue())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void checkQueue())
      .subscribe()

    const fallback = setInterval(() => void checkQueue(), 10000)
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

  // アクティブマッチ検知 → 自動遷移
  useEffect(() => {
    if (!activeMatch) return

    // ステータスに応じた遷移先を決定
    let targetPath: string
    switch (activeMatch.status) {
      case 'banpick':
        targetPath = `/match/${activeMatch.id}/banpick`
        break
      case 'ready':
        targetPath = `/match/${activeMatch.id}/confirm`
        break
      case 'report_pending':
      case 'in_progress':
        targetPath = `/match/${activeMatch.id}/report`
        break
      default:
        return
    }

    // 既にそのページにいる場合はスキップ
    if (pathname.startsWith(targetPath)) return
    // 同じマッチの別ページにいる場合もスキップ（banpick→confirm等の遷移は各ページ側で処理）
    if (pathname.includes(`/match/${activeMatch.id}/`)) return

    // 同じマッチに対して既にリダイレクト済みならスキップ
    if (redirectedRef.current === activeMatch.id) return
    redirectedRef.current = activeMatch.id

    playMatchFound()
    router.push(targetPath)
  }, [activeMatch, pathname, router])

  // マッチ画面自体にいる場合はバーを表示しない
  if (pathname === '/match') return null
  // マッチ関連ページにいる場合もバーを表示しない
  if (pathname.startsWith('/match/') && activeMatch && pathname.includes(activeMatch.id)) return null

  // アクティブマッチがある場合はバナー表示
  if (activeMatch) {
    const statusLabel = activeMatch.status === 'banpick' ? 'バンピック中'
      : activeMatch.status === 'ready' ? '試合準備中'
      : activeMatch.status === 'report_pending' ? '結果報告待ち'
      : '試合進行中'

    let targetPath = `/match/${activeMatch.id}/banpick`
    if (activeMatch.status === 'ready') targetPath = `/match/${activeMatch.id}/confirm`
    if (activeMatch.status === 'report_pending' || activeMatch.status === 'in_progress') targetPath = `/match/${activeMatch.id}/report`

    return (
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9000,
          background: 'linear-gradient(135deg, rgba(0,0,0,0.95), rgba(20,20,40,0.95))',
          borderTop: '2px solid var(--magenta)',
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
              background: 'var(--magenta)',
              boxShadow: '0 0 10px var(--magenta)',
              animation: 'pulse-glow 1.5s ease-in-out infinite',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            {statusLabel}
          </span>
        </div>
        <button
          className="btn-primary btn-sm"
          onClick={() => router.push(targetPath)}
          style={{ fontSize: 12 }}
        >
          試合画面へ戻る
        </button>
      </div>
    )
  }

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
