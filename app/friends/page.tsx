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
        <h1>フレンド</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>フレンド</h1>
          <p className="muted">フレンドの追加・管理ができます</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューに戻る</button>
        </div>
      </div>

      <div className="section">
        <div className="card-strong">
          <h2>フレンド申請を送る</h2>
          <div className="row">
            <input
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="相手の表示名"
              disabled={sending}
            />
            <button onClick={handleSendRequest} disabled={sending}>
              {sending ? '送信中...' : '申請を送る'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            表示名の完全一致で検索します
          </p>
        </div>
      </div>

      <div className="section">
        <div className="card-strong">
          <h2>受信した申請（{incoming.length}）</h2>
          {incoming.length === 0 ? (
            <EmptyCard title="受信した申請はありません" message="" />
          ) : (
            <div className="stack">
              {incoming.map((r) => (
                <div key={r.friendship_id} className="card">
                  <p>
                    <strong>{r.requester_display_name || '(名前未設定)'}</strong>
                  </p>
                  <p className="muted">
                    {new Date(r.created_at).toLocaleString('ja-JP')}
                  </p>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      onClick={() => handleAccept(r.friendship_id)}
                      disabled={busyId === r.friendship_id}
                    >
                      承認
                    </button>
                    <button
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
        <div className="card-strong">
          <h2>送信した申請（{sent.length}）</h2>
          {sent.length === 0 ? (
            <EmptyCard title="送信した申請はありません" message="" />
          ) : (
            <div className="stack">
              {sent.map((r) => (
                <div key={r.friendship_id} className="card">
                  <p>
                    <strong>{r.target_display_name || '(名前未設定)'}</strong>
                  </p>
                  <p className="muted">
                    {new Date(r.created_at).toLocaleString('ja-JP')} / 承認待ち
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card-strong">
          <h2>フレンド一覧（{friends.length}）</h2>
          {friends.length === 0 ? (
            <EmptyCard title="フレンドがいません" message="表示名で検索して申請を送ってみましょう" />
          ) : (
            <div className="stack">
              {friends.map((f) => (
                <div key={f.friendship_id} className="card">
                  <p>
                    <strong>{f.friend_display_name || '(名前未設定)'}</strong>
                  </p>
                  {f.accepted_at && (
                    <p className="muted">
                      {new Date(f.accepted_at).toLocaleString('ja-JP')} に承認
                    </p>
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      onClick={() => router.push(`/users/${f.friend_user_id}`)}
                    >
                      プロフィール
                    </button>
                    <button
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
