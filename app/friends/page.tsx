'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type FriendRow = {
  friendship_id: string
  friend_user_id: string
  friend_display_name: string | null
  accepted_at: string | null
}

type IncomingRequestRow = {
  friendship_id: string
  requester_user_id: string
  requester_display_name: string | null
  created_at: string
}

type SentRequestRow = {
  friendship_id: string
  target_user_id: string
  target_display_name: string | null
  created_at: string
}

export default function FriendsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [incoming, setIncoming] = useState<IncomingRequestRow[]>([])
  const [sent, setSent] = useState<SentRequestRow[]>([])

  const [searchName, setSearchName] = useState('')
  const [sending, setSending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('friends_guide_dismissed')) {
      setShowGuide(true)
    }
  }, [])

  const fetchAll = async () => {
    const [friendsRes, incomingRes, sentRes] = await Promise.all([
      supabase.rpc('rpc_list_my_friends'),
      supabase.rpc('rpc_list_my_pending_friend_requests'),
      supabase.rpc('rpc_list_my_sent_friend_requests'),
    ])

    if (friendsRes.error) {
      console.error('list friends error:', friendsRes.error)
      showToast('フレンド一覧の取得に失敗しました', 'error')
    } else {
      setFriends((friendsRes.data ?? []) as FriendRow[])
    }

    if (incomingRes.error) {
      console.error('list incoming error:', incomingRes.error)
    } else {
      setIncoming((incomingRes.data ?? []) as IncomingRequestRow[])
    }

    if (sentRes.error) {
      console.error('list sent error:', sentRes.error)
    } else {
      setSent((sentRes.data ?? []) as SentRequestRow[])
    }

    setLoading(false)
  }

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      await fetchAll()
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSendRequest = async () => {
    const name = searchName.trim()
    if (!name) {
      showToast('表示名を入力してください', 'error')
      return
    }
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s?.user) {
      const { data: banCheck } = await supabase.from('profiles').select('is_banned').eq('id', s.user.id).maybeSingle()
      if (banCheck?.is_banned) { showToast('BANされているためフレンド申請できません', 'error'); return }
    }

    setSending(true)
    const { error } = await supabase.rpc('rpc_send_friend_request', {
      p_target_display_name: name,
    })
    setSending(false)

    if (error) {
      console.error('send friend request error:', error)
      showToast(error.message || 'フレンド申請に失敗しました', 'error')
      return
    }

    showToast('フレンド申請を送信しました', 'success')
    setSearchName('')
    await fetchAll()
  }

  const handleAccept = async (friendshipId: string) => {
    setBusyId(friendshipId)
    const { error } = await supabase.rpc('rpc_accept_friend_request', {
      p_friendship_id: friendshipId,
    })
    setBusyId(null)

    if (error) {
      console.error('accept error:', error)
      showToast(error.message || '承認に失敗しました', 'error')
      return
    }

    showToast('フレンド申請を承認しました', 'success')
    await fetchAll()
  }

  const handleReject = async (friendshipId: string) => {
    setBusyId(friendshipId)
    const { error } = await supabase.rpc('rpc_reject_friend_request', {
      p_friendship_id: friendshipId,
    })
    setBusyId(null)

    if (error) {
      console.error('reject error:', error)
      showToast(error.message || '拒否に失敗しました', 'error')
      return
    }

    showToast('フレンド申請を拒否しました', 'info')
    await fetchAll()
  }

  const handleRemove = async (friendUserId: string) => {
    const ok = window.confirm('このフレンドを削除しますか？')
    if (!ok) return

    setBusyId(friendUserId)
    const { error } = await supabase.rpc('rpc_remove_friend', {
      p_friend_user_id: friendUserId,
    })
    setBusyId(null)

    if (error) {
      console.error('remove error:', error)
      showToast(error.message || 'フレンド削除に失敗しました', 'error')
      return
    }

    showToast('フレンドを削除しました', 'info')
    await fetchAll()
  }

  if (loading) {
    return (
      <main>
        <p className="eyebrow">FRIENDS</p>
        <h1 className="display"><em>フレンド</em></h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <p className="eyebrow">FRIENDS</p>
      <h1 className="display"><em>フレンド</em></h1>
      <p className="muted">フレンドの追加・管理ができます</p>

      {showGuide && (
        <div className="section card-strong" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontWeight: 700, marginTop: 0 }}>フレンドの追加方法</p>
              <ol style={{ margin: '8px 0', paddingLeft: 20, lineHeight: 1.8 }}>
                <li>下の「フレンド申請を送る」欄に、追加したい相手の<strong>表示名</strong>を正確に入力</li>
                <li>「申請を送る」ボタンを押す</li>
                <li>相手が「受信した申請」から承認すると、フレンド一覧に追加されます</li>
              </ol>
              <p className="muted" style={{ fontSize: 13 }}>
                表示名はマイページやプロフィール画面で確認できます。大文字・小文字も一致させてください。
              </p>
            </div>
            <button
              className="btn-ghost btn-sm"
              style={{ flexShrink: 0, marginLeft: 12 }}
              onClick={() => {
                localStorage.setItem('friends_guide_dismissed', '1')
                setShowGuide(false)
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="section">
        <p className="sec-title">フレンド申請を送る</p>
        <div className="card-strong">
          <div className="row">
            <input
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="相手の表示名"
              disabled={sending}
            />
            <button className="btn-primary" onClick={handleSendRequest} disabled={sending}>
              {sending ? '送信中...' : '申請を送る'}
            </button>
          </div>
          <p className="muted mt-xs">
            表示名の完全一致で検索します
          </p>
        </div>
      </div>

      <div className="section">
        <p className="sec-title">受信した申請（<span className="mono">{incoming.length}</span>）</p>
        <div className="card-strong">
          {incoming.length === 0 ? (
            <EmptyCard title="受信した申請はありません" message="" />
          ) : (
            <div className="stack">
              {incoming.map((r) => (
                <div key={r.friendship_id} className="card glow-hover">
                  <div className="rowx">
                    <div>
                      <p style={{ margin: 0 }}>
                        <strong>{r.requester_display_name || '(名前未設定)'}</strong>
                      </p>
                      <p className="dim mono" style={{ fontSize: '0.75rem' }}>
                        {new Date(r.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                    <div className="row">
                      <span className="badge">承認待ち</span>
                    </div>
                  </div>
                  <div className="row mt-s">
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => handleAccept(r.friendship_id)}
                      disabled={busyId === r.friendship_id}
                    >
                      承認
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => handleReject(r.friendship_id)}
                      disabled={busyId === r.friendship_id}
                    >
                      拒否
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <p className="sec-title">送信した申請（<span className="mono">{sent.length}</span>）</p>
        <div className="card-strong">
          {sent.length === 0 ? (
            <EmptyCard title="送信した申請はありません" message="" />
          ) : (
            <div className="stack">
              {sent.map((r) => (
                <div key={r.friendship_id} className="card glow-hover">
                  <div className="rowx">
                    <div>
                      <p style={{ margin: 0 }}>
                        <strong>{r.target_display_name || '(名前未設定)'}</strong>
                      </p>
                      <p className="dim mono" style={{ fontSize: '0.75rem' }}>
                        {new Date(r.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                    <span className="badge amber">承認待ち</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <p className="sec-title">フレンド一覧（<span className="mono">{friends.length}</span>）</p>
        <div className="card-strong">
          {friends.length === 0 ? (
            <EmptyCard title="フレンドがいません" message="表示名で検索して申請を送ってみましょう" />
          ) : (
            <div className="stack">
              {friends.map((f) => (
                <div key={f.friendship_id} className="card glow-hover">
                  <div className="rowx">
                    <div>
                      <p style={{ margin: 0 }}>
                        <strong>{f.friend_display_name || '(名前未設定)'}</strong>
                      </p>
                      {f.accepted_at && (
                        <p className="dim mono" style={{ fontSize: '0.75rem' }}>
                          {new Date(f.accepted_at).toLocaleString('ja-JP')} に承認
                        </p>
                      )}
                    </div>
                    <span className="badge success">フレンド</span>
                  </div>
                  <div className="row mt-s">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => router.push(`/users/${f.friend_user_id}`)}
                    >
                      プロフィール
                    </button>
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => handleRemove(f.friend_user_id)}
                      disabled={busyId === f.friend_user_id}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
