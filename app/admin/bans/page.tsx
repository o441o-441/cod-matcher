'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type BannedUser = {
  id: string
  display_name: string | null
  current_rating: number | null
  is_banned: boolean | null
}

export default function AdminBansPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [users, setUsers] = useState<BannedUser[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchBannedUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, current_rating, is_banned')
      .eq('is_banned', true)
      .order('display_name', { ascending: true })

    if (error) {
      console.error('fetch banned users error:', error)
      return
    }
    setUsers((data ?? []) as BannedUser[])
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

      const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()

      if (!me?.is_admin) {
        showToast('このページにアクセスする権限がありません', 'error')
        router.push('/menu')
        return
      }

      setAuthorized(true)
      await fetchBannedUsers()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleUnban = async (userId: string, displayName: string | null) => {
    const name = displayName || userId.slice(0, 8)
    if (!confirm(`${name} の BAN を解除しますか？`)) return

    setBusyId(userId)
    const { error } = await supabase.rpc('rpc_admin_ban_user', {
      p_user_id: userId,
      p_ban: false,
    })
    setBusyId(null)

    if (error) {
      console.error('unban error:', error)
      showToast(error.message || 'BAN 解除に失敗しました', 'error')
      return
    }

    showToast(`${name} の BAN を解除しました`, 'success')
    await fetchBannedUsers()
  }

  if (loading || !authorized) {
    return (
      <main>
        <h1>BANユーザー管理</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>BANユーザー管理</h1>
          <p className="muted">現在BANされているユーザー一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/admin/reports')}>通報管理へ</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {users.length === 0 ? (
          <EmptyCard title="BANされたユーザーはいません" message="" />
        ) : (
          <div className="stack">
            {users.map((u) => (
              <div key={u.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ marginTop: 0 }}>{u.display_name || '(名前未設定)'}</h3>
                    <p className="muted">レート: {u.current_rating ?? '-'}</p>
                  </div>
                  <div className="row">
                    <button onClick={() => router.push(`/users/${u.id}`)}>
                      プロフィール
                    </button>
                    <button
                      disabled={busyId === u.id}
                      onClick={() => handleUnban(u.id, u.display_name)}
                    >
                      BAN 解除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
