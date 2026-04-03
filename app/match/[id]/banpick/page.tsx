'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  status: string
}

type TeamRow = {
  id: string
  name: string
}

type BanpickSessionRow = {
  id: string
  match_id: string
  status: 'in_progress' | 'completed'
  current_step_index: number
  acting_team_id: string | null
  timeout_loser_team_id: string | null
  timeout_winner_team_id: string | null
  deadline_at: string | null

  hp_ban_a: string | null
  hp_ban_b: string | null
  hp_map: string | null
  hp_side: string | null

  snd_ban_a: string | null
  snd_ban_b: string | null
  snd_map: string | null
  snd_side: string | null

  ovl_ban_a: string | null
  ovl_map: string | null
  ovl_side: string | null
}

type BanpickActionRow = {
  id: string
  acting_team_id: string
  action_type: string
  game_mode: string
  target: string
  created_at: string
}

type UserRow = {
  id: string
}

type TeamMemberRow = {
  team_id: string
  role?: string | null
}

type BanpickStep = {
  title: string
  description: string
  actingTeam: 'A' | 'B'
  actingAction: 'ban' | 'pick_map' | 'pick_side'
  gameMode: 'hardpoint' | 'snd' | 'overload'
  targets: string[]
}

const HP_MAPS = ['Skidrow', 'Karachi', 'Invasion', 'Rio', 'Vista']
const SND_MAPS = ['Terminal', 'Highrise', 'Karachi', 'Rio', 'Invasion']
const OVL_MAPS = ['Vista', 'Departures', '6 Star', 'Rio', 'Invasion']
const SIDES = ['JSOC', 'ギルド']

const BANPICK_STEPS: BanpickStep[] = [
  {
    title: 'Game 1 Hardpoint - Team A BAN',
    description: 'Team A が Hardpoint のマップを1つBANしてください。',
    actingTeam: 'A',
    actingAction: 'ban',
    gameMode: 'hardpoint',
    targets: HP_MAPS,
  },
  {
    title: 'Game 1 Hardpoint - Team B BAN',
    description: 'Team B が Hardpoint のマップを1つBANしてください。',
    actingTeam: 'B',
    actingAction: 'ban',
    gameMode: 'hardpoint',
    targets: HP_MAPS,
  },
  {
    title: 'Game 1 Hardpoint - Team A PICK MAP',
    description: 'Team A が Hardpoint のマップを選択してください。',
    actingTeam: 'A',
    actingAction: 'pick_map',
    gameMode: 'hardpoint',
    targets: HP_MAPS,
  },
  {
    title: 'Game 1 Hardpoint - Team B PICK SIDE',
    description: 'Team B が Hardpoint のサイドを選択してください。',
    actingTeam: 'B',
    actingAction: 'pick_side',
    gameMode: 'hardpoint',
    targets: SIDES,
  },
  {
    title: 'Game 2 S&D - Team B BAN',
    description: 'Team B が S&D のマップを1つBANしてください。',
    actingTeam: 'B',
    actingAction: 'ban',
    gameMode: 'snd',
    targets: SND_MAPS,
  },
  {
    title: 'Game 2 S&D - Team A BAN',
    description: 'Team A が S&D のマップを1つBANしてください。',
    actingTeam: 'A',
    actingAction: 'ban',
    gameMode: 'snd',
    targets: SND_MAPS,
  },
  {
    title: 'Game 2 S&D - Team B PICK MAP',
    description: 'Team B が S&D のマップを選択してください。',
    actingTeam: 'B',
    actingAction: 'pick_map',
    gameMode: 'snd',
    targets: SND_MAPS,
  },
  {
    title: 'Game 2 S&D - Team A PICK SIDE',
    description: 'Team A が S&D のサイドを選択してください。',
    actingTeam: 'A',
    actingAction: 'pick_side',
    gameMode: 'snd',
    targets: SIDES,
  },
  {
    title: 'Game 3 Overload - Team A BAN',
    description: 'Team A が Overload のマップを1つBANしてください。',
    actingTeam: 'A',
    actingAction: 'ban',
    gameMode: 'overload',
    targets: OVL_MAPS,
  },
  {
    title: 'Game 3 Overload - Team B PICK MAP',
    description: 'Team B が Overload のマップを選択してください。',
    actingTeam: 'B',
    actingAction: 'pick_map',
    gameMode: 'overload',
    targets: OVL_MAPS,
  },
  {
    title: 'Game 3 Overload - Team A PICK SIDE',
    description: 'Team A が Overload のサイドを選択してください。',
    actingTeam: 'A',
    actingAction: 'pick_side',
    gameMode: 'overload',
    targets: SIDES,
  },
]

function getModeLabel(mode: string) {
  const v = mode?.toLowerCase?.() || ''
  if (v === 'hardpoint') return 'Hardpoint'
  if (v === 'snd' || v === 'search_and_destroy') return 'S&D'
  if (v === 'overload') return 'Overload'
  return mode
}

function formatRemainingTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const min = Math.floor(safe / 60)
  const sec = safe % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

export default function BanpickPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()

  const matchId =
    typeof params.id === 'string'
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : ''

  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [team1, setTeam1] = useState<TeamRow | null>(null)
  const [team2, setTeam2] = useState<TeamRow | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)

  const [banpickSession, setBanpickSession] = useState<BanpickSessionRow | null>(null)
  const [banpickActions, setBanpickActions] = useState<BanpickActionRow[]>([])
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [banpickLoading, setBanpickLoading] = useState(false)

  const getTeamName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return '不明'
      if (team1?.id === id) return team1.name
      if (team2?.id === id) return team2.name
      return '不明'
    },
    [team1, team2],
  )

  const currentBanpickStep = useMemo(() => {
    if (!banpickSession) return null
    return BANPICK_STEPS[banpickSession.current_step_index] || null
  }, [banpickSession])

  const availableBanpickTargets = useMemo(() => {
    if (!currentBanpickStep || !banpickSession) return []

    let candidates = [...currentBanpickStep.targets]

    if (currentBanpickStep.gameMode === 'hardpoint') {
      candidates = candidates.filter(
        (v) =>
          v !== banpickSession.hp_ban_a &&
          v !== banpickSession.hp_ban_b &&
          v !== banpickSession.hp_map,
      )
    }

    if (currentBanpickStep.gameMode === 'snd') {
      candidates = candidates.filter(
        (v) =>
          v !== banpickSession.snd_ban_a &&
          v !== banpickSession.snd_ban_b &&
          v !== banpickSession.snd_map,
      )
    }

    if (currentBanpickStep.gameMode === 'overload') {
      candidates = candidates.filter(
        (v) => v !== banpickSession.ovl_ban_a && v !== banpickSession.ovl_map,
      )
    }

    return candidates
  }, [currentBanpickStep, banpickSession])

  const canOperateBanpick =
    !!banpickSession &&
    banpickSession.status === 'in_progress' &&
    myRole === 'owner' &&
    !!myTeamId &&
    currentBanpickStep?.actingTeam &&
    (
      (currentBanpickStep.actingTeam === 'A' && myTeamId === match?.team1_id) ||
      (currentBanpickStep.actingTeam === 'B' && myTeamId === match?.team2_id)
    )

  const fetchData = useCallback(async () => {
    if (!matchId || fetchingRef.current) return
    fetchingRef.current = true

    try {
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle()

      if (matchError || !matchData) {
        console.error('[banpick] match error:', matchError)
        setLoading(false)
        return
      }

      const [{ data: t1 }, { data: t2 }] = await Promise.all([
        supabase.from('teams').select('id,name').eq('id', matchData.team1_id).maybeSingle(),
        supabase.from('teams').select('id,name').eq('id', matchData.team2_id).maybeSingle(),
      ])

      const { data: sessionData, error: sessionError } = await supabase
        .from('banpick_sessions')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle()

      if (sessionError) {
        console.error('[banpick] session error:', sessionError)
      }

      const { data: actionsData, error: actionsError } = await supabase
        .from('banpick_actions')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })

      if (actionsError) {
        console.error('[banpick] actions error:', actionsError)
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()

      let resolvedMyTeamId: string | null = null
      let resolvedMyRole: string | null = null

      if (session?.user) {
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', session.user.id)
          .maybeSingle<UserRow>()

        if (user?.id) {
          const { data: members, error: memberError } = await supabase
            .from('team_members')
            .select('team_id, role')
            .eq('user_id', user.id)

          if (memberError) {
            console.error('[banpick] member error:', memberError)
          }

          const myMembership = (members as TeamMemberRow[] | null)?.find(
            (m) => m.team_id === matchData.team1_id || m.team_id === matchData.team2_id,
          )

          resolvedMyTeamId = myMembership?.team_id || null
          resolvedMyRole = myMembership?.role || null
        }
      }

      setMatch(matchData as MatchRow)
      setTeam1((t1 || null) as TeamRow | null)
      setTeam2((t2 || null) as TeamRow | null)
      setBanpickSession((sessionData || null) as BanpickSessionRow | null)
      setBanpickActions((actionsData || []) as BanpickActionRow[])
      setMyTeamId(resolvedMyTeamId)
      setMyRole(resolvedMyRole)
      setLoading(false)
    } finally {
      fetchingRef.current = false
    }
  }, [matchId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!banpickSession?.deadline_at || banpickSession.status !== 'in_progress') {
      setRemainingSeconds(0)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const update = () => {
      const diff = Math.floor(
        (new Date(banpickSession.deadline_at as string).getTime() - Date.now()) / 1000,
      )
      setRemainingSeconds(Math.max(0, diff))
    }

    update()

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(update, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [banpickSession?.deadline_at, banpickSession?.status])

  useEffect(() => {
    if (!matchId) return

    const channel = supabase
      .channel(`banpick-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_sessions', filter: `match_id=eq.${matchId}` },
        async () => {
          await fetchData()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_actions', filter: `match_id=eq.${matchId}` },
        async () => {
          await fetchData()
        },
      )
      .subscribe((status) => {
        console.log('banpick realtime status:', status)
      })

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [matchId, fetchData])

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    if (!matchId) return
    if (banpickSession?.status === 'completed') return

    pollingRef.current = setInterval(() => {
      void fetchData()
    }, 3000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [matchId, banpickSession?.status, fetchData])

  const handleBanpickAction = async (
    actionType: 'ban' | 'pick_map' | 'pick_side',
    target: string,
  ) => {
    if (!banpickSession || !currentBanpickStep || !myTeamId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    if (!canOperateBanpick) {
      showToast('現在は操作できません', 'error')
      return
    }

    setBanpickLoading(true)

    const { error } = await supabase
      .from('banpick_actions')
      .insert({
        match_id: matchId,
        acting_team_id: myTeamId,
        action_type: actionType,
        game_mode: currentBanpickStep.gameMode,
        target,
      })

    if (error) {
      console.error('[banpick] action error:', error)
      showToast('バンピック操作に失敗しました', 'error')
      setBanpickLoading(false)
      return
    }

    showToast('送信しました', 'success')
    setBanpickLoading(false)
    await fetchData()
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 900, margin: '32px auto', padding: '0 16px' }}>
        <h1>バンピック</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  if (!match) {
    return (
      <main style={{ maxWidth: 900, margin: '32px auto', padding: '0 16px' }}>
        <h1>バンピック</h1>
        <p>試合が見つかりません</p>
        <button onClick={() => router.push('/history')}>履歴へ戻る</button>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 900, margin: '32px auto', padding: '0 16px' }}>
      <h1>バンピック</h1>
      <p>マップとサイドを決定します</p>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => router.push('/mypage')}>マイページに戻る</button>
        <button onClick={() => router.push(`/match/${matchId}/report`)}>結果報告へ</button>
      </div>

      <section
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: '#fff',
          borderBottom: '1px solid #ddd',
          padding: '12px 0 16px',
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>現在の操作</h2>

        {!banpickSession ? (
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: 12,
              background: '#fafafa',
            }}
          >
            バンピック開始準備中です...
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                <div>状態</div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>
                  {banpickSession.status === 'completed' ? '完了' : '進行中'}
                </div>
              </div>

              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                <div>現在フェーズ</div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>
                  {currentBanpickStep?.title || '-'}
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  {currentBanpickStep?.description || '-'}
                </div>
              </div>

              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                <div>あなた</div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>
                  {getTeamName(myTeamId)}
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  権限: {myRole || 'なし'}
                </div>
              </div>

              {banpickSession.status === 'in_progress' && (
                <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                  <div>残り時間</div>
                  <div style={{ fontWeight: 700, marginTop: 6, fontSize: 20 }}>
                    {formatRemainingTime(remainingSeconds)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    5分間操作がない場合、現在の手番チームが敗北になります。
                  </div>
                </div>
              )}
            </div>

            {banpickSession.timeout_loser_team_id && (
              <div
                style={{
                  marginTop: 12,
                  border: '1px solid #f0b4b4',
                  background: '#fff6f6',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 700 }}>タイムアウト決着</div>
                <div style={{ marginTop: 6 }}>
                  {getTeamName(banpickSession.timeout_loser_team_id)} が5分間操作しなかったため敗北になりました。
                </div>
                <div style={{ marginTop: 6 }}>
                  勝者: {getTeamName(banpickSession.timeout_winner_team_id)}
                </div>
              </div>
            )}

            {banpickSession.status === 'in_progress' && (
              <div
                style={{
                  marginTop: 12,
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  padding: 12,
                  background: canOperateBanpick ? '#f7fbff' : '#fafafa',
                }}
              >
                {canOperateBanpick ? (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 10 }}>
                      {currentBanpickStep?.description}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {availableBanpickTargets.map((target) => (
                        <button
                          key={target}
                          onClick={() =>
                            handleBanpickAction(
                              currentBanpickStep?.actingAction as
                                | 'ban'
                                | 'pick_map'
                                | 'pick_side',
                              target,
                            )
                          }
                          disabled={banpickLoading}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 8,
                            border: '1px solid #ccc',
                            background: '#fff',
                            cursor: banpickLoading ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {banpickLoading ? '送信中...' : target}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div>
                    {myRole !== 'owner'
                      ? 'バンピック操作は owner のみ可能です。'
                      : '現在は相手チームのターンです。'}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {banpickSession && (
        <>
          <section style={{ marginTop: 24 }}>
            <h2>現在の決定内容</h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
              }}
            >
              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>Game 1 Hardpoint</h3>
                <div>Team A BAN: {banpickSession.hp_ban_a || '-'}</div>
                <div>Team B BAN: {banpickSession.hp_ban_b || '-'}</div>
                <div>Map: {banpickSession.hp_map || '-'}</div>
                <div>Side: {banpickSession.hp_side || '-'}</div>
              </div>

              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>Game 2 S&amp;D</h3>
                <div>Team B BAN: {banpickSession.snd_ban_b || '-'}</div>
                <div>Team A BAN: {banpickSession.snd_ban_a || '-'}</div>
                <div>Map: {banpickSession.snd_map || '-'}</div>
                <div>Side: {banpickSession.snd_side || '-'}</div>
              </div>

              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>Game 3 Overload</h3>
                <div>Team A BAN: {banpickSession.ovl_ban_a || '-'}</div>
                <div>Map: {banpickSession.ovl_map || '-'}</div>
                <div>Side: {banpickSession.ovl_side || '-'}</div>
              </div>
            </div>
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>バンピック履歴</h2>

            {banpickActions.length === 0 ? (
              <p>まだ履歴がありません</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {banpickActions.map((action, index) => (
                  <div
                    key={action.id}
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{index + 1}. {getTeamName(action.acting_team_id)}</div>
                    <div style={{ marginTop: 6 }}>モード: {getModeLabel(action.game_mode)}</div>
                    <div>操作: {action.action_type}</div>
                    <div>内容: {action.target}</div>
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      {new Date(action.created_at).toLocaleString('ja-JP')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}