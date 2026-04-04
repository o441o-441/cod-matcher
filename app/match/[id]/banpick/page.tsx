'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  winner_team_id: string | null
  loser_team_id: string | null
  status: string
  approval_status?: string
}

type TeamRow = {
  id: string
  name: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

type BanpickSessionRow = {
  id: string
  match_id: string
  team_a_id: string
  team_b_id: string
  phase: 'phase1_hp' | 'phase2_snd' | 'phase3_ovl' | 'phase4_done'
  step_no: number
  status: 'in_progress' | 'completed'
  hp_ban_a: string | null
  hp_ban_b: string | null
  hp_map: string | null
  hp_side: string | null
  snd_ban_b: string | null
  snd_ban_a: string | null
  snd_map: string | null
  snd_side: string | null
  ovl_ban_a: string | null
  ovl_map: string | null
  ovl_side: string | null
  last_action_at: string
  deadline_at: string
  timeout_loser_team_id: string | null
  timeout_winner_team_id: string | null
  created_at: string
  updated_at: string
}

type BanpickActionRow = {
  id: string
  session_id: string
  match_id: string
  phase: string
  action_type: 'ban' | 'pick_map' | 'pick_side'
  acting_team_id: string
  game_mode: 'HARDPOINT' | 'SEARCH_AND_DESTROY' | 'OVERLOAD'
  target: string
  step_no: number
  created_at: string
}

const HP_POOL = ['エクスポージャー', 'コロッサス', 'スカー', 'デン', 'ブラックハート']
const SND_POOL = ['エクスポージャー', 'コロッサス', 'スカー', 'デン', 'レイド']
const OVL_POOL = ['エクスポージャー', 'スカー', 'デン']
const SIDE_OPTIONS = ['JSOC', 'ギルド'] as const

export default function MatchBanpickPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()

  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const timeoutIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutResolvingRef = useRef(false)
  const banpickPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef = useRef(false)
  const creatingSessionRef = useRef(false)

  const matchId =
    typeof params.id === 'string'
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : ''

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [team1, setTeam1] = useState<TeamRow | null>(null)
  const [team2, setTeam2] = useState<TeamRow | null>(null)

  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)

  const [banpickSession, setBanpickSession] = useState<BanpickSessionRow | null>(null)
  const [banpickActions, setBanpickActions] = useState<BanpickActionRow[]>([])
  const [banpickLoading, setBanpickLoading] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())

  const getTeamName = (id: string | null | undefined) => {
    if (!id) return '不明'
    if (team1?.id === id) return team1.name
    if (team2?.id === id) return team2.name
    return '不明'
  }

  const getModeLabel = (mode: string) => {
    if (mode === 'hardpoint' || mode === 'HARDPOINT') return 'Hardpoint'
    if (mode === 'snd' || mode === 'SEARCH_AND_DESTROY') return 'S&D'
    if (mode === 'overload' || mode === 'OVERLOAD') return 'Overload'
    return mode
  }

  const formatRemainingTime = (seconds: number) => {
    const min = Math.floor(seconds / 60)
    const sec = seconds % 60
    return `${min}:${String(sec).padStart(2, '0')}`
  }

  const ensureBanpickSession = async (targetMatch: MatchRow) => {
    if (creatingSessionRef.current) return

    creatingSessionRef.current = true
    try {
      const now = new Date()
      const deadline = new Date(now.getTime() + 5 * 60 * 1000)

      const { error } = await supabase.from('banpick_sessions').insert({
        match_id: targetMatch.id,
        team_a_id: targetMatch.team1_id,
        team_b_id: targetMatch.team2_id,
        phase: 'phase1_hp',
        step_no: 1,
        status: 'in_progress',
        last_action_at: now.toISOString(),
        deadline_at: deadline.toISOString(),
      })

      if (error) {
        // すでに別処理で作られていた場合もあるので、duplicate系は握りつぶす
        const msg = String(error.message || '')
        if (
          !msg.includes('duplicate') &&
          !msg.includes('unique') &&
          !msg.includes('23505')
        ) {
          console.error('[ensureBanpickSession] insert error:', error)
          showToast('バンピック開始準備に失敗しました', 'error')
        }
      }
    } finally {
      creatingSessionRef.current = false
    }
  }

  const fetchBanpick = async (targetMatchId: string, targetMatch?: MatchRow | null) => {
    const { data: sessionData, error: sessionError } = await supabase
      .from('banpick_sessions')
      .select('*')
      .eq('match_id', targetMatchId)
      .maybeSingle()

    if (sessionError) {
      console.error('[fetchBanpick] session error:', sessionError)
      setBanpickSession(null)
      setBanpickActions([])
      return
    }

    if (!sessionData && targetMatch) {
      await ensureBanpickSession(targetMatch)

      const { data: retrySessionData, error: retrySessionError } = await supabase
        .from('banpick_sessions')
        .select('*')
        .eq('match_id', targetMatchId)
        .maybeSingle()

      if (retrySessionError) {
        console.error('[fetchBanpick] retry session error:', retrySessionError)
        setBanpickSession(null)
        setBanpickActions([])
        return
      }

      setBanpickSession((retrySessionData || null) as BanpickSessionRow | null)

      if (!retrySessionData) {
        setBanpickActions([])
        return
      }

      const { data: retryActionData, error: retryActionError } = await supabase
        .from('banpick_actions')
        .select('*')
        .eq('match_id', targetMatchId)
        .order('created_at', { ascending: true })

      if (retryActionError) {
        console.error('[fetchBanpick] retry action error:', retryActionError)
        setBanpickActions([])
        return
      }

      setBanpickActions((retryActionData || []) as BanpickActionRow[])
      return
    }

    setBanpickSession((sessionData || null) as BanpickSessionRow | null)

    if (!sessionData) {
      setBanpickActions([])
      return
    }

    const { data: actionData, error: actionError } = await supabase
      .from('banpick_actions')
      .select('*')
      .eq('match_id', targetMatchId)
      .order('created_at', { ascending: true })

    if (actionError) {
      console.error('[fetchBanpick] action error:', actionError)
      setBanpickActions([])
      return
    }

    setBanpickActions((actionData || []) as BanpickActionRow[])
  }

  const fetchData = async () => {
    if (!matchId || fetchingRef.current) return

    fetchingRef.current = true
    try {
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle()

      if (matchError || !matchData) {
        console.error('[fetchData] match error:', matchError)
        setMatch(null)
        setLoading(false)
        return
      }

      const currentMatch = matchData as MatchRow
      setMatch(currentMatch)

      const [{ data: t1 }, { data: t2 }] = await Promise.all([
        supabase.from('teams').select('*').eq('id', currentMatch.team1_id).single(),
        supabase.from('teams').select('*').eq('id', currentMatch.team2_id).single(),
      ])

      setTeam1((t1 || null) as TeamRow | null)
      setTeam2((t2 || null) as TeamRow | null)

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.user) {
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', session.user.id)
          .single()

        if (user) {
          setMyUserId(user.id)

          const { data: member } = await supabase
            .from('team_members')
            .select('team_id, role')
            .eq('user_id', user.id)
            .maybeSingle()

          if (member) {
            setMyTeamId(member.team_id)
            setMyRole(member.role)
          } else {
            setMyTeamId(null)
            setMyRole(null)
          }
        }
      } else {
        setMyUserId(null)
        setMyTeamId(null)
        setMyRole(null)
      }

      await fetchBanpick(matchId, currentMatch)
    } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [matchId])

  useEffect(() => {
    clockIntervalRef.current = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current)
        clockIntervalRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!matchId) return

    const channel = supabase
      .channel(`match-banpick-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        async () => {
          await fetchData()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_sessions' },
        async (payload) => {
          const row = (payload.new || payload.old) as { match_id?: string; status?: string } | null
          if (row?.match_id !== matchId) return

          await fetchBanpick(matchId, match)

          if (row?.status === 'completed') {
            await fetchData()
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_actions' },
        async (payload) => {
          const row = (payload.new || payload.old) as { match_id?: string } | null
          if (row?.match_id !== matchId) return
          await fetchBanpick(matchId, match)
        }
      )
      .subscribe()

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [matchId, match])

  useEffect(() => {
    if (banpickPollingRef.current) {
      clearInterval(banpickPollingRef.current)
      banpickPollingRef.current = null
    }

    if (!matchId || banpickSession?.status !== 'in_progress') return

    banpickPollingRef.current = setInterval(() => {
      void fetchBanpick(matchId, match)
    }, 15000)

    return () => {
      if (banpickPollingRef.current) {
        clearInterval(banpickPollingRef.current)
        banpickPollingRef.current = null
      }
    }
  }, [matchId, banpickSession?.status, match])

  const resolveBanpickTimeout = async () => {
    if (!matchId || timeoutResolvingRef.current) return

    timeoutResolvingRef.current = true

    try {
      const { data, error } = await supabase.rpc('resolve_banpick_timeout', {
        p_match_id: matchId,
      })

      if (error) {
        console.error('[timeout] resolve error:', error)
        return
      }

      const result = data as { timed_out?: boolean } | null

      if (result?.timed_out) {
        showToast('5分間操作がなかったためタイムアウト決着になりました', 'info')
        await fetchData()
      }
    } finally {
      timeoutResolvingRef.current = false
    }
  }

  useEffect(() => {
    if (timeoutIntervalRef.current) {
      clearInterval(timeoutIntervalRef.current)
      timeoutIntervalRef.current = null
    }

    if (!matchId || !banpickSession || banpickSession.status !== 'in_progress') return

    void resolveBanpickTimeout()

    timeoutIntervalRef.current = setInterval(() => {
      void resolveBanpickTimeout()
    }, 10000)

    return () => {
      if (timeoutIntervalRef.current) {
        clearInterval(timeoutIntervalRef.current)
        timeoutIntervalRef.current = null
      }
    }
  }, [matchId, banpickSession?.status, banpickSession?.deadline_at])

  const remainingSeconds = useMemo(() => {
    if (!banpickSession?.deadline_at || banpickSession.status !== 'in_progress') return 0
    const diff = new Date(banpickSession.deadline_at).getTime() - nowMs
    return Math.max(0, Math.floor(diff / 1000))
  }, [banpickSession?.deadline_at, banpickSession?.status, nowMs])

  const timerClassName = useMemo(() => {
    if (!banpickSession || banpickSession.status !== 'in_progress') return 'muted'
    if (remainingSeconds <= 10) return 'danger'
    if (remainingSeconds <= 60) return 'warning'
    return 'success'
  }, [banpickSession, remainingSeconds])

  const getCurrentBanpickStep = () => {
    if (!banpickSession) return null

    if (banpickSession.phase === 'phase1_hp') {
      if (banpickSession.step_no === 1) {
        return {
          title: 'フェーズ1 HARDPOINT',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'ban' as const,
          gameMode: 'HARDPOINT' as const,
          description: `${getTeamName(banpickSession.team_a_id)} が Hardpoint のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 2) {
        return {
          title: 'フェーズ1 HARDPOINT',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'ban' as const,
          gameMode: 'HARDPOINT' as const,
          description: `${getTeamName(banpickSession.team_b_id)} が Hardpoint のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 3) {
        return {
          title: 'フェーズ1 HARDPOINT',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'pick_map' as const,
          gameMode: 'HARDPOINT' as const,
          description: `${getTeamName(banpickSession.team_a_id)} が Game 1 の Hardpoint マップを選択してください。`,
        }
      }
      return {
        title: 'フェーズ1 HARDPOINT',
        actingTeamId: banpickSession.team_b_id,
        actingAction: 'pick_side' as const,
        gameMode: 'HARDPOINT' as const,
        description: `${getTeamName(banpickSession.team_b_id)} が Game 1 のマップサイドを選択してください。`,
      }
    }

    if (banpickSession.phase === 'phase2_snd') {
      if (banpickSession.step_no === 1) {
        return {
          title: 'フェーズ2 SEARCH & DESTROY',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'ban' as const,
          gameMode: 'SEARCH_AND_DESTROY' as const,
          description: `${getTeamName(banpickSession.team_b_id)} が S&D のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 2) {
        return {
          title: 'フェーズ2 SEARCH & DESTROY',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'ban' as const,
          gameMode: 'SEARCH_AND_DESTROY' as const,
          description: `${getTeamName(banpickSession.team_a_id)} が S&D のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 3) {
        return {
          title: 'フェーズ2 SEARCH & DESTROY',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'pick_map' as const,
          gameMode: 'SEARCH_AND_DESTROY' as const,
          description: `${getTeamName(banpickSession.team_b_id)} が Game 2 の S&D マップを選択してください。`,
        }
      }
      return {
        title: 'フェーズ2 SEARCH & DESTROY',
        actingTeamId: banpickSession.team_a_id,
        actingAction: 'pick_side' as const,
        gameMode: 'SEARCH_AND_DESTROY' as const,
        description: `${getTeamName(banpickSession.team_a_id)} が Game 2 のマップサイドを選択してください。`,
      }
    }

    if (banpickSession.phase === 'phase3_ovl') {
      if (banpickSession.step_no === 1) {
        return {
          title: 'フェーズ3 OVERLOAD',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'ban' as const,
          gameMode: 'OVERLOAD' as const,
          description: `${getTeamName(banpickSession.team_a_id)} が Overload のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 2) {
        return {
          title: 'フェーズ3 OVERLOAD',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'pick_map' as const,
          gameMode: 'OVERLOAD' as const,
          description: `${getTeamName(banpickSession.team_b_id)} が Game 3 の Overload マップを選択してください。`,
        }
      }
      return {
        title: 'フェーズ3 OVERLOAD',
        actingTeamId: banpickSession.team_a_id,
        actingAction: 'pick_side' as const,
        gameMode: 'OVERLOAD' as const,
        description: `${getTeamName(banpickSession.team_a_id)} が Game 3 のマップサイドを選択してください。`,
      }
    }

    return {
      title: 'フェーズ4 完了',
      actingTeamId: null,
      actingAction: null,
      gameMode: null,
      description: 'バンピックは完了しています。',
    }
  }

  const currentBanpickStep = getCurrentBanpickStep()

  const availableBanpickTargets = useMemo(() => {
    if (!banpickSession || !currentBanpickStep) return []

    if (currentBanpickStep.actingAction === 'pick_side') {
      return [...SIDE_OPTIONS]
    }

    let pool: string[] = []

    if (currentBanpickStep.gameMode === 'HARDPOINT') pool = [...HP_POOL]
    if (currentBanpickStep.gameMode === 'SEARCH_AND_DESTROY') pool = [...SND_POOL]
    if (currentBanpickStep.gameMode === 'OVERLOAD') pool = [...OVL_POOL]

    const banned = new Set<string>()
    const picked = new Set<string>()

    if (currentBanpickStep.gameMode === 'HARDPOINT') {
      if (banpickSession.hp_ban_a) banned.add(banpickSession.hp_ban_a)
      if (banpickSession.hp_ban_b) banned.add(banpickSession.hp_ban_b)
      if (banpickSession.hp_map) picked.add(banpickSession.hp_map)
    }

    if (currentBanpickStep.gameMode === 'SEARCH_AND_DESTROY') {
      if (banpickSession.snd_ban_b) banned.add(banpickSession.snd_ban_b)
      if (banpickSession.snd_ban_a) banned.add(banpickSession.snd_ban_a)
      if (banpickSession.snd_map) picked.add(banpickSession.snd_map)
    }

    if (currentBanpickStep.gameMode === 'OVERLOAD') {
      if (banpickSession.ovl_ban_a) banned.add(banpickSession.ovl_ban_a)
      if (banpickSession.ovl_map) picked.add(banpickSession.ovl_map)
    }

    return pool.filter((item) => !banned.has(item) && !picked.has(item))
  }, [banpickSession, currentBanpickStep])

  const canOperateBanpick =
    !!banpickSession &&
    banpickSession.status === 'in_progress' &&
    !!myUserId &&
    !!myTeamId &&
    myRole === 'owner' &&
    currentBanpickStep?.actingTeamId === myTeamId

  const handleBanpickAction = async (
    actionType: 'ban' | 'pick_map' | 'pick_side',
    target: string
  ) => {
    if (!myUserId) {
      showToast('ユーザー情報が取得できていません', 'error')
      return
    }

    setBanpickLoading(true)

    const { error } = await supabase.rpc('submit_banpick_action', {
      p_match_id: matchId,
      p_actor_user_id: myUserId,
      p_action_type: actionType,
      p_target: target,
    })

    if (error) {
      console.error('[banpick] submit error:', error)
      showToast(error.message || 'バンピックの送信に失敗しました', 'error')
      setBanpickLoading(false)
      await fetchData()
      return
    }

    showToast('バンピックを更新しました', 'success')
    await fetchBanpick(matchId, match)
    setBanpickLoading(false)
  }

  if (loading) {
    return (
      <main>
        <h1>バンピック</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  if (!match) {
    return (
      <main>
        <h1>バンピック</h1>
        <p>試合が見つかりません</p>
        <button onClick={() => router.push('/history')}>履歴へ戻る</button>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>バンピック</h1>
          <p className="muted">マップとサイドを決定します</p>
        </div>

        <div className="row">
          <button onClick={() => router.push(`/match/${matchId}/report`)}>
            結果報告へ
          </button>
        </div>
      </div>

      <div className="section">
        <div className="card-strong">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>バンピック</h2>
            <p className={banpickSession?.status === 'completed' ? 'success' : 'warning'}>
              {banpickSession?.status === 'completed' ? '完了' : '進行中'}
            </p>
          </div>

          {!banpickSession ? (
            <p>バンピック開始準備中です...</p>
          ) : (
            <>
              <div className="grid grid-2">
                <div className="card">
                  <p className="muted">現在フェーズ</p>
                  <h3>{currentBanpickStep?.title || '-'}</h3>
                  <p>{currentBanpickStep?.description || '-'}</p>
                </div>

                <div className="card">
                  <p className="muted">あなた</p>
                  <h3>{getTeamName(myTeamId)}</h3>
                  <p>権限: {myRole || 'なし'}</p>
                </div>
              </div>

              {banpickSession.status === 'in_progress' && (
                <div className="card" style={{ marginTop: 16 }}>
                  <p className="muted">残り時間</p>
                  <h3 className={timerClassName}>{formatRemainingTime(remainingSeconds)}</h3>
                  <p className="danger">
                    5分間操作がない場合、現在の手番チームが敗北になります。
                  </p>
                </div>
              )}

              {banpickSession.timeout_loser_team_id && (
                <div className="card" style={{ marginTop: 16 }}>
                  <p className="danger">
                    <strong>タイムアウト決着</strong>
                  </p>
                  <p>
                    {getTeamName(banpickSession.timeout_loser_team_id)} が5分間操作しなかったため敗北になりました。
                  </p>
                  <p>勝者: {getTeamName(banpickSession.timeout_winner_team_id)}</p>
                </div>
              )}

              {banpickSession.status === 'in_progress' && (
                <div className="card" style={{ marginTop: 16 }}>
                  <h3>現在の操作</h3>

                  {canOperateBanpick ? (
                    <>
                      <p>{currentBanpickStep?.description}</p>

                      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        {availableBanpickTargets.map((target) => (
                          <button
                            key={target}
                            onClick={() =>
                              handleBanpickAction(
                                currentBanpickStep?.actingAction as 'ban' | 'pick_map' | 'pick_side',
                                target
                              )
                            }
                            disabled={banpickLoading}
                          >
                            {banpickLoading ? '送信中...' : target}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted">
                      {myRole !== 'owner'
                        ? 'バンピック操作は owner のみ可能です。'
                        : '現在は相手チームのターンです。'}
                    </p>
                  )}
                </div>
              )}
              
              <div className="grid grid-3" style={{ marginTop: 16 }}>
                <div className="card">
                  <h3>Game 1 Hardpoint</h3>
                  <p>Team A BAN: {banpickSession.hp_ban_a || '-'}</p>
                  <p>Team B BAN: {banpickSession.hp_ban_b || '-'}</p>
                  <p>Map: {banpickSession.hp_map || '-'}</p>
                  <p>Side: {banpickSession.hp_side || '-'}</p>
                </div>

                <div className="card">
                  <h3>Game 2 S&amp;D</h3>
                  <p>Team B BAN: {banpickSession.snd_ban_b || '-'}</p>
                  <p>Team A BAN: {banpickSession.snd_ban_a || '-'}</p>
                  <p>Map: {banpickSession.snd_map || '-'}</p>
                  <p>Side: {banpickSession.snd_side || '-'}</p>
                </div>

                <div className="card">
                  <h3>Game 3 Overload</h3>
                  <p>Team A BAN: {banpickSession.ovl_ban_a || '-'}</p>
                  <p>Map: {banpickSession.ovl_map || '-'}</p>
                  <p>Side: {banpickSession.ovl_side || '-'}</p>
                </div>
              </div>

              <div className="card" style={{ marginTop: 16 }}>
                <h3>バンピック履歴</h3>

                {banpickActions.length === 0 ? (
                  <p>まだ履歴がありません</p>
                ) : (
                  <div className="section">
                    {banpickActions.map((action, index) => (
                      <div key={action.id ?? index} className="card">
                        <p>
                          <strong>{index + 1}.</strong> {getTeamName(action.acting_team_id)}
                        </p>
                        <p>モード: {getModeLabel(action.game_mode)}</p>
                        <p>操作: {action.action_type}</p>
                        <p>内容: {action.target}</p>
                        <p className="muted">
                          {new Date(action.created_at).toLocaleString('ja-JP')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}