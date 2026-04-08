'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function MenuPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [hasTeam, setHasTeam] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [waitingCount, setWaitingCount] = useState(0)
  const realtimeRef = useRef<RealtimeChannel | null>(null)

  const fetchWaitingCount = async () => {
    const { count } = await supabase
      .from('match_queue')
      .select('*', { count: 'exact', head: true })
    setWaitingCount(count || 0)
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

      const { data: userRow } = await supabase
        .from('users')
        .select('is_profile_complete')
        .eq('auth_user_id', session.user.id)
        .maybeSingle<{ is_profile_complete: boolean | null }>()

      if (!userRow?.is_profile_complete) {
        router.push('/onboarding')
        return
      }

      const { data: memberRow } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', session.user.id)
        .maybeSingle<{ team_id: string | null }>()
      setHasTeam(!!memberRow?.team_id)

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()
      setIsAdmin(!!profileRow?.is_admin)

      await fetchWaitingCount()
      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('menu-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_queue' },
        async () => {
          await fetchWaitingCount()
        }
      )
      .subscribe()
    realtimeRef.current = channel
    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    }
  }, [])

  if (loading) {
    return (
      <main>
        <h1>メニュー</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>メニュー</h1>
          <p className="muted">対戦・コミュニティ機能はここから</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/mypage')}>マイページ</button>
        </div>
      </div>

      <div className="section card-strong" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>対戦を始める</h2>
        <p className="muted">現在の待機チーム数: {waitingCount}</p>
        <button
          onClick={() => router.push('/match')}
          style={{
            fontSize: '1.5rem',
            padding: '20px 48px',
            marginTop: 16,
            boxShadow: 'var(--glow-cyan)',
          }}
        >
          対戦開始
        </button>
      </div>

      <div className="section card-strong">
        <h2>チーム</h2>
        <div className="row">
          {hasTeam ? (
            <button onClick={() => router.push('/team/edit')}>チーム編集</button>
          ) : (
            <>
              <button onClick={() => router.push('/team/create')}>
                チームを作成
              </button>
              <button onClick={() => router.push('/team/join')}>
                チームに参加
              </button>
            </>
          )}
        </div>
      </div>

      <div className="section card-strong">
        <h2>コミュニティ</h2>
        <div className="row">
          <button onClick={() => router.push('/friends')}>フレンド管理</button>
          <button onClick={() => router.push('/blog')}>ブログ</button>
          <button onClick={() => router.push('/ranking')}>ランキング</button>
          <button onClick={() => router.push('/history')}>マッチ履歴</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>その他</h2>
        <div className="row">
          <button onClick={() => router.push('/rules')}>ルール一覧</button>
          <button onClick={() => router.push('/reports')}>通報履歴</button>
          {isAdmin && (
            <button onClick={() => router.push('/admin/reports')}>
              通報管理
            </button>
          )}
          {isAdmin && (
            <button onClick={() => router.push('/admin/announcements')}>
              お知らせ管理
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
