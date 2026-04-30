'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type SuspendedUser = {
  id: string
  display_name: string | null
  suspended_until: string | null
}

export default function AdminSuspensionsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [users, setUsers] = useState<SuspendedUser[]>([])

  const fetchSuspended = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, suspended_until')
      .gt('suspended_until', new Date().toISOString())
      .order('suspended_until', { ascending: true })

    if (error) {
      console.error('fetch suspended error:', error)
      return
    }
    setUsers((data ?? []) as SuspendedUser[])
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
      await fetchSuspended()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLiftSuspension = async (userId: string, displayName: string | null) => {
    const name = displayName || userId.slice(0, 8)
    if (!confirm(`${name} の一時停止を解除しますか？`)) return

    const { error } = await supabase.rpc('rpc_admin_lift_suspension', {
      p_user_id: userId,
    })

    if (error) {
      showToast(error.message || '解除に失敗しました', 'error')
      return
    }

    showToast(`${name} の一時停止を解除しました`, 'success')
    await fetchSuspended()
  }

  if (loading || !authorized) {
    return (
      <main>
        <h1>一時停止ユーザー</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>一時停止ユーザー</h1>
          <p className="muted">監視ユーザーによって24時間停止されたユーザー一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/admin/reports')}>通報管理へ</button>
          <button onClick={() => router.push('/admin/security')}>セキュリティ</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        {users.length === 0 ? (
          <EmptyCard title="現在一時停止中のユーザーはいません" message="" />
        ) : (
          <div className="stack">
            {users.map((u) => {
              const remaining = u.suspended_until
                ? Math.max(0, Math.floor((new Date(u.suspended_until).getTime() - Date.now()) / 60000))
                : 0

              return (
                <div key={u.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ marginTop: 0 }}>{u.display_name || '(名前未設定)'}</h3>
                      <p className="muted">
                        解除まで残り約 {remaining} 分（{u.suspended_until ? new Date(u.suspended_until).toLocaleString('ja-JP') : '-'}）
                      </p>
                    </div>
                    <div className="row">
                      <button onClick={() => router.push(`/users/${u.id}`)}>
                        プロフィール
                      </button>
                      <button onClick={() => handleLiftSuspension(u.id, u.display_name)}>
                        停止解除
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
  )
}
