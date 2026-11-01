'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

const MAX_NAME_LEN = 30
const MAX_GUEST_IDS = 6
const MAX_GUEST_ID_LEN = 40

export default function CreateTeamPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [teamName, setTeamName] = useState('')
  const [rosterMode, setRosterMode] = useState<'members' | 'solo'>('members')
  const [guestIds, setGuestIds] = useState<string[]>(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [existingTeamId, setExistingTeamId] = useState<string | null>(null)

  useEffect(() => {
    const checkExistingTeam = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      const authUserId = session.user.id
      setMyUserId(authUserId)

      const { data: existingMembership, error: membershipError } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', authUserId)
        .maybeSingle()

      if (membershipError) {
        console.error('membershipError:', membershipError)
        showToast('所属チームの確認に失敗しました', 'error')
        setChecking(false)
        return
      }

      setExistingTeamId(existingMembership?.team_id ?? null)
      setChecking(false)
    }

    checkExistingTeam()
  }, [router, showToast])

  const handleCreateTeam = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = teamName.trim()

    if (trimmed.length < 2) {
      showToast('チーム名は2文字以上で入力してください', 'error')
      return
    }
    if (trimmed.length > MAX_NAME_LEN) {
      showToast(`チーム名は${MAX_NAME_LEN}文字以内にしてください`, 'error')
      return
    }
    if (!myUserId) {
      showToast('ユーザー情報が取得できません', 'error')
      return
    }

    const cleanGuests = guestIds.map(g => g.trim()).filter(Boolean)
    if (rosterMode === 'solo') {
      if (cleanGuests.length < 3) {
        showToast('メンバーのゲームIDを3人分以上入力してください', 'error')
        return
      }
      if (new Set(cleanGuests).size !== cleanGuests.length) {
        showToast('同じゲームIDが重複しています', 'error')
        return
      }
    }

    setLoading(true)

    const { data, error } = rosterMode === 'solo'
      ? await supabase.rpc('rpc_create_solo_team', {
          p_team_name: trimmed,
          p_guest_ids: cleanGuests,
        })
      : await supabase.rpc('create_team_atomic', {
          p_team_name: trimmed,
          p_owner_user_id: myUserId,
        })

    if (error) {
      console.error('create team error:', error)
      showToast(error.message || 'チーム作成に失敗しました', 'error')
      setLoading(false)
      return
    }

    showToast(
      rosterMode === 'solo'
        ? 'チームを作成しました！あなたの予定入力だけで交流戦・大会に参加できます'
        : 'チームを作成しました！次はメンバーを招待しましょう',
      'success'
    )
    const teamId = (data as { team_id?: string } | null)?.team_id
    router.push(teamId ? `/team/${teamId}` : '/menu')
  }

  if (checking) {
    return (
      <main>
        <div className="eyebrow">CREATE TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Create</em> Team
        </h1>
        <p className="muted">確認中...</p>
      </main>
    )
  }

  if (existingTeamId) {
    return (
      <main>
        <div className="eyebrow">CREATE TEAM</div>
        <h1 className="display" style={{ marginBottom: 8 }}>
          <em>Create</em> Team
        </h1>

        <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div className="card-strong">
            <div className="sec-title">すでにチームに所属しています</div>
            <p className="muted" style={{ marginTop: 0 }}>
              新しいチームを作成するには、先に現在のチームから脱退してください。
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={() => router.push(`/team/${existingTeamId}`)}>
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

  return (
    <main>
      <div className="eyebrow">CREATE TEAM</div>
      <h1 className="display" style={{ marginBottom: 8 }}>
        <em>Create</em> Team
      </h1>
      <p className="muted">新しいチームを作成します</p>

      <div className="section" style={{ maxWidth: 600, margin: '0 auto' }}>
        <form className="card-strong" onSubmit={handleCreateTeam}>
          <div className="sec-title">チーム情報</div>

          <div className="stack">
            <div>
              <div className="rowx">
                <label htmlFor="team-name" className="stat-label">TEAM NAME</label>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {teamName.trim().length}/{MAX_NAME_LEN}
                </span>
              </div>
              <input
                id="team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="チーム名を入力（2〜30文字）"
                maxLength={MAX_NAME_LEN}
                style={{ marginTop: 6 }}
              />
            </div>

            <div>
              <div className="stat-label">運用方法</div>
              <div className="stack" style={{ marginTop: 6, gap: 8 }}>
                <label
                  className="card"
                  style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start', borderColor: rosterMode === 'members' ? 'var(--accent)' : undefined }}
                >
                  <input
                    type="radio"
                    name="roster-mode"
                    checked={rosterMode === 'members'}
                    onChange={() => setRosterMode('members')}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <b>メンバー登録型</b>（最大5人）
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      メンバーをASCENTに招待して登録。各自が交流戦の空き時間を入力します
                    </span>
                  </span>
                </label>
                <label
                  className="card"
                  style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start', borderColor: rosterMode === 'solo' ? 'var(--accent)' : undefined }}
                >
                  <input
                    type="radio"
                    name="roster-mode"
                    checked={rosterMode === 'solo'}
                    onChange={() => setRosterMode('solo')}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <b>代表者のみ型</b>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      ASCENTに登録するのは代表のあなただけ。メンバーはゲームIDを登録するだけでOK（ASCENT登録不要）。
                      あなた1人の予定入力が4人分として扱われ、交流戦・大会に参加できます
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {rosterMode === 'solo' && (
              <div>
                <div className="rowx">
                  <div className="stat-label">メンバーのゲームID（3人分以上）</div>
                  {guestIds.length < MAX_GUEST_IDS && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontSize: 12, padding: '2px 10px' }}
                      onClick={() => setGuestIds([...guestIds, ''])}
                    >
                      ＋ 追加
                    </button>
                  )}
                </div>
                <div className="stack" style={{ marginTop: 6, gap: 6 }}>
                  {guestIds.map((g, i) => (
                    <div key={i} className="row" style={{ gap: 6 }}>
                      <input
                        value={g}
                        onChange={(e) => {
                          const next = [...guestIds]
                          next[i] = e.target.value
                          setGuestIds(next)
                        }}
                        placeholder={`メンバー${i + 2}のゲームID`}
                        maxLength={MAX_GUEST_ID_LEN}
                        style={{ flex: 1 }}
                      />
                      {guestIds.length > 3 && (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '2px 10px' }}
                          onClick={() => setGuestIds(guestIds.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  あなた＋ここに登録したメンバーでチームのロスターになります。後から変更できます
                </p>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary btn-block btn-lg"
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              {loading ? '作成中...' : 'チームを作成'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
