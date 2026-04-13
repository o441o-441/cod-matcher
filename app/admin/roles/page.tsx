'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type ProfileRow = {
  id: string
  display_name: string | null
  is_admin: boolean | null
  is_monitor: boolean | null
  is_approved: boolean | null
  is_banned: boolean | null
}

export default function AdminRolesPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchProfiles = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, is_admin, is_monitor, is_approved, is_banned')
      .order('display_name', { ascending: true })
    if (error) {
      console.error('fetch profiles error:', error)
      showToast(error.message || 'プロフィール一覧の取得に失敗しました', 'error')
      return
    }
    setProfiles((data ?? []) as ProfileRow[])
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
      await fetchProfiles()
      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleToggleRole = async (
    userId: string,
    role: 'is_approved' | 'is_monitor',
    currentValue: boolean
  ) => {
    setBusyId(userId)
    const { error } = await supabase.rpc('rpc_admin_set_user_role', {
      p_user_id: userId,
      p_role: role,
      p_value: !currentValue,
    })
    setBusyId(null)

    if (error) {
      console.error('rpc_admin_set_user_role error:', error)
      showToast(error.message || 'ロール変更に失敗しました', 'error')
      return
    }

    showToast('ロールを更新しました', 'success')
    await fetchProfiles()
  }

  const filtered = profiles.filter((p) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      (p.display_name ?? '').toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    )
  })

  if (loading) {
    return (
      <main>
        <h1>ASCENT ロール管理</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  if (!authorized) {
    return null
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT ロール管理</h1>
          <p className="muted">ユーザーの承認・監視ロールを管理します</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>検索</h2>
        <div className="card">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="表示名またはIDで検索"
          />
        </div>
      </div>

      <div className="section card-strong">
        <h2>ユーザー一覧（{filtered.length}）</h2>
        {filtered.length === 0 ? (
          <EmptyCard title="該当するユーザーがいません" message="" />
        ) : (
          <div className="stack">
            {filtered.map((p) => (
              <div key={p.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <h3>{p.display_name || p.id.slice(0, 8)}</h3>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>{p.id}</p>
                    {p.is_admin && <span className="muted" style={{ fontSize: '0.75rem' }}>[管理者]</span>}
                    {p.is_banned && <span className="danger" style={{ fontSize: '0.75rem', marginLeft: 4 }}>[BAN]</span>}
                  </div>
                  <div className="row">
                    <button
                      disabled={busyId === p.id}
                      onClick={() => handleToggleRole(p.id, 'is_approved', !!p.is_approved)}
                      style={{
                        background: p.is_approved ? 'var(--accent-cyan, #0ff)' : undefined,
                        color: p.is_approved ? '#000' : undefined,
                      }}
                    >
                      {p.is_approved ? '承認済み' : '未承認'}
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() => handleToggleRole(p.id, 'is_monitor', !!p.is_monitor)}
                      style={{
                        background: p.is_monitor ? 'var(--accent-cyan, #0ff)' : undefined,
                        color: p.is_monitor ? '#000' : undefined,
                      }}
                    >
                      {p.is_monitor ? '監視中' : '監視OFF'}
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
