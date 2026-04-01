'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import ConfirmDialog from '@/components/ConfirmDialog'

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  winner_team_id: string | null
  loser_team_id: string | null
  status: string
  approval_status?: string
  reported_by_team_id?: string | null
  team1_rating_before?: number | null
  team2_rating_before?: number | null
  team1_rating_after?: number | null
  team2_rating_after?: number | null
}

type TeamRow = {
  id: string
  name: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

type MatchReportRow = {
  id: string
  match_id: string
  reporter_team_id: string
  reported_winner_team_id: string
  hp_winner_team_id: string
  snd_winner_team_id: string
  ov_winner_team_id: string
  approval_status: string
  created_at: string
}

type MatchGameRow = {
  id: string
  match_id: string
  order_no: number
  mode: string
  winner_team_id: string | null
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

export default function MatchDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const realtimeRef = useRef<RealtimeChannel | null>(null)

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
  const [games, setGames] = useState<MatchGameRow[]>([])

  const [latestReport, setLatestReport] = useState<MatchReportRow | null>(null)
  const [hpWinner, setHpWinner] = useState('')
  const [sndWinner, setSndWinner] = useState('')
  const [ovWinner, setOvWinner] = useState('')

  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)

  const [banpickSession, setBanpickSession] = useState<BanpickSessionRow | null>(null)
  const [banpickActions, setBanpickActions] = useState<BanpickActionRow[]>([])
  const [banpickLoading, setBanpickLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)

  const fetchBanpick = async (targetMatchId: string) => {
    const { data: sessionData, error: sessionError } = await supabase
      .from('banpick_sessions')
      .select('*')
      .eq('match_id', targetMatchId)
      .maybeSingle()

    if (sessionError) {
      console.error('banpick session error:', sessionError)
      setBanpickSession(null)
      setBanpickActions([])
      return
    }

    setBanpickSession(sessionData as BanpickSessionRow | null)

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
      console.error('banpick actions error:', actionError)
      setBanpickActions([])
      return
    }

    setBanpickActions((actionData || []) as BanpickActionRow[])
  }

  const fetchData = async () => {
    setLoading(true)

    if (!matchId) {
      console.error('matchId is invalid:', params)
      setLoading(false)
      return
    }

    const { data: matchData, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle()

    if (matchError || !matchData) {
      console.error('matchError:', matchError)
      setLoading(false)
      return
    }

    setMatch(matchData as MatchRow)

    const [{ data: t1, error: t1Error }, { data: t2, error: t2Error }] = await Promise.all([
      supabase.from('teams').select('*').eq('id', matchData.team1_id).single(),
      supabase.from('teams').select('*').eq('id', matchData.team2_id).single(),
    ])

    if (t1Error) console.error('t1Error:', t1Error)
    if (t2Error) console.error('t2Error:', t2Error)

    setTeam1((t1 || null) as TeamRow | null)
    setTeam2((t2 || null) as TeamRow | null)

    const { data: gameData, error: gameError } = await supabase
      .from('match_games')
      .select('*')
      .eq('match_id', matchId)
      .order('order_no', { ascending: true })

    if (gameError) console.error('gameError:', gameError)
    setGames((gameData || []) as MatchGameRow[])

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session?.user) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', session.user.id)
        .single()

      if (userError) {
        console.error('userError:', userError)
      }

      if (user) {
        setMyUserId(user.id)

        const { data: member, error: memberError } = await supabase
          .from('team_members')
          .select('team_id, role')
          .eq('user_id', user.id)
          .maybeSingle()

        if (memberError) {
          console.error('memberError:', memberError)
        }

        if (member) {
          setMyTeamId(member.team_id)
          setMyRole(member.role)
        } else {
          setMyTeamId(null)
          setMyRole(null)
        }
      }
    }

    const { data: report, error: reportError } = await supabase
      .from('match_reports')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (reportError) {
      console.error('reportError:', reportError)
    }

    setLatestReport((report || null) as MatchReportRow | null)

    if (report) {
      setHpWinner(report.hp_winner_team_id || '')
      setSndWinner(report.snd_winner_team_id || '')
      setOvWinner(report.ov_winner_team_id || '')
    } else {
      setHpWinner('')
      setSndWinner('')
      setOvWinner('')
    }

    const { error: createSessionError } = await supabase.rpc(
      'create_banpick_session_for_match',
      {
        p_match_id: matchId,
      }
    )

    if (createSessionError) {
      console.error('create_banpick_session_for_match error:', createSessionError)
    }

    await fetchBanpick(matchId)

    setLoading(false)
  }

  useEffect(() => {
    void fetchData()
  }, [matchId])

  useEffect(() => {
    if (!matchId) return

    const channel = supabase
      .channel(`match-detail-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        async () => {
          await fetchData()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_reports', filter: `match_id=eq.${matchId}` },
        async () => {
          await fetchData()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_games', filter: `match_id=eq.${matchId}` },
        async () => {
          await fetchData()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_sessions', filter: `match_id=eq.${matchId}` },
        async () => {
          await fetchBanpick(matchId)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banpick_actions', filter: `match_id=eq.${matchId}` },
        async () => {
          await fetchBanpick(matchId)
        }
      )
      .subscribe()

    realtimeRef.current = channel

    return () => {
      if (realtimeRef.current) {
        void supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [matchId])

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

  const getApprovalSummary = () => {
    if (!match || !team1 || !team2) {
      return {
        title: '確認中',
        body: '試合情報を読み込み中です。',
        className: 'muted',
      }
    }

    if (match.status === 'completed') {
      return {
        title: '試合確定済み',
        body: 'この試合は承認済みで、結果とレートが確定しています。',
        className: 'success',
      }
    }

    if (!latestReport) {
      return {
        title: '結果報告待ち',
        body: 'まだどちらのチームからも結果報告がありません。',
        className: 'muted',
      }
    }

    const reporterName = getTeamName(latestReport.reporter_team_id)

    if (latestReport.approval_status === 'rejected') {
      return {
        title: '報告却下',
        body: `${reporterName} の報告は却下されました。再報告してください。`,
        className: 'danger',
      }
    }

    if (latestReport.approval_status === 'pending') {
      if (myTeamId && latestReport.reporter_team_id === myTeamId) {
        const opponentId = myTeamId === team1.id ? team2.id : team1.id
        return {
          title: '相手チームの承認待ち',
          body: `あなたのチームが報告済みです。${getTeamName(opponentId)} の承認を待っています。`,
          className: 'muted',
        }
      }

      return {
        title: 'あなたの承認待ち',
        body: `${reporterName} が結果を報告しています。内容を確認して承認または却下してください。`,
        className: 'danger',
      }
    }

    if (latestReport.approval_status === 'approved') {
      return {
        title: '承認済み',
        body: '報告は承認済みです。',
        className: 'success',
      }
    }

    return {
      title: '確認中',
      body: '現在の状態を確認中です。',
      className: 'muted',
    }
  }

  const getCurrentBanpickStep = () => {
    if (!banpickSession) return null

    if (banpickSession.phase === 'phase1_hp') {
      if (banpickSession.step_no === 1) {
        return {
          title: 'フェーズ1 HARDPOINT',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'ban' as const,
          gameMode: 'HARDPOINT',
          description: `${getTeamName(banpickSession.team_a_id)} が Hardpoint のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 2) {
        return {
          title: 'フェーズ1 HARDPOINT',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'ban' as const,
          gameMode: 'HARDPOINT',
          description: `${getTeamName(banpickSession.team_b_id)} が Hardpoint のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 3) {
        return {
          title: 'フェーズ1 HARDPOINT',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'pick_map' as const,
          gameMode: 'HARDPOINT',
          description: `${getTeamName(banpickSession.team_a_id)} が Game 1 の Hardpoint マップを選択してください。`,
        }
      }
      return {
        title: 'フェーズ1 HARDPOINT',
        actingTeamId: banpickSession.team_b_id,
        actingAction: 'pick_side' as const,
        gameMode: 'HARDPOINT',
        description: `${getTeamName(banpickSession.team_b_id)} が Game 1 のマップサイドを選択してください。`,
      }
    }

    if (banpickSession.phase === 'phase2_snd') {
      if (banpickSession.step_no === 1) {
        return {
          title: 'フェーズ2 SEARCH & DESTROY',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'ban' as const,
          gameMode: 'SEARCH_AND_DESTROY',
          description: `${getTeamName(banpickSession.team_b_id)} が S&D のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 2) {
        return {
          title: 'フェーズ2 SEARCH & DESTROY',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'ban' as const,
          gameMode: 'SEARCH_AND_DESTROY',
          description: `${getTeamName(banpickSession.team_a_id)} が S&D のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 3) {
        return {
          title: 'フェーズ2 SEARCH & DESTROY',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'pick_map' as const,
          gameMode: 'SEARCH_AND_DESTROY',
          description: `${getTeamName(banpickSession.team_b_id)} が Game 2 の S&D マップを選択してください。`,
        }
      }
      return {
        title: 'フェーズ2 SEARCH & DESTROY',
        actingTeamId: banpickSession.team_a_id,
        actingAction: 'pick_side' as const,
        gameMode: 'SEARCH_AND_DESTROY',
        description: `${getTeamName(banpickSession.team_a_id)} が Game 2 のマップサイドを選択してください。`,
      }
    }

    if (banpickSession.phase === 'phase3_ovl') {
      if (banpickSession.step_no === 1) {
        return {
          title: 'フェーズ3 OVERLOAD',
          actingTeamId: banpickSession.team_a_id,
          actingAction: 'ban' as const,
          gameMode: 'OVERLOAD',
          description: `${getTeamName(banpickSession.team_a_id)} が Overload のマップを1つBANしてください。`,
        }
      }
      if (banpickSession.step_no === 2) {
        return {
          title: 'フェーズ3 OVERLOAD',
          actingTeamId: banpickSession.team_b_id,
          actingAction: 'pick_map' as const,
          gameMode: 'OVERLOAD',
          description: `${getTeamName(banpickSession.team_b_id)} が Game 3 の Overload マップを選択してください。`,
        }
      }
      return {
        title: 'フェーズ3 OVERLOAD',
        actingTeamId: banpickSession.team_a_id,
        actingAction: 'pick_side' as const,
        gameMode: 'OVERLOAD',
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

  const handleBanpickAction = async (actionType: 'ban' | 'pick_map' | 'pick_side', target: string) => {
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
      console.error('submit_banpick_action error:', error)
      showToast(error.message || 'バンピックの送信に失敗しました', 'error')
      setBanpickLoading(false)
      return
    }

    showToast('バンピックを更新しました', 'success')
    await fetchBanpick(matchId)
    setBanpickLoading(false)
  }

  const handleReport = async () => {
    if (!team1 || !team2 || !myTeamId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    if (!hpWinner || !sndWinner || !ovWinner) {
      showToast('全部入力してください', 'error')
      return
    }

    if (match?.status === 'completed') {
      showToast('この試合はすでに完了しています', 'error')
      return
    }

    setSaving(true)

    const { error } = await supabase.rpc('submit_match_report_atomic', {
      p_match_id: matchId,
      p_reporter_team_id: myTeamId,
      p_hp_winner_team_id: hpWinner,
      p_snd_winner_team_id: sndWinner,
      p_ov_winner_team_id: ovWinner,
    })

    if (error) {
      console.error('submit_match_report_atomic error:', error)
      showToast('報告に失敗しました', 'error')
      setSaving(false)
      return
    }

    showToast('結果を報告しました。相手チームの承認待ちです。', 'success')
    setSaving(false)
    router.refresh()
    router.push(`/match/${matchId}`)
  }

  const handleApprove = async () => {
    if (!latestReport || !team1 || !team2 || !myTeamId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    if (latestReport.reporter_team_id === myTeamId) {
      showToast('報告した側は自分で承認できません', 'error')
      return
    }

    setApproving(true)

    const { error } = await supabase.rpc('approve_match_report_atomic', {
      p_match_id: matchId,
      p_report_id: latestReport.id,
      p_approver_team_id: myTeamId,
    })

    if (error) {
      console.error('approve_match_report_atomic error:', error)
      showToast('承認に失敗しました', 'error')
      setApproving(false)
      return
    }

    showToast('承認しました', 'success')
    setApproving(false)
    router.push('/ranking')
  }

  const handleReject = async () => {
    if (!latestReport || !myTeamId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    if (latestReport.reporter_team_id === myTeamId) {
      showToast('報告した側は自分で却下できません', 'error')
      return
    }

    setRejecting(true)

    const { error } = await supabase.rpc('reject_match_report_atomic', {
      p_match_id: matchId,
      p_report_id: latestReport.id,
      p_rejector_team_id: myTeamId,
    })

    if (error) {
      console.error('reject_match_report_atomic error:', error)
      showToast('報告の却下に失敗しました', 'error')
      setRejecting(false)
      return
    }

    showToast('結果報告を却下しました。再報告を待ってください。', 'info')
    setRejecting(false)
    setRejectDialogOpen(false)
    router.refresh()
    router.push(`/match/${matchId}`)
  }

  if (loading) {
    return (
      <main>
        <h1>試合詳細</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  if (!match) {
    return (
      <main>
        <h1>試合詳細</h1>
        <p>試合が見つかりません</p>
        <button onClick={() => router.push('/history')}>履歴へ戻る</button>
      </main>
    )
  }

  const approvalSummary = getApprovalSummary()

  return (
    <>
      <main>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>試合詳細</h1>
            <p className="muted">報告、承認、却下、バンピック確認を行います</p>
          </div>
          <div className="row">
            <button onClick={() => router.push('/history')}>履歴へ戻る</button>
          </div>
        </div>

        <div className="section">
          <div className="card-strong">
            <h2>承認ステータス</h2>
            <p className={approvalSummary.className}>
              <strong>{approvalSummary.title}</strong>
            </p>
            <p>{approvalSummary.body}</p>
          </div>
        </div>

        <div className="section">
          <div className="card-strong">
            <h2>対戦情報</h2>
            <div className="grid grid-2">
              <div className="card">
                <p className="muted">マッチID</p>
                <h3>{match.id}</h3>
              </div>
              <div className="card">
                <p className="muted">状態</p>
                <h3>{match.status}</h3>
                <p>承認状態: {match.approval_status || 'none'}</p>
              </div>
              <div className="card">
                <p className="muted">チーム1</p>
                <h3>{team1?.name}</h3>
              </div>
              <div className="card">
                <p className="muted">チーム2</p>
                <h3>{team2?.name}</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="card-strong">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>バンピック</h2>
              <span className={banpickSession?.status === 'completed' ? 'success' : 'muted'}>
                {banpickSession?.status === 'completed' ? '完了' : '進行中'}
              </span>
            </div>

            {!banpickSession ? (
              <p>バンピック情報を準備中です...</p>
            ) : (
              <>
                <div className="grid grid-2">
                  <div className="card">
                    <p className="muted">チームA</p>
                    <h3>{getTeamName(banpickSession.team_a_id)}</h3>
                  </div>
                  <div className="card">
                    <p className="muted">チームB</p>
                    <h3>{getTeamName(banpickSession.team_b_id)}</h3>
                  </div>
                </div>

                <div className="card" style={{ marginTop: '12px' }}>
                  <p>
                    <strong>現在フェーズ:</strong> {currentBanpickStep?.title || '-'}
                  </p>
                  <p>
                    <strong>説明:</strong> {currentBanpickStep?.description || '-'}
                  </p>
                  <p>
                    <strong>あなたのチーム:</strong> {getTeamName(myTeamId)}
                  </p>
                  <p>
                    <strong>あなたの権限:</strong> {myRole || 'なし'}
                  </p>
                </div>

                <div className="section grid grid-3">
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

                {banpickSession.status === 'in_progress' && (
                  <div className="section">
                    <div className="card">
                      <h3>現在の操作</h3>

                      {canOperateBanpick ? (
                        <>
                          <p style={{ marginBottom: '12px' }}>
                            あなたのターンです。選択してください。
                          </p>

                          <div className="row" style={{ flexWrap: 'wrap', gap: '8px' }}>
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
                        <p>
                          {myRole !== 'owner'
                            ? 'バンピック操作は owner のみ可能です。'
                            : '現在は相手チームのターンです。'}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="section">
                  <div className="card">
                    <h3>バンピック履歴</h3>

                    {banpickActions.length === 0 ? (
                      <p>まだ履歴がありません</p>
                    ) : (
                      <div className="stack">
                        {banpickActions.map((action, index) => (
                          <div key={action.id} className="card">
                            <p>
                              <strong>{index + 1}.</strong> {getTeamName(action.acting_team_id)}
                            </p>
                            <p>
                              モード: {getModeLabel(action.game_mode)}
                            </p>
                            <p>
                              操作: {action.action_type}
                            </p>
                            <p>
                              内容: {action.target}
                            </p>
                            <p>
                              時刻: {new Date(action.created_at).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {match.status === 'completed' && (
          <div className="section">
            <div className="card-strong">
              <h2>試合結果</h2>

              <div className="grid grid-2">
                <div className="card">
                  <p className="muted">勝者</p>
                  <h3>{getTeamName(match.winner_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">敗者</p>
                  <h3>{getTeamName(match.loser_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">{team1?.name} レート</p>
                  <h3>
                    {match.team1_rating_before ?? '-'} → {match.team1_rating_after ?? '-'}
                  </h3>
                </div>
                <div className="card">
                  <p className="muted">{team2?.name} レート</p>
                  <h3>
                    {match.team2_rating_before ?? '-'} → {match.team2_rating_after ?? '-'}
                  </h3>
                </div>
              </div>

              <div className="section">
                <h3>各ゲーム結果</h3>

                {games.length === 0 ? (
                  <p>ゲーム結果がありません</p>
                ) : (
                  <div className="stack">
                    {games.map((game) => (
                      <div key={game.id} className="card">
                        <p>
                          <strong>Game {game.order_no}</strong>
                        </p>
                        <p>モード: {getModeLabel(game.mode)}</p>
                        <p>勝者: {getTeamName(game.winner_team_id)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {latestReport && match.status !== 'completed' && (
          <div className="section">
            <div className="card-strong">
              <h2>最新の報告内容</h2>

              <div className="grid grid-2">
                <div className="card">
                  <p className="muted">報告チーム</p>
                  <h3>{getTeamName(latestReport.reporter_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">報告勝者</p>
                  <h3>{getTeamName(latestReport.reported_winner_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">Hardpoint</p>
                  <h3>{getTeamName(latestReport.hp_winner_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">S&amp;D</p>
                  <h3>{getTeamName(latestReport.snd_winner_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">Overload</p>
                  <h3>{getTeamName(latestReport.ov_winner_team_id)}</h3>
                </div>
                <div className="card">
                  <p className="muted">承認状態</p>
                  <h3>{latestReport.approval_status}</h3>
                </div>
              </div>

              {myTeamId &&
                latestReport.reporter_team_id !== myTeamId &&
                latestReport.approval_status === 'pending' && (
                  <div className="section row">
                    <button onClick={handleApprove} disabled={approving}>
                      {approving ? '承認中...' : 'この結果を承認する'}
                    </button>
                    <button onClick={() => setRejectDialogOpen(true)} disabled={rejecting}>
                      {rejecting ? '却下中...' : 'この結果を却下する'}
                    </button>
                  </div>
                )}
            </div>
          </div>
        )}

        {(!latestReport || latestReport.approval_status === 'rejected') &&
          match.status !== 'completed' && (
            <div className="section">
              <div className="card-strong">
                <h2>結果報告</h2>

                <div className="stack">
                  <div>
                    <label>Hardpoint 勝者</label>
                    <select value={hpWinner} onChange={(e) => setHpWinner(e.target.value)}>
                      <option value="">選択してください</option>
                      <option value={team1?.id}>{team1?.name}</option>
                      <option value={team2?.id}>{team2?.name}</option>
                    </select>
                  </div>

                  <div>
                    <label>S&amp;D 勝者</label>
                    <select value={sndWinner} onChange={(e) => setSndWinner(e.target.value)}>
                      <option value="">選択してください</option>
                      <option value={team1?.id}>{team1?.name}</option>
                      <option value={team2?.id}>{team2?.name}</option>
                    </select>
                  </div>

                  <div>
                    <label>Overload 勝者</label>
                    <select value={ovWinner} onChange={(e) => setOvWinner(e.target.value)}>
                      <option value="">選択してください</option>
                      <option value={team1?.id}>{team1?.name}</option>
                      <option value={team2?.id}>{team2?.name}</option>
                    </select>
                  </div>

                  <div className="row">
                    <button onClick={handleReport} disabled={saving}>
                      {saving ? '送信中...' : '試合結果を報告'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
      </main>

      <ConfirmDialog
        open={rejectDialogOpen}
        title="結果報告を却下しますか？"
        message="この報告を却下すると、相手チームは再報告が必要になります。"
        confirmText={rejecting ? '却下中...' : '却下する'}
        cancelText="キャンセル"
        onConfirm={handleReject}
        onCancel={() => {
          if (!rejecting) setRejectDialogOpen(false)
        }}
      />
    </>
  )
}