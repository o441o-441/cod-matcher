'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import ConfirmDialog from '@/components/ConfirmDialog'

/* ================= 型 ================= */

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
}

type BanpickSessionRow = {
  id: string
  match_id: string
  team_a_id: string
  team_b_id: string
  phase: string
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
  deadline_at: string
  timeout_loser_team_id: string | null
  timeout_winner_team_id: string | null
}

type BanpickActionRow = {
  id: string
  match_id: string
  acting_team_id: string
  action_type: string
  target: string
  created_at: string
}

/* ================= 定数 ================= */

const HP_POOL = ['エクスポージャー', 'コロッサス', 'スカー', 'デン', 'ブラックハート']
const SND_POOL = ['エクスポージャー', 'コロッサス', 'スカー', 'デン', 'レイド']
const OVL_POOL = ['エクスポージャー', 'スカー', 'デン']
const SIDE_OPTIONS = ['JSOC', 'ギルド']

/* ================= 本体 ================= */

export default function MatchDetailPage() {
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
  const banpickPollingRef = useRef<any>(null)
  const timeoutIntervalRef = useRef<any>(null)
  const fetchingRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [team1, setTeam1] = useState<TeamRow | null>(null)
  const [team2, setTeam2] = useState<TeamRow | null>(null)

  const [banpickSession, setBanpickSession] = useState<BanpickSessionRow | null>(null)
  const [banpickActions, setBanpickActions] = useState<BanpickActionRow[]>([])

  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)

  const [nowMs, setNowMs] = useState(Date.now())

  /* ================= fetch ================= */

  const fetchBanpick = async () => {
    const { data: session } = await supabase
      .from('banpick_sessions')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle()

    setBanpickSession(session || null)

    if (!session) {
      setBanpickActions([])
      return
    }

    const { data: actions } = await supabase
      .from('banpick_actions')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })

    setBanpickActions(actions || [])
  }

  const fetchData = async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true

    setLoading(true)

    const { data: matchData } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single()

    setMatch(matchData)

    const [{ data: t1 }, { data: t2 }] = await Promise.all([
      supabase.from('teams').select('*').eq('id', matchData.team1_id).single(),
      supabase.from('teams').select('*').eq('id', matchData.team2_id).single(),
    ])

    setTeam1(t1)
    setTeam2(t2)

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
        }
      }
    }

    await fetchBanpick()

    setLoading(false)
    fetchingRef.current = false
  }

  /* ================= 初期 ================= */

  useEffect(() => {
    fetchData()
  }, [matchId])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  /* ================= realtime ================= */

  useEffect(() => {
    if (!matchId) return

    const channel = supabase
      .channel(`match-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_actions' },
        async (payload) => {
          const row = payload.new as any
          if (row?.match_id === matchId) {
            await fetchBanpick()
          }
        }
      )
      .subscribe()

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
      }
    }
  }, [matchId])

  /* ================= 軽量ポーリング ================= */

  useEffect(() => {
    if (banpickPollingRef.current) clearInterval(banpickPollingRef.current)

    if (!banpickSession || banpickSession.status !== 'in_progress') return

    banpickPollingRef.current = setInterval(fetchBanpick, 2000)

    return () => clearInterval(banpickPollingRef.current)
  }, [banpickSession?.status])

  /* ================= timeout ================= */

  const resolveTimeout = async () => {
    await supabase.rpc('resolve_banpick_timeout', { p_match_id: matchId })
  }

  useEffect(() => {
    if (timeoutIntervalRef.current) clearInterval(timeoutIntervalRef.current)

    if (!banpickSession || banpickSession.status !== 'in_progress') return

    timeoutIntervalRef.current = setInterval(resolveTimeout, 10000)

    return () => clearInterval(timeoutIntervalRef.current)
  }, [banpickSession?.deadline_at])

  /* ================= helper ================= */

  const getTeamName = (id: string | null) => {
    if (team1?.id === id) return team1.name
    if (team2?.id === id) return team2.name
    return '-'
  }

  const remainingSeconds = useMemo(() => {
    if (!banpickSession) return 0
    const diff = new Date(banpickSession.deadline_at).getTime() - nowMs
    return Math.max(0, Math.floor(diff / 1000))
  }, [banpickSession, nowMs])

  const canOperate =
    myRole === 'owner' &&
    myTeamId &&
    banpickSession?.status === 'in_progress'

  /* ================= UI ================= */

  if (loading) return <main>読み込み中...</main>
  if (!match) return <main>試合が見つかりません</main>

  return (
    <main>
      <h1>試合詳細</h1>

      <div>
        <h2>
          {team1?.name} vs {team2?.name}
        </h2>
      </div>

      <div>
        <h3>残り時間: {remainingSeconds}s</h3>
      </div>

      <div>
        <h2>バンピック</h2>

        {banpickSession?.status === 'completed' ? (
          <p>完了</p>
        ) : (
          <>
            {canOperate ? (
              <>
                {[...HP_POOL, ...SND_POOL, ...OVL_POOL, ...SIDE_OPTIONS].map((x) => (
                  <button
                    key={x}
                    onClick={() =>
                      supabase.rpc('submit_banpick_action', {
                        p_match_id: matchId,
                        p_actor_user_id: myUserId,
                        p_action_type: 'ban',
                        p_target: x,
                      })
                    }
                  >
                    {x}
                  </button>
                ))}
              </>
            ) : (
              <p>相手のターンです</p>
            )}
          </>
        )}
      </div>

      <div>
        <h2>履歴</h2>
        {banpickActions.map((a) => (
          <div key={a.id}>
            {getTeamName(a.acting_team_id)}: {a.target}
          </div>
        ))}
      </div>
    </main>
  )
}