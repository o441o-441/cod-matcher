'use client'

import { useEffect, useState } from 'react'
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

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [team1, setTeam1] = useState<TeamRow | null>(null)
  const [team2, setTeam2] = useState<TeamRow | null>(null)
  const [games, setGames] = useState<MatchGameRow[]>([])

  const [hpWinner, setHpWinner] = useState('')
  const [sndWinner, setSndWinner] = useState('')
  const [ovWinner, setOvWinner] = useState('')

  const [latestReport, setLatestReport] = useState<MatchReportRow | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)

  useEffect(() => {
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

      setMatch(matchData)

      const { data: t1, error: t1Error } = await supabase
        .from('teams')
        .select('*')
        .eq('id', matchData.team1_id)
        .single()

      const { data: t2, error: t2Error } = await supabase
        .from('teams')
        .select('*')
        .eq('id', matchData.team2_id)
        .single()

      if (t1Error) console.error('t1Error:', t1Error)
      if (t2Error) console.error('t2Error:', t2Error)

      setTeam1(t1)
      setTeam2(t2)

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
          const { data: member, error: memberError } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('user_id', user.id)
            .maybeSingle()

          if (memberError) {
            console.error('memberError:', memberError)
          }

          if (member) setMyTeamId(member.team_id)
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

      setLatestReport(report)

      if (report) {
        setHpWinner(report.hp_winner_team_id || '')
        setSndWinner(report.snd_winner_team_id || '')
        setOvWinner(report.ov_winner_team_id || '')
      }

      setLoading(false)
    }

    fetchData()
  }, [matchId, params])

  const getTeamName = (id: string | null | undefined) => {
    if (!id) return '不明'
    if (team1?.id === id) return team1.name
    if (team2?.id === id) return team2.name
    return '不明'
  }

  const getModeLabel = (mode: string) => {
    if (mode === 'hardpoint') return 'Hardpoint'
    if (mode === 'snd') return 'S&D'
    if (mode === 'overload') return 'Overload'
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
        <div className="card">
          <p>読み込み中...</p>
        </div>
      </main>
    )
  }

  if (!match) {
    return (
      <main>
        <h1>試合詳細</h1>
        <div className="card">
          <p>試合が見つかりません</p>
        </div>
        <div className="section row">
          <button onClick={() => router.push('/history')}>履歴へ戻る</button>
        </div>
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
            <p className="muted">報告、承認、却下、結果確認を行います</p>
          </div>

          <div className="row">
            <button onClick={() => router.push('/history')}>履歴へ戻る</button>
          </div>
        </div>

        <div className="section card-strong">
          <h2>承認ステータス</h2>
          <div className="card">
            <p className={approvalSummary.className}>
              <strong>{approvalSummary.title}</strong>
            </p>
            <p>{approvalSummary.body}</p>
          </div>
        </div>

        <div className="section card-strong">
          <h2>対戦情報</h2>

          <div className="grid grid-2">
            <div className="card">
              <p className="muted">マッチID</p>
              <h3>{match.id}</h3>
            </div>

            <div className="card">
              <p className="muted">状態</p>
              <h3>{match.status}</h3>
              <p className="muted">承認状態: {match.approval_status || 'none'}</p>
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

        {match.status === 'completed' && (
          <div className="section card-strong">
            <h2>試合結果</h2>

            <div className="grid grid-2">
              <div className="card">
                <p className="muted">勝者</p>
                <h3 className="success">{getTeamName(match.winner_team_id)}</h3>
              </div>

              <div className="card">
                <p className="muted">敗者</p>
                <h3 className="danger">{getTeamName(match.loser_team_id)}</h3>
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
        )}

        {latestReport && match.status !== 'completed' && (
          <div className="section card-strong">
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
                <p className="muted">S&D</p>
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

                  <button
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={rejecting}
                  >
                    {rejecting ? '却下中...' : 'この結果を却下する'}
                  </button>
                </div>
              )}
          </div>
        )}

        {(!latestReport || latestReport.approval_status === 'rejected') &&
          match.status !== 'completed' && (
            <div className="section card-strong">
              <h2>結果報告</h2>

              <div className="stack">
                <div>
                  <p className="muted">Hardpoint 勝者</p>
                  <select value={hpWinner} onChange={(e) => setHpWinner(e.target.value)}>
                    <option value="">選択してください</option>
                    <option value={team1?.id}>{team1?.name}</option>
                    <option value={team2?.id}>{team2?.name}</option>
                  </select>
                </div>

                <div>
                  <p className="muted">S&amp;D 勝者</p>
                  <select value={sndWinner} onChange={(e) => setSndWinner(e.target.value)}>
                    <option value="">選択してください</option>
                    <option value={team1?.id}>{team1?.name}</option>
                    <option value={team2?.id}>{team2?.name}</option>
                  </select>
                </div>

                <div>
                  <p className="muted">Overload 勝者</p>
                  <select value={ovWinner} onChange={(e) => setOvWinner(e.target.value)}>
                    <option value="">選択してください</option>
                    <option value={team1?.id}>{team1?.name}</option>
                    <option value={team2?.id}>{team2?.name}</option>
                  </select>
                </div>
              </div>

              <div className="section row">
                <button onClick={handleReport} disabled={saving}>
                  {saving ? '送信中...' : '試合結果を報告'}
                </button>
              </div>
            </div>
          )}
      </main>

      <ConfirmDialog
        open={rejectDialogOpen}
        title="結果報告を却下"
        message="この試合結果報告を却下しますか？ 却下すると、相手チームは再報告が必要になります。"
        confirmText="却下する"
        cancelText="戻る"
        danger
        loading={rejecting}
        onConfirm={handleReject}
        onCancel={() => {
          if (!rejecting) setRejectDialogOpen(false)
        }}
      />
    </>
  )
}