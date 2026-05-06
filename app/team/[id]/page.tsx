'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import ConfirmDialog from '@/components/ConfirmDialog'

type TeamRow = {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  rating?: number
  wins?: number
  losses?: number
  matches_played?: number
}

type UserRow = {
  id: string
  display_name: string | null
}

type TeamMemberRow = {
  id: string
  role: string
  user_id: string
  profiles: {
    display_name: string | null
  } | null
}

type MatchRow = {
  match_id: string
  match_team_id: string
  opponent_team_id: string | null
  opponent_source_team_id: string | null
  is_winner: boolean
  status: string
  completed_at: string | null
}

type TeamNameMap = Record<string, string>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function TeamDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()

  const rawId =
    typeof params.id === 'string'
      ? params.id
      : Array.isArray(params.id)
      ? params.id[0]
      : ''
  const teamId = UUID_RE.test(rawId) ? rawId : ''

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamNames, setTeamNames] = useState<TeamNameMap>({})
  const [loading, setLoading] = useState(true)

  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)

  const [searchName, setSearchName] = useState('')
  const [searchedUser, setSearchedUser] = useState<UserRow | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [removeLoadingId, setRemoveLoadingId] = useState<string | null>(null)

  const [transferLoadingId, setTransferLoadingId] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState<TeamMemberRow | null>(null)

  const [leaveLoading, setLeaveLoading] = useState(false)
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)

  const [disbandLoading, setDisbandLoading] = useState(false)
  const [disbandDialogOpen, setDisbandDialogOpen] = useState(false)

  const canManageTeam = myTeamId === teamId && myRole === 'owner'
  const canLeaveTeam =
    myTeamId === teamId && myRole !== null && myRole !== 'owner'

  const fetchTeam = async () => {
    setLoading(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user) {
      router.push('/login')
      return
    }

    const currentUserId = session.user.id
    setMyUserId(currentUserId)

    const { data: myMembership, error: myMembershipError } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', currentUserId)
      .maybeSingle()

    if (myMembershipError) {
      console.error('myMembershipError:', myMembershipError)
    }

    setMyTeamId(myMembership?.team_id || null)
    setMyRole(myMembership?.role || null)

    const { data: teamData, error: teamError } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (teamError) {
      console.error('teamError:', teamError)
      setLoading(false)
      return
    }

    setTeam(teamData as TeamRow)

    const { data: memberData, error: memberError } = await supabase
      .from('team_members')
      .select(`
        id,
        role,
        user_id,
        profiles (
          display_name
        )
      `)
      .eq('team_id', teamId)

    if (memberError) {
      console.error('memberError:', memberError)
      setLoading(false)
      return
    }

    type RawMember = Omit<TeamMemberRow, 'profiles'> & {
      profiles: TeamMemberRow['profiles'] | TeamMemberRow['profiles'][]
    }
    const normalizedMembers: TeamMemberRow[] = (memberData || []).map((m) => {
      const raw = m as unknown as RawMember
      return {
        ...raw,
        profiles: Array.isArray(raw.profiles) ? raw.profiles[0] ?? null : raw.profiles ?? null,
      }
    })

    setMembers(normalizedMembers)

    // Get matches via match_teams
    const { data: myMatchTeams } = await supabase
      .from('match_teams')
      .select('id, match_id, source_team_id, matches!inner(id, status, completed_at, winner_match_team_id)')
      .eq('source_team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(10)

    const matchList: MatchRow[] = []
    const opponentTeamIds = new Set<string>()

    for (const mt of (myMatchTeams ?? []) as unknown as { id: string; match_id: string; source_team_id: string; matches: { id: string; status: string; completed_at: string | null; winner_match_team_id: string | null } }[]) {
      // Find opponent match_team
      const { data: oppTeams } = await supabase
        .from('match_teams')
        .select('id, source_team_id')
        .eq('match_id', mt.match_id)
        .neq('id', mt.id)
        .limit(1)
      const opp = (oppTeams ?? [])[0] as { id: string; source_team_id: string | null } | undefined
      if (opp?.source_team_id) opponentTeamIds.add(opp.source_team_id)
      matchList.push({
        match_id: mt.match_id,
        match_team_id: mt.id,
        opponent_team_id: opp?.id ?? null,
        opponent_source_team_id: opp?.source_team_id ?? null,
        is_winner: mt.matches.winner_match_team_id === mt.id,
        status: mt.matches.status,
        completed_at: mt.matches.completed_at,
      })
    }
    setMatches(matchList)

    if (opponentTeamIds.size > 0) {
      const { data: teamsData } = await supabase.from('teams').select('id, name').in('id', [...opponentTeamIds])
      const map: TeamNameMap = {}
      for (const item of (teamsData ?? []) as { id: string; name: string }[]) map[item.id] = item.name
      setTeamNames(map)
    }

    setLoading(false)
  }

  useEffect(() => {
    if (!teamId) return
    void Promise.resolve().then(fetchTeam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const handleSearchUser = async () => {
    if (!canManageTeam) {
      showToast('このチームを管理する権限がありません', 'error')
      return
    }

    if (!searchName.trim()) {
      showToast('表示名を入力してください', 'error')
      return
    }

    setSearchLoading(true)
    setSearchedUser(null)

    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('display_name', searchName.trim())
      .maybeSingle()

    if (error) {
      console.error('search error:', error)
      showToast('ユーザー検索に失敗しました', 'error')
      setSearchLoading(false)
      return
    }

    if (!data) {
      showToast('該当ユーザーが見つかりません', 'error')
      setSearchLoading(false)
      return
    }

    setSearchedUser(data as UserRow)
    setSearchLoading(false)
    showToast('ユーザーが見つかりました', 'success')
  }

  const handleAddMember = async () => {
    if (!canManageTeam) {
      showToast('このチームを管理する権限がありません', 'error')
      return
    }

    if (!searchedUser || !myUserId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    setAddLoading(true)

    const { data, error } = await supabase.rpc('add_team_member_atomic', {
      p_team_id: teamId,
      p_target_user_id: searchedUser.id,
      p_actor_user_id: myUserId,
    })

    if (error) {
      console.error('add_team_member_atomic error:', error)
      console.error('message:', error.message)
      console.error('details:', error.details)
      console.error('hint:', error.hint)
      console.error('code:', error.code)
      showToast('メンバー追加に失敗しました', 'error')
      setAddLoading(false)
      return
    }

    console.log('add member result:', data)
    showToast('メンバーを追加しました', 'success')
    setSearchedUser(null)
    setSearchName('')
    await fetchTeam()
    setAddLoading(false)
  }

  const handleRemoveMember = async (member: TeamMemberRow) => {
    if (!canManageTeam) {
      showToast('このチームを管理する権限がありません', 'error')
      return
    }

    if (!myUserId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    const ok = window.confirm(
      `${member.profiles?.display_name || 'このユーザー'} をチームから削除しますか？`
    )
    if (!ok) return

    setRemoveLoadingId(member.id)

    const { data, error } = await supabase.rpc('remove_team_member_atomic', {
      p_team_member_id: member.id,
      p_actor_user_id: myUserId,
    })

    if (error) {
      console.error('remove_team_member_atomic error:', error)
      console.error('message:', error.message)
      console.error('details:', error.details)
      console.error('hint:', error.hint)
      console.error('code:', error.code)
      showToast('メンバー削除に失敗しました', 'error')
      setRemoveLoadingId(null)
      return
    }

    console.log('remove member result:', data)
    showToast('メンバーを削除しました', 'success')
    await fetchTeam()
    setRemoveLoadingId(null)
  }

  const handleTransferOwner = async (member: TeamMemberRow) => {
    if (!canManageTeam) {
      showToast('このチームを管理する権限がありません', 'error')
      return
    }

    if (!myUserId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    setTransferLoadingId(member.id)

    const { data, error } = await supabase.rpc('transfer_team_owner_atomic', {
      p_team_id: teamId,
      p_new_owner_user_id: member.user_id,
      p_actor_user_id: myUserId,
    })

    if (error) {
      console.error('transfer_team_owner_atomic error:', error)
      console.error('message:', error.message)
      console.error('details:', error.details)
      console.error('hint:', error.hint)
      console.error('code:', error.code)
      showToast(error.message || 'owner譲渡に失敗しました', 'error')
      setTransferLoadingId(null)
      return
    }

    console.log('transfer owner result:', data)
    showToast('ownerを譲渡しました', 'success')
    setTransferTarget(null)
    await fetchTeam()
    setTransferLoadingId(null)
  }

  const handleLeaveTeam = async () => {
    if (!myUserId || !teamId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    setLeaveLoading(true)

    const { data, error } = await supabase.rpc('leave_team_atomic', {
      p_team_id: teamId,
      p_actor_user_id: myUserId,
    })

    if (error) {
      console.error('leave_team_atomic error:', error)
      console.error('message:', error.message)
      console.error('details:', error.details)
      console.error('hint:', error.hint)
      console.error('code:', error.code)
      showToast(error.message || 'チーム脱退に失敗しました', 'error')
      setLeaveLoading(false)
      return
    }

    console.log('leave team result:', data)
    showToast('チームから脱退しました', 'success')
    setLeaveLoading(false)
    setLeaveDialogOpen(false)
    router.push('/menu')
  }

  const handleDisbandTeam = async () => {
    if (!team || !myUserId) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    setDisbandLoading(true)

    const { data, error } = await supabase.rpc('disband_team_atomic', {
      p_team_id: team.id,
      p_actor_user_id: myUserId,
    })

    if (error) {
      console.error('disband_team_atomic error:', error)
      console.error('message:', error.message)
      console.error('details:', error.details)
      console.error('hint:', error.hint)
      console.error('code:', error.code)
      showToast(error.message || 'チーム解散に失敗しました', 'error')
      setDisbandLoading(false)
      return
    }

    console.log('disband team result:', data)
    showToast('チームを解散しました', 'success')
    setDisbandLoading(false)
    setDisbandDialogOpen(false)
    router.push('/menu')
  }

  const getOpponentName = (match: MatchRow) => {
    if (!match.opponent_source_team_id) return '不明'
    return teamNames[match.opponent_source_team_id] ?? '不明'
  }

  const getResultText = (match: MatchRow) => {
    if (match.status !== 'completed') return '未完了'
    return match.is_winner ? '勝ち' : '負け'
  }

  const getResultClass = (match: MatchRow) => {
    if (match.status !== 'completed') return 'muted'
    return match.is_winner ? 'success' : 'danger'
  }

  if (loading) {
    return (
      <main>
        <div className="eyebrow">TEAM DETAIL</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Team</em>
        </h1>
        <p className="muted">読み込み中...</p>
      </main>
    )
  }

  return (
    <>
      <main>
        <div className="eyebrow">TEAM DETAIL</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          {team?.name ?? <em>Team</em>}
        </h1>
        <p className="muted">チーム情報、メンバー、最近の試合を確認できます</p>

        {/* Team stats */}
        <div className="section">
          <div className="card-strong">
            <div className="rowx">
              <div className="sec-title">チーム情報</div>
              <span className={canManageTeam ? 'badge success' : 'badge'}>
                <span className="badge-dot" />
                {canManageTeam ? 'OWNER' : 'VIEW'}
              </span>
            </div>

            <div className="g4" style={{ marginTop: 16 }}>
              <div className="stat">
                <span className="stat-label">TEAM NAME</span>
                <span className="stat-val">{team?.name}</span>
              </div>
              <div className="stat">
                <span className="stat-label">RATING</span>
                <span className="stat-val">{team?.rating ?? '-'}</span>
              </div>
              <div className="stat">
                <span className="stat-label">RECORD</span>
                <span className="stat-val">{team?.wins ?? 0}W {team?.losses ?? 0}L</span>
              </div>
              <div className="stat">
                <span className="stat-label">MATCHES</span>
                <span className="stat-val">{team?.matches_played ?? 0}</span>
              </div>
            </div>

            <div className="div" />

            <div className="stat">
              <span className="stat-label">TEAM ID</span>
              <span className="mono" style={{ fontSize: 13, color: 'var(--text-soft)', wordBreak: 'break-all' }}>
                {team?.id}
              </span>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <button
                className="btn-sm"
                onClick={async () => {
                  if (!team?.id) return
                  await navigator.clipboard.writeText(team.id)
                  showToast('チームIDをコピーしました', 'success')
                }}
              >
                IDをコピー
              </button>

              {canManageTeam && (
                <>
                  <button className="btn-sm" onClick={() => router.push('/team/edit')}>
                    チーム名を編集
                  </button>
                  <button className="btn-sm btn-danger" onClick={() => setDisbandDialogOpen(true)}>
                    チームを解散
                  </button>
                </>
              )}

              {canLeaveTeam && (
                <button className="btn-sm btn-danger" onClick={() => setLeaveDialogOpen(true)}>
                  チームから脱退
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Members */}
        <div className="section">
          <div className="card-strong">
            <div className="sec-title">メンバー</div>

            {members.length === 0 ? (
              <p className="muted">メンバーがいません</p>
            ) : (
              <div className="stack">
                {members.map((member) => {
                  const isSelf = member.user_id === myUserId
                  const canTransfer =
                    canManageTeam && !isSelf && member.role !== 'owner'
                  const canRemove =
                    canManageTeam && member.role !== 'owner'

                  return (
                    <div key={member.id} className="card">
                      <div className="row">
                        <div className="avatar">
                          {(member.profiles?.display_name || '?')[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>
                            {member.profiles?.display_name || '未設定'}
                          </div>
                          <span className="badge" style={{ marginTop: 4 }}>
                            <span className="badge-dot" />
                            {member.role.toUpperCase()}
                          </span>
                        </div>

                        {(canTransfer || canRemove) && (
                          <div className="row">
                            {canTransfer && (
                              <button
                                className="btn-sm btn-ghost"
                                onClick={() => setTransferTarget(member)}
                                disabled={transferLoadingId === member.id}
                              >
                                {transferLoadingId === member.id
                                  ? '譲渡中...'
                                  : 'owner譲渡'}
                              </button>
                            )}

                            {canRemove && (
                              <button
                                className="btn-sm btn-danger"
                                onClick={() => handleRemoveMember(member)}
                                disabled={removeLoadingId === member.id}
                              >
                                {removeLoadingId === member.id
                                  ? '削除中...'
                                  : '削除'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Add member */}
        {canManageTeam && (
          <div className="section">
            <div className="card-strong">
              <div className="sec-title">メンバー追加</div>

              <div className="row">
                <input
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  placeholder="追加したいユーザーの表示名"
                  style={{ flex: 1 }}
                />
                <button onClick={handleSearchUser} disabled={searchLoading}>
                  {searchLoading ? '検索中...' : '検索'}
                </button>
              </div>

              {searchedUser && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="row">
                    <div className="avatar">
                      {(searchedUser.display_name || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, fontWeight: 700 }}>
                      {searchedUser.display_name}
                    </div>
                    <button className="btn-primary btn-sm" onClick={handleAddMember} disabled={addLoading}>
                      {addLoading ? '追加中...' : '追加'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recent matches */}
        <div className="section">
          <div className="card-strong">
            <div className="sec-title">最近の試合</div>

            {matches.length === 0 ? (
              <p className="muted">まだ試合履歴がありません</p>
            ) : (
              <div className="stack">
                {matches.map((match) => {
                  const opponentName = getOpponentName(match)
                  const resultText = getResultText(match)
                  const resultClass = getResultClass(match)

                  return (
                    <div
                      key={match.match_id}
                      className="card glow-hover"
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/match/${match.match_id}`)}
                    >
                      <div className="rowx">
                        <div>
                          <div style={{ fontWeight: 700 }}>vs {opponentName}</div>
                          <span className={`badge ${resultClass === 'success' ? 'success' : resultClass === 'danger' ? 'danger' : ''}`} style={{ marginTop: 4 }}>
                            <span className="badge-dot" />
                            {resultText}
                          </span>
                        </div>
                        {match.completed_at && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {new Date(match.completed_at).toLocaleString('ja-JP')}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={disbandDialogOpen}
        title="チームを解散しますか？"
        message="この操作は取り消せません。"
        confirmText={disbandLoading ? '解散中...' : '解散する'}
        cancelText="キャンセル"
        onConfirm={handleDisbandTeam}
        onCancel={() => {
          if (!disbandLoading) setDisbandDialogOpen(false)
        }}
      />

      <ConfirmDialog
        open={!!transferTarget}
        title="ownerを譲渡しますか？"
        message={
          transferTarget
            ? `${transferTarget.profiles?.display_name || 'このメンバー'} にowner権限を譲渡します。実行後、あなたはmemberになります。`
            : ''
        }
        confirmText={
          transferTarget && transferLoadingId === transferTarget.id
            ? '譲渡中...'
            : '譲渡する'
        }
        cancelText="キャンセル"
        onConfirm={async () => {
          if (!transferTarget) return
          await handleTransferOwner(transferTarget)
        }}
        onCancel={() => {
          if (!transferLoadingId) setTransferTarget(null)
        }}
      />

      <ConfirmDialog
        open={leaveDialogOpen}
        title="チームから脱退しますか？"
        message="この操作を行うと、このチームのメンバーではなくなります。"
        confirmText={leaveLoading ? '脱退中...' : '脱退する'}
        cancelText="キャンセル"
        onConfirm={handleLeaveTeam}
        onCancel={() => {
          if (!leaveLoading) setLeaveDialogOpen(false)
        }}
      />
    </>
  )
}
