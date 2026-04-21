'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

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

function Avatar({ name, size = 38 }: { name: string | null; size?: number }) {
  const initials = name ? name.slice(0, 2).toUpperCase() : '??'
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  )
}

export default function FriendsDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [tab, setTab] = useState<'friends' | 'requests' | 'dm'>('friends')
  const [query, setQuery] = useState('')

  const [friends, setFriends] = useState<FriendRow[]>([])
  const [incoming, setIncoming] = useState<IncomingRequestRow[]>([])
  const [sent, setSent] = useState<SentRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const [friendsRes, incomingRes, sentRes] = await Promise.all([
      supabase.rpc('rpc_list_my_friends'),
      supabase.rpc('rpc_list_my_pending_friend_requests'),
      supabase.rpc('rpc_list_my_sent_friend_requests'),
    ])
    if (!friendsRes.error) setFriends((friendsRes.data ?? []) as FriendRow[])
    if (!incomingRes.error) setIncoming((incomingRes.data ?? []) as IncomingRequestRow[])
    if (!sentRes.error) setSent((sentRes.data ?? []) as SentRequestRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleAccept = async (friendshipId: string) => {
    setBusyId(friendshipId)
    const { error } = await supabase.rpc('rpc_accept_friend_request', {
      p_friendship_id: friendshipId,
    })
    setBusyId(null)
    if (error) {
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
      showToast(error.message || '操作に失敗しました', 'error')
      return
    }
    showToast('申請を処理しました', 'success')
    await fetchAll()
  }

  const q = query.toLowerCase().trim()
  const filteredFriends = friends.filter(
    (f) => !q || (f.friend_display_name ?? '').toLowerCase().includes(q)
  )

  return (
    <>
      <div className="fd-scrim" onClick={onClose} />
      <aside className="fd" role="dialog" aria-label="フレンド">
        {/* Header */}
        <div className="fd-head">
          <div className="fd-title">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 20c0-2.2 1.8-4 4-4s4 1.8 4 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            FRI<em>E</em>NDS
            <span className="fd-count">{friends.length}</span>
          </div>
          <button className="fd-close" onClick={onClose} aria-label="閉じる">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="fd-tabs">
          <button
            className={`fd-tab ${tab === 'friends' ? 'active' : ''}`}
            onClick={() => setTab('friends')}
          >
            フレンド
          </button>
          <button
            className={`fd-tab ${tab === 'requests' ? 'active' : ''}`}
            onClick={() => setTab('requests')}
          >
            申請
            {incoming.length > 0 && <span className="fd-tab-dot">{incoming.length}</span>}
          </button>
          <button
            className={`fd-tab ${tab === 'dm' ? 'active' : ''}`}
            onClick={() => setTab('dm')}
          >
            DM
          </button>
        </div>

        {/* Friends tab */}
        {tab === 'friends' && (
          <>
            <div className="fd-search">
              <div className="fd-search-wrap">
                <span className="fd-search-icon">
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  placeholder="名前で検索..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="fd-body">
              {loading ? (
                <div className="fd-empty">読み込み中...</div>
              ) : filteredFriends.length === 0 ? (
                <div className="fd-empty">
                  <strong>{q ? '一致するフレンドなし' : 'フレンドがいません'}</strong>
                  {q ? '検索条件を変更してください' : 'フレンドを追加してみましょう'}
                </div>
              ) : (
                <>
                  <div className="fd-section">
                    フレンド <span className="fd-section-count">· {filteredFriends.length}</span>
                  </div>
                  {filteredFriends.map((f) => (
                    <div
                      key={f.friendship_id}
                      className="fd-row"
                      onClick={() => {
                        router.push(`/users/${f.friend_user_id}`)
                        onClose()
                      }}
                    >
                      <div className="fd-row-avatar">
                        <Avatar name={f.friend_display_name} />
                      </div>
                      <div className="fd-row-main">
                        <div className="fd-row-name">
                          {f.friend_display_name ?? '(名前なし)'}
                        </div>
                        <div className="fd-row-activity">
                          <span className="muted">フレンド</span>
                        </div>
                      </div>
                      <div className="fd-row-actions" style={{ opacity: 1 }}>
                        <button
                          className="fd-ibtn"
                          title="DM"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/dm/${f.friend_user_id}`)
                            onClose()
                          }}
                        >
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                            <path
                              d="M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2h-7l-5 4v-4H6a2 2 0 01-2-2V6z"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}

        {/* Requests tab */}
        {tab === 'requests' && (
          <div className="fd-body">
            {incoming.length > 0 && (
              <>
                <div className="fd-section">
                  受信 <span className="fd-section-count">· {incoming.length}</span>
                </div>
                {incoming.map((r) => (
                  <div key={r.friendship_id} className="fd-req">
                    <Avatar name={r.requester_display_name} />
                    <div className="fd-req-main">
                      <div className="fd-req-name">{r.requester_display_name ?? '(名前なし)'}</div>
                      <div className="fd-req-meta">{new Date(r.created_at).toLocaleDateString('ja-JP')}</div>
                      <div className="fd-req-actions">
                        <button
                          className="fd-req-btn accept"
                          disabled={busyId === r.friendship_id}
                          onClick={() => handleAccept(r.friendship_id)}
                        >
                          承認
                        </button>
                        <button
                          className="fd-req-btn reject"
                          disabled={busyId === r.friendship_id}
                          onClick={() => handleReject(r.friendship_id)}
                        >
                          拒否
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {sent.length > 0 && (
              <>
                <div className="fd-section">
                  送信済み <span className="fd-section-count">· {sent.length}</span>
                </div>
                {sent.map((r) => (
                  <div key={r.friendship_id} className="fd-req">
                    <Avatar name={r.target_display_name} />
                    <div className="fd-req-main">
                      <div className="fd-req-name">{r.target_display_name ?? '(名前なし)'}</div>
                      <div className="fd-req-meta">{new Date(r.created_at).toLocaleDateString('ja-JP')}</div>
                      <div className="fd-req-actions">
                        <button
                          className="fd-req-btn reject"
                          disabled={busyId === r.friendship_id}
                          onClick={() => handleReject(r.friendship_id)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {incoming.length === 0 && sent.length === 0 && (
              <div className="fd-empty">
                <strong>申請はありません</strong>
              </div>
            )}
          </div>
        )}

        {/* DM tab */}
        {tab === 'dm' && (
          <div className="fd-body">
            <div
              className="fd-dm-row"
              onClick={() => {
                router.push('/dm')
                onClose()
              }}
            >
              <div className="fd-dm-main">
                <div className="fd-dm-name">DM一覧を開く</div>
                <div className="fd-dm-last">タップして全メッセージを表示</div>
              </div>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-dim)' }}>
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="fd-empty" style={{ padding: '24px 20px' }}>
              <span className="fd-kbd">⇧</span> + <span className="fd-kbd">F</span> でいつでも開く
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
