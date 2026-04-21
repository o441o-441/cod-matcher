'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard } from '@/components/UIState'
import { useToast } from '@/components/ToastProvider'
import { usePageView } from '@/lib/usePageView'

type MessageRow = {
  id: string
  sender_user_id: string
  receiver_user_id: string
  body: string
  is_read: boolean
  created_at: string
}

export default function DmConversationPage() {
  const router = useRouter()
  const params = useParams<{ userId: string }>()
  const partnerId = params?.userId
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)

  usePageView('/dm/conversation')

  const loadMessages = async (uid: string, pid: string) => {
    const { data } = await supabase
      .from('direct_messages')
      .select('id, sender_user_id, receiver_user_id, body, is_read, created_at')
      .or(`and(sender_user_id.eq.${uid},receiver_user_id.eq.${pid}),and(sender_user_id.eq.${pid},receiver_user_id.eq.${uid})`)
      .order('created_at', { ascending: true })

    setMessages((data ?? []) as MessageRow[])

    // Mark unread as read
    await supabase
      .from('direct_messages')
      .update({ is_read: true })
      .eq('sender_user_id', pid)
      .eq('receiver_user_id', uid)
      .eq('is_read', false)
  }

  useEffect(() => {
    if (!partnerId) return
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }
      const uid = session.user.id
      setMyUserId(uid)

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', partnerId)
        .maybeSingle<{ display_name: string | null }>()
      setPartnerName(profile?.display_name ?? null)

      await loadMessages(uid, partnerId)
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime + polling
  useEffect(() => {
    if (!partnerId || !myUserId) return

    const channel = supabase
      .channel(`dm-${[myUserId, partnerId].sort().join('-')}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        () => void loadMessages(myUserId, partnerId)
      )
      .subscribe()

    const interval = setInterval(() => void loadMessages(myUserId, partnerId), 5000)

    return () => {
      void supabase.removeChannel(channel)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, myUserId])

  const handleSend = async () => {
    if (!myUserId || !partnerId) return
    const trimmed = input.trim()
    if (!trimmed) {
      showToast('メッセージを入力してください', 'error')
      return
    }

    setSending(true)
    const { error } = await supabase.from('direct_messages').insert({
      sender_user_id: myUserId,
      receiver_user_id: partnerId,
      body: trimmed,
    })
    setSending(false)

    if (error) {
      showToast(error.message || '送信に失敗しました', 'error')
      return
    }

    setInput('')
    await loadMessages(myUserId, partnerId)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  if (loading) {
    return (
      <main>
        <p className="eyebrow">DIRECT MESSAGE</p>
        <h1 className="display"><em>DM</em></h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <p className="eyebrow">DIRECT MESSAGE</p>
      <h1 className="display"><em>{partnerName || '(不明)'}</em></h1>
      <p className="muted">ダイレクトメッセージ</p>

      <div className="row mt-s" style={{ gap: 8 }}>
        <button className="btn-ghost btn-sm" onClick={() => router.push(`/users/${partnerId}`)}>プロフィール</button>
        <button className="btn-ghost btn-sm" onClick={() => router.push('/dm')}>一覧に戻る</button>
      </div>

      <div className="section card-strong">
        <div
          style={{
            height: 450,
            overflowY: 'auto',
            padding: 12,
            borderRadius: 'var(--r-lg)',
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid var(--line)',
          }}
        >
          {messages.length === 0 ? (
            <p className="muted" style={{ textAlign: 'center', marginTop: 40 }}>
              まだメッセージはありません。最初のメッセージを送りましょう。
            </p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {messages.map((m) => {
                const isMe = m.sender_user_id === myUserId
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: isMe ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '70%',
                        padding: '8px 14px',
                        borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: isMe
                          ? 'rgba(0,229,255,0.15)'
                          : 'rgba(140,160,220,0.1)',
                        border: `1px solid ${isMe ? 'rgba(0,229,255,0.3)' : 'var(--line)'}`,
                      }}
                    >
                      <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.9rem' }}>
                        {m.body}
                      </p>
                      <p className="dim mono" style={{ fontSize: '0.65rem', margin: '4px 0 0', textAlign: 'right' }}>
                        {new Date(m.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="mt-s">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力（Enter で送信、Shift+Enter で改行）"
            rows={3}
            disabled={sending}
            style={{ width: '100%' }}
          />
          <div className="row mt-xs" style={{ justifyContent: 'flex-end' }}>
            <button className="btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
