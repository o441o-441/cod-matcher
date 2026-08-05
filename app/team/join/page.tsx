'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type TeamRow = {
  id: string
  name: string
  rating: number
  wins: number
  losses: number
  matches_played: number
}

const MAX_MEMBERS = 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function TeamJoinInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)

  const [teamIdInput, setTeamIdInput] = useState('')
  const [previewTeam, setPreviewTeam] = useState<TeamRow | null>(null)
  const [previewMemberCount, setPreviewMemberCount] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)

  const searchTeam = useCallback(async (rawId: string) => {
    const trimmed = rawId.trim()

    if (!trimmed) {
      showToast('チームIDを入力してください', 'error')
      return
    }
    if (!UUID_RE.test(trimmed)) {
      showToast('チームIDの形式が正しくありません', 'error')
      return
    }

    setSearching(true)
    setPreviewTeam(null)
    setPreviewMemberCount(null)

    const [{ data, error }, { count }] = await Promise.all([
      supabase
        .from('teams')
        .select('id, name, rating, wins, losses, matches_played')
        .eq('id', trimmed)
        .eq('is_disbanded', false)
        .maybeSingle(),
      supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', trimmed),
    ])

    if (error) {
      console.error(error)
      showToast('チーム検索に失敗しました', 'error')
      setSearching(false)
      return
    }

    if (!data) {
      showToast('チームが見つかりません', 'error')
      setSearching(false)
      return
    }

    setPreviewTeam(data)
    setPreviewMemberCount(count ?? null)
    setSearching(false)
  }, [showToast])

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      setMyUserId(session.user.id)

      // 所属チェック: すでにチームにいる場合は参加フォームを出さない
      const { data: membership } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      const currentTeamId = membership?.team_id ?? null
      setMyTeamId(currentTeamId)
      setLoading(false)

      // 招待リンク (?id=xxx) から来た場合は自動で検索
      const inviteId = searchParams.get('id')
      if (inviteId && !currentTeamId && UUID_RE.test(inviteId.trim())) {
        setTeamIdInput(inviteId.trim())
        void searchTeam(inviteId)
      }
    }

    init()
  }, [router, searchParams, searchTeam])

  const handleJoinTeam = async () => {
    if (!myUserId || !previewTeam) {
      showToast('必要な情報が足りません', 'error')
      return
    }

    setJoining(true)

    const { error } = await supabase.rpc('join_team_atomic', {
      p_team_id: previewTeam.id,
      p_user_id: myUserId,
    })

    if (error) {
      console.error(error)
      showToast(error.message || 'チーム参加に失敗しました', 'error')
      setJoining(false)
      return
    }

    showToast('チームに参加しました', 'success')
    router.push(`/team/${previewTeam.id}`)
  }

  if (loading) {
    return (
      <main>
        <div className="eyebrow">JOIN TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Join</em> Team
        </h1>
        <p className="muted">読み込み中...</p>
      </main>
    )
  }

  if (myTeamId) {
    return (
      <main>
        <div className="eyebrow">JOIN TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Join</em> Team
        </h1>

        <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div className="card-strong">
            <div className="sec-title">すでにチームに所属しています</div>
            <p className="muted" style={{ marginTop: 0 }}>
              別のチームに参加するには、先に現在のチームから脱退してください。
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={() => router.push(`/team/${myTeamId}`)}>
                自分のチームを見る
              </button>
              <button className="btn-ghost" onClick={() => router.push('/menu')}>
                メニューへ戻る
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const isFull = previewMemberCount !== null && previewMemberCount >= MAX_MEMBERS

  return (
    <main>
      <div className="eyebrow">JOIN TEAM</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Join</em> Team
      </h1>
      <p className="muted">招待リンクを開くか、チームIDを入力して参加します</p>

      <div className="section" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="card-strong">
          <div className="sec-title">参加するチームを探す</div>

          <div className="stack">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void searchTeam(teamIdInput)
              }}
            >
              <label htmlFor="team-id" className="stat-label">TEAM ID</label>
              <div className="row" style={{ marginTop: 6 }}>
                <input
                  id="team-id"
                  value={teamIdInput}
                  onChange={(e) => setTeamIdInput(e.target.value)}
                  placeholder="チームIDを貼り付け"
                  style={{ flex: 1 }}
                />
                <button type="submit" disabled={searching}>
                  {searching ? '検索中...' : '検索'}
                </button>
              </div>
            </form>

            {previewTeam && (
              <div className="card">
                <div className="g4" style={{ marginBottom: 12 }}>
                  <div className="stat">
                    <span className="stat-label">TEAM NAME</span>
                    <span className="stat-val" style={{ fontSize: 18 }}>{previewTeam.name}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">RATING</span>
                    <span className="stat-val" style={{ fontSize: 18 }}>{previewTeam.rating}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">RECORD</span>
                    <span className="stat-val" style={{ fontSize: 18 }}>{previewTeam.wins}W {previewTeam.losses}L</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">MEMBERS</span>
                    <span className="stat-val" style={{ fontSize: 18 }}>
                      {previewMemberCount ?? '-'}/{MAX_MEMBERS}
                    </span>
                  </div>
                </div>

                {isFull && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                    このチームは満員です（最大{MAX_MEMBERS}人）
                  </p>
                )}

                <button
                  className="btn-primary btn-block"
                  onClick={handleJoinTeam}
                  disabled={joining || isFull}
                >
                  {joining ? '参加中...' : 'このチームに参加'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export default function TeamJoinPage() {
  return (
    <Suspense
      fallback={
        <main>
          <div className="eyebrow">JOIN TEAM</div>
          <h1 className="display" style={{ marginBottom: 8 }}>
            <em>Join</em> Team
          </h1>
          <p className="muted">読み込み中...</p>
        </main>
      }
    >
      <TeamJoinInner />
    </Suspense>
  )
}
