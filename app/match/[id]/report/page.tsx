'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  approval_status?: string | null
  team1_rating_before?: number | null
  team2_rating_before?: number | null
  team1_rating_after?: number | null
  team2_rating_after?: number | null
}

type TeamRow = {
  id: string
  name: string
}

type MatchReportRow = {
  id: string
  match_id: string
  reporter_team_id: string
  reported_winner_team_id: string
  hp_winner_team_id: string
  snd_winner_team_id: string
  ov_winner_team_id: string | null
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

export default function MatchReportPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()

  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef = useRef(false)
  const mountedRef = useRef(false)

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

  const [myTeamId, setMyTeamId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const getTeamName = (id: string | null | undefined) => {
    if (!id) return '未実施'
    if (team1?.id === id) return team1.name
    if (team2?.id === id) return team2.name
    return '不明'
  }

  const getModeLabel = (mode: string) => {
    const v = mode?.toLowerCase?.() || ''
    if (v === 'hardpoint') return 'Hardpoint'
    if (v === 'snd' || v === 'search_and_destroy') return 'S&D'
    if (v === 'overload') return 'Overload'
    return mode
  }

  const isOverloadRequired =
    !!hpWinner && !!sndWinner && hpWinner !== sndWinner

  useEffect(() => {
    if (!isOverloadRequired && ovWinner) {
      setOvWinner('')
    }
  }, [isOverloadRequired, ovWinner])

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
        console.error('[fetchData] match error:', matchError)
        if (mountedRef.current) {
          setMatch(null)
          setLoading(false)
        }
        return
      }

      const [{ data: t1, error: t1Error }, { data: t2, error: t2Error }] =
        await Promise.all([
          supabase
            .from('teams')
            .select('id, name')
            .eq('id', matchData.team1_id)
            .maybeSingle(),
          supabase
            .from('teams')
            .select('id, name')
            .eq('id', matchData.team2_id)
            .maybeSingle(),
        ])

      if (t1Error) console.error('[fetchData] team1 error:', t1Error)
      if (t2Error) console.error('[fetchData] team2 error:', t2Error)

      const { data: gameData, error: gameError } = await supabase
        .from('match_games')
        .select('*')
        .eq('match_id', matchId)
        .order('order_no', { ascending: true })

      if (gameError) {
        console.error('[fetchData] games error:', gameError)
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()

      let matchedTeamId: string | null = null

      if (session?.user) {
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', session.user.id)
          .maybeSingle()

        if (userError) {
          console.error('[fetchData] user error:', userError)
        }

        if (user?.id) {
          const { data: members, error: memberError } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('user_id', user.id)

          if (memberError) {
            console.error('[fetchData] memberError:', memberError)
          }

          matchedTeamId =
            members?.find(
              (m) =>
                m.team_id === matchData.team1_id || m.team_id === matchData.team2_id,
            )?.team_id || null
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
        console.error('[fetchData] report error:', reportError)
      }

      console.log('[report-page debug]', {
        matchId,
        matchStatus: matchData?.status,
        myTeamId: matchedTeamId,
        latestReportId: report?.id ?? null,
        latestReportReporterTeamId: report?.reporter_team_id ?? null,
        latestReportApprovalStatus: report?.approval_status ?? null,
      })

      if (!mountedRef.current) return

      setMatch(matchData as MatchRow)
      setTeam1((t1 || null) as TeamRow | null)
      setTeam2((t2 || null) as TeamRow | null)
      setGames((gameData || []) as MatchGameRow[])
      setMyTeamId(matchedTeamId)
      setLatestReport((report || null) as MatchReportRow | null)
      setLoading(false)
    } finally {
      fetchingRef.current = false
    }
  }, [matchId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!matchId) return

    if (realtimeRef.current) {
      supabase.removeChannel(realtimeRef.current)
      realtimeRef.current = null
    }

    const channel = supabase
      .channel(`match-report-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        async () => {
          console.log('realtime: matches changed')
          await fetchData()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_reports',
          filter: `match_id=eq.${matchId}`,
        },
        async () => {
          console.log('realtime: match_reports changed')
          await fetchData()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_games',
          filter: `match_id=eq.${matchId}`,
        },
        async () => {
          console.log('realtime: match_games changed')
          await fetchData()
        },
      )
      .subscribe((status) => {
        console.log('realtime status:', status)
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
    if (match?.status === 'completed') return

    pollingRef.current = setInterval(() => {
      void fetchData()
    }, 3000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [matchId, match?.status, fetchData])

  useEffect(() => {
    const onFocus = () => {
      void fetchData()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchData()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchData])

  const getApprovalSummary = () => {
    if (!match || !team1 || !team2) {
      return {
        title: '確認中',
        body: '試合情報を読み込み中です。',
      }
    }

    if (match.status === 'completed') {
      return {
        title: '試合確定済み',
        body: 'この試合は承認済みで、結果とレートが確定しています。',
      }
    }

    if (!latestReport) {
      return {
        title: '未報告',
        body: 'まだどちらのチームからも結果報告がありません。',
      }
    }

    const reporterName = getTeamName(latestReport.reporter_team_id)

    if (latestReport.approval_status === 'rejected') {
      return {
        title: '報告却下',
        body: `${reporterName} の報告は却下されました。再報告してください。`,
      }
    }

    if (latestReport.approval_status === 'pending') {
      if (myTeamId && latestReport.reporter_team_id === myTeamId) {
        const opponentId = myTeamId === team1.id ? team2.id : team1.id
        return {
          title: '相手チームの承認待ち',
          body: `あなたのチームが報告済みです。${getTeamName(opponentId)} の承認を待っています。`,
        }
      }

      return {
        title: 'あなたの承認待ち',
        body: `${reporterName} が結果を報告しています。内容を確認して承認または却下してください。`,
      }
    }

    if (latestReport.approval_status === 'approved') {
      return {
        title: '承認済み',
        body: '報告は承認済みです。',
      }
    }

    return {
      title: '確認中',
      body: '現在の状態を確認中です。',
    }
  }

  const handleReport = async () => {
    if (!team1 || !team2 || !myTeamId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    if (!hpWinner || !sndWinner) {
      showToast('Hardpoint と S&D の勝者を選択してください', 'error')
      return
    }

    if (match?.status === 'completed') {
      showToast('この試合はすでに完了しています', 'error')
      return
    }

    const overloadRequired = hpWinner !== sndWinner

    if (overloadRequired && !ovWinner) {
      showToast('1-1 の場合は Overload の勝者を選択してください', 'error')
      return
    }

    setSaving(true)

    const { error } = await supabase.rpc('submit_match_report_atomic', {
      p_match_id: matchId,
      p_reporter_team_id: myTeamId,
      p_hp_winner_team_id: hpWinner,
      p_snd_winner_team_id: sndWinner,
      p_ov_winner_team_id: overloadRequired ? ovWinner : null,
    })

    if (error) {
      console.error('submit_match_report_atomic error:', error)
      showToast('報告に失敗しました', 'error')
      setSaving(false)
      return
    }

    showToast('結果を報告しました。相手チームの承認待ちです。', 'success')
    setSaving(false)
    setHpWinner('')
    setSndWinner('')
    setOvWinner('')
    await fetchData()
  }

  const handleApprove = async () => {
    if (!latestReport || !myTeamId) {
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
    await fetchData()
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

    const ok = window.confirm('この結果報告を却下しますか？')
    if (!ok) return

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
    await fetchData()
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
        <h1>結果報告</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  if (!match) {
    return (
      <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
        <h1>結果報告</h1>
        <p>試合が見つかりません</p>
        <button onClick={() => router.push('/history')}>履歴へ戻る</button>
      </main>
    )
  }

  const approvalSummary = getApprovalSummary()

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
      <h1>結果報告</h1>
      <p>試合結果の報告、承認、却下を行います</p>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => router.push('/mypage')}>
          マイページに戻る
        </button>

        <button onClick={() => router.push(`/match/${matchId}/banpick`)}>
          バンピックへ
        </button>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>承認ステータス</h2>
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            marginTop: 8,
          }}
        >
          <div style={{ fontWeight: 700 }}>{approvalSummary.title}</div>
          <div style={{ marginTop: 6 }}>{approvalSummary.body}</div>
        </div>
      </section>

      {match.status === 'completed' && (
        <section style={{ marginTop: 24 }}>
          <h2>試合結果</h2>

          <div style={{ marginTop: 12 }}>
            <div>勝者</div>
            <h3>{getTeamName(match.winner_team_id)}</h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>敗者</div>
            <h3>{getTeamName(match.loser_team_id)}</h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>{team1?.name} レート</div>
            <h3>
              {match.team1_rating_before ?? '-'} → {match.team1_rating_after ?? '-'}
            </h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>{team2?.name} レート</div>
            <h3>
              {match.team2_rating_before ?? '-'} → {match.team2_rating_after ?? '-'}
            </h3>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3>各ゲーム結果</h3>
            {games.length === 0 ? (
              <p>ゲーム結果がありません</p>
            ) : (
              games.map((game) => (
                <div
                  key={game.id}
                  style={{
                    border: '1px solid #ddd',
                    borderRadius: 8,
                    padding: 12,
                    marginTop: 8,
                  }}
                >
                  <div>Game {game.order_no}</div>
                  <div>モード: {getModeLabel(game.mode)}</div>
                  <div>勝者: {getTeamName(game.winner_team_id)}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => router.push('/mypage')}>
              マイページに戻る
            </button>

            <button onClick={() => router.push('/history')}>
              履歴へ
            </button>
          </div>
        </section>
      )}

      {latestReport && match.status !== 'completed' && (
        <section style={{ marginTop: 24 }}>
          <h2>最新の報告内容</h2>

          <div style={{ marginTop: 12 }}>
            <div>報告チーム</div>
            <h3>{getTeamName(latestReport.reporter_team_id)}</h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>報告勝者</div>
            <h3>{getTeamName(latestReport.reported_winner_team_id)}</h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>Hardpoint</div>
            <h3>{getTeamName(latestReport.hp_winner_team_id)}</h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>S&amp;D</div>
            <h3>{getTeamName(latestReport.snd_winner_team_id)}</h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>Overload</div>
            <h3>
              {latestReport.ov_winner_team_id
                ? getTeamName(latestReport.ov_winner_team_id)
                : '未実施'}
            </h3>
          </div>

          <div style={{ marginTop: 12 }}>
            <div>承認状態</div>
            <h3>{latestReport.approval_status}</h3>
          </div>

          {myTeamId &&
            latestReport.reporter_team_id !== myTeamId &&
            latestReport.approval_status === 'pending' && (
              <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <button onClick={handleApprove} disabled={approving || rejecting}>
                  {approving ? '承認中...' : 'この結果を承認する'}
                </button>
                <button onClick={handleReject} disabled={approving || rejecting}>
                  {rejecting ? '却下中...' : 'この結果を却下する'}
                </button>
              </div>
            )}
        </section>
      )}

      {(!latestReport || latestReport.approval_status === 'rejected') &&
        match.status !== 'completed' && (
          <section style={{ marginTop: 24 }}>
            <h2>結果報告</h2>

            <div style={{ marginTop: 12 }}>
              <label>
                Hardpoint 勝者
                <select
                  value={hpWinner}
                  onChange={(e) => setHpWinner(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 8 }}
                >
                  <option value="">選択してください</option>
                  <option value={team1?.id}>{team1?.name}</option>
                  <option value={team2?.id}>{team2?.name}</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>
                S&amp;D 勝者
                <select
                  value={sndWinner}
                  onChange={(e) => setSndWinner(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 8 }}
                >
                  <option value="">選択してください</option>
                  <option value={team1?.id}>{team1?.name}</option>
                  <option value={team2?.id}>{team2?.name}</option>
                </select>
              </label>
            </div>

            {hpWinner && sndWinner && hpWinner === sndWinner ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  background: '#f7f7f7',
                }}
              >
                Hardpoint と S&amp;D で同じチームが勝っているため、Overload の入力は不要です。
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <label>
                  Overload 勝者
                  <select
                    value={ovWinner}
                    onChange={(e) => setOvWinner(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 8 }}
                  >
                    <option value="">選択してください</option>
                    <option value={team1?.id}>{team1?.name}</option>
                    <option value={team2?.id}>{team2?.name}</option>
                  </select>
                </label>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button onClick={handleReport} disabled={saving}>
                {saving ? '送信中...' : '試合結果を報告'}
              </button>
            </div>
          </section>
        )}
    </main>
  )
}