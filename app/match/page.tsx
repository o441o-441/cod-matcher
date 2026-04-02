'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  created_at: string
}

type AtomicMatchResult = {
  match_id: string
  opponent_team_id: string
}

export default function MatchPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [status, setStatus] = useState('初期化中...')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [myTeamName, setMyTeamName] = useState('')
  const [myTeamRating, setMyTeamRating] = useState(1500)
  const [matchedTeamName, setMatchedTeamName] = useState('')
  const [matchedTeamId, setMatchedTeamId] = useState('')
  const [createdMatchId, setCreatedMatchId] = useState('')
  const [isWaiting, setIsWaiting] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [queueCreatedAt, setQueueCreatedAt] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [pageError, setPageError] = useState('')

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const matchingRef = useRef(false)
  const cancellingRef = useRef(false)
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const matchedOnceRef = useRef(false)
  const originalTitleRef = useRef('COD マッチングサイト')
  const accessTokenRef = useRef<string | null>(null)
  const notifiedMatchIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    originalTitleRef.current = document.title || 'COD マッチングサイト'
    return () => {
      document.title = originalTitleRef.current
    }
  }, [])

  useEffect(() => {
    if (status === 'マッチ成立！') {
      document.title = '〖マッチ成立！〗COD マッチングサイト'

      if (!matchedOnceRef.current) {
        matchedOnceRef.current = true

        try {
          const audioContext = new window.AudioContext()
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()

          oscillator.type = 'sine'
          oscillator.frequency.setValueAtTime(880, audioContext.currentTime)
          oscillator.connect(gainNode)
          gainNode.connect(audioContext.destination)
          gainNode.gain.setValueAtTime(0.05, audioContext.currentTime)

          oscillator.start()
          oscillator.stop(audioContext.currentTime + 0.18)
        } catch (error) {
          console.error('notification sound error:', error)
        }

        showToast('マッチ成立！ 対戦相手が決まりました。', 'success')
      }
    } else if (isWaiting) {
      document.title = 'マッチング中... | COD マッチングサイト'
    } else {
      document.title = originalTitleRef.current
    }
  }, [status, isWaiting, showToast])

  const stopRealtimeAndTimers = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    if (clockRef.current) {
      clearInterval(clockRef.current)
      clockRef.current = null
    }

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }

    if (realtimeRef.current) {
      void supabase.removeChannel(realtimeRef.current)
      realtimeRef.current = null
    }
  }

  const pingHeartbeat = async (targetTeamId: string) => {
    if (cancellingRef.current) return

    const { error } = await supabase
      .from('match_queue')
      .update({
        last_seen_at: new Date().toISOString(),
        status: 'waiting',
      })
      .eq('team_id', targetTeamId)

    if (error) {
      console.error('heartbeat update error:', error)
    }
  }

  const deleteQueueByTeamId = async (targetTeamId: string) => {
    return await supabase
      .from('match_queue')
      .delete()
      .eq('team_id', targetTeamId)
      .select('team_id')
  }

  const leaveQueueByEdgeFunctionKeepalive = async (targetTeamId: string) => {
    const accessToken = accessTokenRef.current
    if (!accessToken) return

    const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/leave-queue`

    try {
      await fetch(functionUrl, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ teamId: targetTeamId }),
      })
    } catch (error) {
      console.error('leaveQueueByEdgeFunctionKeepalive error:', error)
    }
  }

  const notifyDiscordMatchCreated = async (matchId: string) => {
    if (!matchId) return
    if (notifiedMatchIdsRef.current.has(matchId)) return

    const accessToken = accessTokenRef.current
    if (!accessToken) {
      console.warn('notifyDiscordMatchCreated skipped: no access token')
      return
    }

    const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-match-created`

    try {
      notifiedMatchIdsRef.current.add(matchId)

      const res = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          matchId,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        console.error('notify-match-created failed:', text)
        notifiedMatchIdsRef.current.delete(matchId)
        return
      }

      const result = await res.json().catch(() => null)
      console.log('notify-match-created success:', result)
    } catch (error) {
      console.error('notifyDiscordMatchCreated error:', error)
      notifiedMatchIdsRef.current.delete(matchId)
    }
  }

  useEffect(() => {
    const init = async () => {
      cancellingRef.current = false
      matchedOnceRef.current = false

      setStatus('チーム取得中...')
      setPageError('')

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      accessTokenRef.current = session.access_token

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', session.user.id)
        .single()

      if (userError || !user) {
        console.error('userError:', userError)
        setPageError('ユーザー情報の取得に失敗しました')
        router.push('/mypage')
        return
      }

      const { data: membership, error: membershipError } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id)
        .single()

      if (membershipError || !membership) {
        console.error('membershipError:', membershipError)
        setPageError('チームに所属していません')
        router.push('/mypage')
        return
      }

      setTeamId(membership.team_id)

      const { data: myTeam, error: myTeamError } = await supabase
        .from('teams')
        .select('id, name, rating')
        .eq('id', membership.team_id)
        .single()

      if (myTeamError || !myTeam) {
        console.error('myTeamError:', myTeamError)
        setPageError('自チーム情報の取得に失敗しました')
        router.push('/mypage')
        return
      }

      setMyTeamName(myTeam.name)
      setMyTeamRating(myTeam.rating)

      const { data: existingQueues, error: queueError } = await supabase
        .from('match_queue')
        .select('*')
        .eq('team_id', membership.team_id)
        .order('created_at', { ascending: true })

      if (queueError) {
        console.error('queueError:', queueError)
        setPageError('待機情報の取得に失敗しました')
      }

      const existingQueue =
        existingQueues && existingQueues.length > 0 ? existingQueues[0] : null

      if (existingQueues && existingQueues.length > 1) {
        const duplicateIds = existingQueues.slice(1).map((q) => q.id)
        const { error: cleanupError } = await supabase
          .from('match_queue')
          .delete()
          .in('id', duplicateIds)

        if (cleanupError) {
          console.error('cleanupError:', cleanupError)
        }
      }

      if (!existingQueue) {
        const { data: upsertedQueue, error: insertQueueError } = await supabase
          .from('match_queue')
          .upsert(
            {
              team_id: membership.team_id,
              status: 'waiting',
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: 'team_id' }
          )
          .select()
          .single()

        if (insertQueueError || !upsertedQueue) {
          console.error('insertQueueError:', insertQueueError)
          setPageError('待機開始に失敗しました')
          showToast('待機開始に失敗しました', 'error')
          router.push('/mypage')
          return
        }

        setQueueCreatedAt(upsertedQueue.created_at)
      } else {
        await pingHeartbeat(membership.team_id)
        setQueueCreatedAt(existingQueue.created_at)
      }

      setIsWaiting(true)
      setStatus('マッチング中...')
    }

    void init()

    return () => {
      stopRealtimeAndTimers()
    }
  }, [router, showToast])

  useEffect(() => {
    if (!isWaiting || !queueCreatedAt) {
      if (clockRef.current) {
        clearInterval(clockRef.current)
        clockRef.current = null
      }
      return
    }

    setNowMs(Date.now())

    clockRef.current = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      if (clockRef.current) {
        clearInterval(clockRef.current)
        clockRef.current = null
      }
    }
  }, [isWaiting, queueCreatedAt])

  useEffect(() => {
    if (!isWaiting || !teamId || cancellingRef.current) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      return
    }

    void pingHeartbeat(teamId)

    heartbeatRef.current = setInterval(() => {
      void pingHeartbeat(teamId)
    }, 1000)

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
    }
  }, [isWaiting, teamId])

  useEffect(() => {
    const handlePageHide = () => {
      if (!teamId || !isWaiting || cancellingRef.current) return
      void leaveQueueByEdgeFunctionKeepalive(teamId)
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [teamId, isWaiting])

  const getRecentOpponentTeamIds = async (
    myTeamIdValue: string
  ): Promise<string[]> => {
    const { data: matches, error } = await supabase
      .from('matches')
      .select('*')
      .or(`team1_id.eq.${myTeamIdValue},team2_id.eq.${myTeamIdValue}`)
      .order('created_at', { ascending: false })
      .limit(2)

    if (error) {
      console.error('getRecentOpponentTeamIds error:', error)
      return []
    }

    if (!matches || matches.length === 0) return []

    const opponentIds: string[] = []

    for (const match of matches as MatchRow[]) {
      if (match.team1_id === myTeamIdValue) {
        opponentIds.push(match.team2_id)
      } else {
        opponentIds.push(match.team1_id)
      }
    }

    return opponentIds
  }

  const getWaitedSeconds = () => {
    if (!queueCreatedAt) return 0
    return Math.floor((nowMs - new Date(queueCreatedAt).getTime()) / 1000)
  }

  const getAllowedRatingDiff = () => {
    const waitedSec = getWaitedSeconds()

    if (waitedSec < 30) return 100
    if (waitedSec < 60) return 200
    if (waitedSec < 90) return 300
    return Infinity
  }

  const completeMatchedState = async (
    match: MatchRow,
    myTeamIdValue: string,
    myTeamNameArg: string
  ) => {
    if (cancellingRef.current) return

    const opponentTeamId =
      match.team1_id === myTeamIdValue ? match.team2_id : match.team1_id

    const { data: opponentTeam, error: opponentTeamError } = await supabase
      .from('teams')
      .select('id, name')
      .eq('id', opponentTeamId)
      .single()

    if (cancellingRef.current) return

    if (opponentTeamError || !opponentTeam) {
      console.error('opponentTeamError:', opponentTeamError)
      setStatus('相手チーム情報の取得失敗')
      setPageError('相手チーム情報の取得に失敗しました')
      return
    }

    stopRealtimeAndTimers()
    setIsWaiting(false)
    setMyTeamName(myTeamNameArg)
    setMatchedTeamName(opponentTeam.name)
    setMatchedTeamId(opponentTeam.id)
    setCreatedMatchId(match.id)
    setStatus('マッチ成立！')
    setPageError('')

    void notifyDiscordMatchCreated(match.id)
  }

  const checkExistingMatchedGame = async (
    myTeamIdValue: string,
    myTeamNameArg: string,
    queueStartedAt: string
  ): Promise<boolean> => {
    if (cancellingRef.current) return false

    const { data: recentMatches, error } = await supabase
      .from('matches')
      .select('*')
      .or(`team1_id.eq.${myTeamIdValue},team2_id.eq.${myTeamIdValue}`)
      .gte('created_at', queueStartedAt)
      .order('created_at', { ascending: false })
      .limit(1)

    if (cancellingRef.current) return false

    if (error) {
      console.error('checkExistingMatchedGame error:', error)
      return false
    }

    if (!recentMatches || recentMatches.length === 0) return false

    const latestMatch = recentMatches[0] as MatchRow
    await completeMatchedState(latestMatch, myTeamIdValue, myTeamNameArg)
    return !cancellingRef.current
  }

  const tryMatch = async (
    myTeamIdValue: string,
    myTeamNameArg: string,
    _myRating: number
  ) => {
    if (!isWaiting || cancellingRef.current) return

    const recentOpponentIds = await getRecentOpponentTeamIds(myTeamIdValue)
    if (cancellingRef.current) return

    const allowedDiff = getAllowedRatingDiff()
    const rpcAllowedDiff = allowedDiff === Infinity ? null : allowedDiff

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'try_create_match_atomic',
      {
        p_my_team_id: myTeamIdValue,
        p_allowed_diff: rpcAllowedDiff,
        p_excluded_team_ids: recentOpponentIds,
      }
    )

    if (cancellingRef.current) return

    if (rpcError) {
      console.error('try_create_match_atomic error:', rpcError)
      setStatus('マッチング失敗')
      setPageError('マッチング処理に失敗しました')
      return
    }

    const rows = (rpcResult || []) as AtomicMatchResult[]

    if (rows.length === 0) {
      if (cancellingRef.current) return

      if (allowedDiff === Infinity) {
        setStatus('相手待ち...')
      } else {
        setStatus(`近いレートの相手を探しています...（許容差 ±${allowedDiff}）`)
      }
      return
    }

    const created = rows[0]
    const createdMatch: MatchRow = {
      id: created.match_id,
      team1_id: myTeamIdValue,
      team2_id: created.opponent_team_id,
      created_at: new Date().toISOString(),
    }

    await completeMatchedState(createdMatch, myTeamIdValue, myTeamNameArg)
  }

  useEffect(() => {
    if (!isWaiting || !teamId || !myTeamName || !queueCreatedAt || cancellingRef.current) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      return
    }

    const runMatchCycle = async () => {
      if (matchingRef.current || cancellingRef.current) return

      matchingRef.current = true

      try {
        const foundExisting = await checkExistingMatchedGame(
          teamId,
          myTeamName,
          queueCreatedAt
        )

        if (foundExisting || cancellingRef.current) return

        await tryMatch(teamId, myTeamName, myTeamRating)
      } finally {
        matchingRef.current = false
      }
    }

    void runMatchCycle()

    pollingRef.current = setInterval(() => {
      void runMatchCycle()
    }, 1500)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [isWaiting, teamId, myTeamName, myTeamRating, queueCreatedAt])

  useEffect(() => {
    if (!isWaiting || !teamId || !myTeamName || !queueCreatedAt || cancellingRef.current) {
      if (realtimeRef.current) {
        void supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
      return
    }

    const channel = supabase
      .channel(`match-realtime-${teamId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'matches',
        },
        async (payload) => {
          if (cancellingRef.current) return

          const newMatch = payload.new as MatchRow

          if (newMatch.team1_id === teamId || newMatch.team2_id === teamId) {
            await completeMatchedState(newMatch, teamId, myTeamName)
          }
        }
      )
      .subscribe((realtimeStatus) => {
        console.log('realtime status:', realtimeStatus)
      })

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        void supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [isWaiting, teamId, myTeamName, queueCreatedAt])

  const handleCancelWaiting = async () => {
    if (!teamId || cancelLoading) return

    cancellingRef.current = true
    setCancelLoading(true)

    stopRealtimeAndTimers()

    const { data, error } = await deleteQueueByTeamId(teamId)

    if (error) {
      console.error('cancel waiting error:', error)
      cancellingRef.current = false
      showToast('待機解除に失敗しました', 'error')
      setCancelLoading(false)
      return
    }

    if (!data || data.length === 0) {
      console.warn('cancel waiting: queue row was not found')
    }

    setIsWaiting(false)
    setStatus('待機を解除しました')
    setPageError('')
    showToast('マッチング待機を終了しました。', 'info')
    setCancelLoading(false)
  }

  const handleBackToMyPage = async () => {
    if (isWaiting && teamId) {
      cancellingRef.current = true
      stopRealtimeAndTimers()

      const { error } = await deleteQueueByTeamId(teamId)

      if (error) {
        console.error('back cancel waiting error:', error)
        cancellingRef.current = false
        showToast('待機解除に失敗しました', 'error')
        return
      }

      setIsWaiting(false)
      setStatus('待機を解除しました')
      showToast('待機解除してマイページに戻ります', 'info')
    }

    router.push('/mypage')
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ランダムマッチ</h1>
          <p className="muted">近いレートの相手を自動で探します</p>
        </div>

        <div className="row">
          <button onClick={handleBackToMyPage}>マイページへ戻る</button>
        </div>
      </div>

      {pageError && (
        <div className="section">
          <div className="card">
            <p className="danger">
              <strong>エラー:</strong> {pageError}
            </p>
          </div>
        </div>
      )}

      <div className="section grid grid-2">
        <div className="card-strong">
          <h2>現在の状態</h2>
          <div className="stack">
            <p>
              <strong>ステータス:</strong> {status}
            </p>
            <p>
              <strong>自チーム名:</strong> {myTeamName || '取得中'}
            </p>
            <p>
              <strong>自チームレート:</strong> {myTeamRating}
            </p>
            <p>
              <strong>チームID:</strong> {teamId || '取得中'}
            </p>
          </div>
        </div>

        <div className="card-strong">
          <h2>マッチ条件</h2>
          <div className="stack">
            <p>
              <strong>待機時間:</strong> {isWaiting ? `${getWaitedSeconds()}秒` : '-'}
            </p>
            <p>
              <strong>現在の許容差:</strong>{' '}
              {getAllowedRatingDiff() === Infinity
                ? '制限なし'
                : `±${getAllowedRatingDiff()}`}
            </p>
            <p className="muted">直近2試合の相手は自動で除外されます</p>
            <p className="muted">
              3秒以上 heartbeat が止まった待機は候補外になります
            </p>
          </div>
        </div>
      </div>

      {isWaiting && (
        <div className="section">
          <div className="card">
            <h2>待機中</h2>
            <p>Realtime と短い heartbeat を併用して相手を探しています。</p>
            <div className="row" style={{ marginTop: '12px' }}>
              <button onClick={handleCancelWaiting} disabled={cancelLoading}>
                {cancelLoading ? '解除中...' : '待機解除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'マッチ成立！' && (
        <div className="section">
          <div className="card-strong">
            <h2>対戦相手が決まりました</h2>

            <div className="grid grid-2">
              <div className="card">
                <p className="muted">自チーム</p>
                <h3>{myTeamName}</h3>
              </div>

              <div className="card">
                <p className="muted">相手チーム</p>
                <h3>{matchedTeamName}</h3>
              </div>

              <div className="card">
                <p className="muted">相手チームID</p>
                <h3>{matchedTeamId}</h3>
              </div>

              <div className="card">
                <p className="muted">マッチID</p>
                <h3>{createdMatchId}</h3>
              </div>
            </div>

            <div className="section row">
              <button onClick={() => router.push(`/match/${createdMatchId}`)}>
                試合詳細へ
              </button>
              <button onClick={handleBackToMyPage}>マイページへ戻る</button>
            </div>
          </div>
        </div>
      )}

      {status === '待機を解除しました' && (
        <div className="section">
          <div className="card">
            <h2>待機解除済み</h2>
            <p>マッチング待機を終了しました。</p>
            <div className="section row">
              <button onClick={handleBackToMyPage}>マイページへ戻る</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}