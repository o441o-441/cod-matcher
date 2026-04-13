'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LoadingCard, EmptyCard } from '@/components/UIState'
import { usePageView } from '@/lib/usePageView'

type ConversationRow = {
  partner_id: string
  partner_name: string | null
  last_body: string
  last_at: string
  unread: number
}

export default function DmListPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)

  usePageView('/dm')

  useEffect(() => {
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

      const { data: msgs } = await supabase
        .from('direct_messages')
        .select('id, sender_user_id, receiver_user_id, body, is_read, created_at')
        .or(`sender_user_id.eq.${uid},receiver_user_id.eq.${uid}`)
        .order('created_at', { ascending: false })

      if (!msgs) { setLoading(false); return }

      const convMap = new Map<string, { last: typeof msgs[0]; unread: number }>()
      for (const m of msgs as { id: string; sender_user_id: string; receiver_user_id: string; body: string; is_read: boolean; created_at: string }[]) {
        const partnerId = m.sender_user_id === uid ? m.receiver_user_id : m.sender_user_id
        if (!convMap.has(partnerId)) {
          convMap.set(partnerId, { last: m, unread: 0 })
        }
        const entry = convMap.get(partnerId)!
        if (!m.is_read && m.receiver_user_id === uid) {
          entry.unread++
        }
      }

      const partnerIds = [...convMap.keys()]
      let nameMap: Record<string, string> = {}
      if (partnerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', partnerIds)
        for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
          if (p.display_name) nameMap[p.id] = p.display_name
        }
      }

      const convList: ConversationRow[] = [...convMap.entries()].map(([pid, c]) => ({
        partner_id: pid,
        partner_name: nameMap[pid] ?? null,
        last_body: c.last.body,
        last_at: c.last.created_at,
        unread: c.unread,
      }))

      convList.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime())
      setConversations(convList)
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <main>
        <h1>ASCENT DM</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT DM</h1>
          <p className="muted">やりとりの一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {conversations.length === 0 ? (
          <EmptyCard title="まだメッセージはありません" message="ユーザーのプロフィールからDMを送れます。" />
        ) : (
          <div className="stack">
            {conversations.map((c) => (
              <div
                key={c.partner_id}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/dm/${c.partner_id}`)}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ marginTop: 0 }}>
                      {c.partner_name || '(不明)'}
                      {c.unread > 0 && (
                        <span style={{
                          marginLeft: 8,
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: 'var(--accent-cyan, #00e5ff)',
                          color: '#000',
                          fontWeight: 'bold',
                        }}>
                          {c.unread}
                        </span>
                      )}
                    </h3>
                    <p className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                      {c.last_body}
                    </p>
                  </div>
                  <span className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {new Date(c.last_at).toLocaleString('ja-JP')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
