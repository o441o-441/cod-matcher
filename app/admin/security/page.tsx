'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'

type SecurityFlag = {
  id: string
  user_id: string
  flag_type: string
  severity: string
  detail: string | null
  matched_user_id: string | null
  resolved: boolean
  created_at: string
  user_display_name?: string | null
  matched_display_name?: string | null
}

const FLAG_LABELS: Record<string, string> = {
  young_discord: '新規Discord',
  activision_reuse: 'Activision ID再利用',
  ip_match: 'IP一致',
  fingerprint_match: 'フィンガープリント一致',
}

const FLAG_TYPES = ['all', 'young_discord', 'activision_reuse', 'ip_match', 'fingerprint_match'] as const

export default function AdminSecurityPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [flags, setFlags] = useState<SecurityFlag[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchFlags = async () => {
    let query = supabase
      .from('security_flags')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('flag_type', filter)
    }

    const { data, error } = await query

    if (error) {
      console.error('fetch security flags error:', error)
      return
    }

    const flagRows = (data ?? []) as SecurityFlag[]

    // ユーザー名を取得
    const userIds = [...new Set([
      ...flagRows.map(f => f.user_id),
      ...flagRows.map(f => f.matched_user_id).filter(Boolean),
    ])] as string[]

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds)

      const nameMap = new Map(
        (profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name])
      )

      for (const f of flagRows) {
        f.user_display_name = nameMap.get(f.user_id) ?? null
        if (f.matched_user_id) {
          f.matched_display_name = nameMap.get(f.matched_user_id) ?? null
        }
      }
    }

    setFlags(flagRows)
  }

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }

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
      await fetchFlags()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (authorized) {
      void fetchFlags()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const handleResolve = async (flagId: string) => {
    if (!confirm('このフラグを解決済みにしますか？')) return
    setBusyId(flagId)
    const { error } = await supabase.rpc('rpc_admin_resolve_flag', { p_flag_id: flagId })
    setBusyId(null)
    if (error) {
      showToast(error.message || 'フラグ解決に失敗しました', 'error')
      return
    }
    showToast('フラグを解決済みにしました', 'success')
    await fetchFlags()
  }

  const handleBan = async (userId: string, displayName: string | null) => {
    const name = displayName || userId.slice(0, 8)
    if (!confirm(`${name} をBANしますか？`)) return
    setBusyId(userId)
    const { error } = await supabase.rpc('rpc_admin_ban_user', {
      p_user_id: userId,
      p_ban: true,
    })
    setBusyId(null)
    if (error) {
      showToast(error.message || 'BAN に失敗しました', 'error')
      return
    }
    showToast(`${name} をBANしました`, 'success')
    await fetchFlags()
  }

  if (loading || !authorized) {
    return (
      <main>
        <h1>セキュリティフラグ</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>セキュリティフラグ</h1>
          <p className="muted">サブアカウント検知フラグ一覧</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/admin/bans')}>BAN管理へ</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {FLAG_TYPES.map(t => (
            <button
              key={t}
              className={filter === t ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setFilter(t)}
              style={{ fontSize: 13 }}
            >
              {t === 'all' ? 'すべて' : FLAG_LABELS[t] || t}
            </button>
          ))}
        </div>
      </div>

      <div className="section card-strong">
        {flags.length === 0 ? (
          <EmptyCard title="未解決のフラグはありません" message="" />
        ) : (
          <div className="stack">
            {flags.map(f => (
              <div key={f.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 700,
                          background: f.severity === 'block' ? 'var(--danger)' : 'var(--warning, #f59e0b)',
                          color: '#fff',
                        }}
                      >
                        {FLAG_LABELS[f.flag_type] || f.flag_type}
                      </span>
                      {f.severity === 'block' && (
                        <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>BLOCK</span>
                      )}
                    </div>
                    <h3 style={{ marginTop: 4 }}>
                      {f.user_display_name || f.user_id.slice(0, 8)}
                    </h3>
                    <p className="muted" style={{ fontSize: 13 }}>{f.detail}</p>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {new Date(f.created_at).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => router.push(`/users/${f.user_id}`)}
                      style={{ fontSize: 13 }}
                    >
                      詳細
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={busyId === f.id}
                      onClick={() => handleResolve(f.id)}
                      style={{ fontSize: 13 }}
                    >
                      解決
                    </button>
                    <button
                      style={{ fontSize: 13, background: 'var(--danger)', color: '#fff' }}
                      disabled={busyId === f.user_id}
                      onClick={() => handleBan(f.user_id, f.user_display_name ?? null)}
                    >
                      BAN
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
