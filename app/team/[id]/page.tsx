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
  activision_id: string | null
}

type TeamMemberRow = {
  id: string
  role: string
  user_id: string
  users: {
    display_name: string | null
    activision_id: string | null
  } | null
}

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  winner_team_id: string | null
  loser_team_id: string | null
  status: string
  created_at: string
  team1_rating_before: number | null
  team2_rating_before: number | null
  team1_rating_after: number | null
  team2_rating_after: number | null
}

type TeamNameMap = Record<string, string>

export default function TeamDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()

  const teamId =
    typeof params.id === 'string'
      ? params.id
      : Array.isArray(params.id)
      ? params.id[0]
      : ''

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
  const [disbandLoading, setDisbandLoading] = useState(false)
  const [disbandDialogOpen, setDisbandDialogOpen] = useState(false)

  const canManageTeam = myTeamId === teamId && myRole === 'owner'

  const fetchTeam = async () => {
    setLoading(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.user) {
      router.push('/login')
      return
    }

    const { data: currentUser, error: currentUserError } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', session.user.id)
      .single()

    if (currentUserError || !currentUser) {
      console.error('currentUserError:', currentUserError)
      router.push('/mypage')
      return
    }

    setMyUserId(currentUser.id)

    const { data: myMembership, error: myMembershipError } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', currentUser.id)
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

    setTeam(teamData)

    const { data: memberData, error: memberError } = await supabase
      .from('team_members')
      .select(`
        id,
        role,
        user_id,
        users (
          display_name,
          activision_id
        )
      `)
      .eq('team_id', teamId)

    if (memberError) {
      console.error('memberError:', memberError)
      setLoading(false)
      return
    }

    const normalizedMembers = (memberData || []).map((m: any) => ({
      ...m,
      users: Array.isArray(m.users) ? m.users[0] : m.users || null,
    })) as TeamMemberRow[]

    setMembers(normalizedMembers)

    const { data: matchData, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .or(`team1_id.eq.${teamId},team2_id.eq.${teamId}`)
      .order('created_at', { ascending: false })
      .limit(10)

    if (matchError) {
      console.error('matchError:', matchError)
    }

    const matchList = (matchData || []) as MatchRow[]
    setMatches(matchList)

    const uniqueTeamIds = Array.from(
      new Set(matchList.flatMap((match) => [match.team1_id, match.team2_id]))
    )

    if (uniqueTeamIds.length > 0) {
      const { data: teamsData, error: teamsError } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', uniqueTeamIds)

      if (teamsError) {
        console.error('teamsError:', teamsError)
      } else {
        const map: TeamNameMap = {}
        for (const item of teamsData || []) {
          map[item.id] = item.name
        }
        setTeamNames(map)
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    if (!teamId) return
    fetchTeam()
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
      .from('users')
      .select('id, display_name, activision_id')
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

    setSearchedUser(data)
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
      `${member.users?.display_name || 'このユーザー'} をチームから削除しますか？`
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
    router.push('/mypage')
  }

  const getOpponentId = (match: MatchRow) => {
    return match.team1_id === teamId ? match.team2_id : match.team1_id
  }

  const getResultText = (match: MatchRow) => {
    if (match.status !== 'completed') return '未完了'
    if (match.winner_team_id === teamId) return '勝ち'
    if (match.loser_team_id === teamId) return '負け'
    return '不明'
  }

  const getResultClass = (match: MatchRow) => {
    if (match.status !== 'completed') return 'muted'
    if (match.winner_team_id === teamId) return 'success'
    if (match.loser_team_id === teamId) return 'danger'
    return 'muted'
  }

  const getMyRatingBefore = (match: MatchRow) => {
    return match.team1_id === teamId
      ? match.team1_rating_before
      : match.team2_rating_before
  }

  const getMyRatingAfter = (match: MatchRow) => {
    return match.team1_id === teamId
      ? match.team1_rating_after
      : match.team2_rating_after
  }

  if (loading) {
    return (
      <main>
        <h1>チーム詳細</h1>
        <div className="card">
          <p>読み込み中...</p>
        </div>
      </main>
    )
  }

  return (
    <>
      <main>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>チーム詳細</h1>
            <p className="muted">チーム情報、メンバー、最近の試合を確認できます</p>
          </div>

          <div className="row">
            <button onClick={() => router.push('/mypage')}>マイページへ戻る</button>
          </div>
        </div>

        <div className="section card-strong">
          <h2>チーム情報</h2>

          <div className="row" style={{ marginBottom: '12px' }}>
            <span className="badge">{canManageTeam ? 'owner権限あり' : '閲覧のみ'}</span>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <p className="muted">チーム名</p>
              <h3>{team?.name}</h3>
            </div>

            <div className="card">
              <p className="muted">レート</p>
              <h3>{team?.rating ?? '-'}</h3>
            </div>

            <div className="card">
              <p className="muted">戦績</p>
              <h3>
                {team?.wins ?? 0}勝 {team?.losses ?? 0}敗
              </h3>
            </div>

            <div className="card">
              <p className="muted">試合数</p>
              <h3>{team?.matches_played ?? 0}</h3>
            </div>

            <div className="card">
              <p className="muted">チームID</p>
              <h3 style={{ wordBreak: 'break-all' }}>{team?.id}</h3>

              <div className="section row">
                <button
                  onClick={async () => {
                    if (!team?.id) return
                    await navigator.clipboard.writeText(team.id)
                    showToast('チームIDをコピーしました', 'success')
                  }}
                >
                  チームIDをコピー
                </button>
              </div>
            </div>
          </div>

          {canManageTeam && (
            <div className="section row">
              <button onClick={() => router.push('/team/edit')}>
                チーム名を編集
              </button>
              <button onClick={() => setDisbandDialogOpen(true)}>
                チームを解散
              </button>
            </div>
          )}
        </div>

        <div className="section card-strong">
          <h2>メンバー</h2>

          {members.length === 0 ? (
            <p>メンバーがいません</p>
          ) : (
            <div className="stack">
              {members.map((member) => (
                <div key={member.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <p>
                        <strong>名前:</strong> {member.users?.display_name || '未設定'}
                      </p>
                      <p>
                        <strong>Activision ID:</strong>{' '}
                        {member.users?.activision_id || '未設定'}
                      </p>
                      <p>
                        <strong>役割:</strong> {member.role}
                      </p>
                    </div>

                    {canManageTeam && member.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(member)}
                        disabled={removeLoadingId === member.id}
                      >
                        {removeLoadingId === member.id ? '削除中...' : 'メンバー削除'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {canManageTeam && (
          <div className="section card-strong">
            <h2>メンバー追加</h2>

            <div className="row">
              <input
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="追加したいユーザーの表示名"
              />

              <button onClick={handleSearchUser} disabled={searchLoading}>
                {searchLoading ? '検索中...' : '検索'}
              </button>
            </div>

            {searchedUser && (
              <div className="section card">
                <p>
                  <strong>名前:</strong> {searchedUser.display_name}
                </p>
                <p>
                  <strong>Activision ID:</strong>{' '}
                  {searchedUser.activision_id || '未設定'}
                </p>

                <div className="section row">
                  <button onClick={handleAddMember} disabled={addLoading}>
                    {addLoading ? '追加中...' : 'このユーザーを追加'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="section card-strong">
          <h2>最近の試合</h2>

          {matches.length === 0 ? (
            <p>まだ試合履歴がありません</p>
          ) : (
            <div className="stack">
              {matches.map((match) => {
                const opponentId = getOpponentId(match)
                const opponentName = teamNames[opponentId] || '不明'
                const resultText = getResultText(match)
                const resultClass = getResultClass(match)
                const myBefore = getMyRatingBefore(match)
                const myAfter = getMyRatingAfter(match)
                const ratingDiff =
                  myBefore != null && myAfter != null ? myAfter - myBefore : null

                return (
                  <div key={match.id} className="card">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <p>
                          <strong>対戦相手:</strong> {opponentName}
                        </p>
                        <p className={resultClass}>
                          <strong>結果:</strong> {resultText}
                        </p>
                        <p>
                          <strong>状態:</strong> {match.status}
                        </p>
                        <p>
                          <strong>日時:</strong>{' '}
                          {new Date(match.created_at).toLocaleString()}
                        </p>
                        <p>
                          <strong>レート:</strong> {myBefore ?? '-'} → {myAfter ?? '-'}
                          {ratingDiff !== null && (
                            <>
                              {' '}
                              ({ratingDiff >= 0 ? '+' : ''}
                              {ratingDiff})
                            </>
                          )}
                        </p>
                      </div>

                      <div className="row">
                        <button onClick={() => router.push(`/match/${match.id}`)}>
                          試合詳細を見る
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={disbandDialogOpen}
        title="チームを解散"
        message="このチームを解散しますか？ メンバーは全員チームから外れます。未完了の試合がある場合は解散できません。"
        confirmText="解散する"
        cancelText="戻る"
        danger
        loading={disbandLoading}
        onConfirm={handleDisbandTeam}
        onCancel={() => {
          if (!disbandLoading) setDisbandDialogOpen(false)
        }}
      />
    </>
  )
}