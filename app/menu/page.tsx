'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Tutorial } from '@/components/Tutorial'
import { usePageView } from '@/lib/usePageView'

const MENU_TUTORIAL = [
  { title: 'メニュー画面', body: 'ここがメインメニューです。対戦開始やフレンド管理など、すべての機能にここからアクセスできます。' },
  { title: '対戦を始める', body: '「対戦開始」ボタンを押すとマッチング画面に移動します。ソロでもチームでも参加できます。' },
  { title: 'レートと戦績', body: '対戦開始ボタンの横にあなたの個人レートと戦績が表示されます。試合結果が承認されるとレートが変動します。' },
  { title: 'マイページ', body: '右上の「マイページ」からプロフィール編集や自己紹介の設定ができます。' },
]

export default function MenuPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [hasTeam, setHasTeam] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [wins, setWins] = useState<number | null>(null)
  const [losses, setLosses] = useState<number | null>(null)
  const [notifications, setNotifications] = useState<{ id: string; type: string; body: string; link: string | null; created_at: string }[]>([])

  const fetchNotifications = async (userId: string) => {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, body, link, created_at')
      .eq('user_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(10)
    setNotifications((data ?? []) as { id: string; type: string; body: string; link: string | null; created_at: string }[])
  }

  const handleNotificationClick = async (notif: { id: string; link: string | null }) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id)
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id))
    if (notif.link) router.push(notif.link)
  }

  const handleDismissAll = async () => {
    const ids = notifications.map((n) => n.id)
    if (ids.length === 0) return
    await supabase.from('notifications').update({ is_read: true }).in('id', ids)
    setNotifications([])
  }

  usePageView('/menu')

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      let { data: userRow } = await supabase
        .from('users')
        .select('is_profile_complete')
        .eq('auth_user_id', session.user.id)
        .maybeSingle<{ is_profile_complete: boolean | null }>()

      if (!userRow) {
        const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>
        const identities = (session.user.identities ?? []) as Array<{
          provider?: string
          identity_data?: Record<string, unknown>
        }>
        const discordIdentity = identities.find((i) => i?.provider === 'discord')
        const identityData = (discordIdentity?.identity_data ?? {}) as Record<
          string,
          unknown
        >
        const pick = (o: Record<string, unknown>, k: string) => {
          const v = o[k]
          return typeof v === 'string' ? v : null
        }
        const discordUserId =
          pick(identityData, 'provider_id') ||
          pick(identityData, 'user_id') ||
          pick(meta, 'provider_id') ||
          pick(meta, 'sub') ||
          null
        const discordName =
          pick(meta, 'full_name') ||
          pick(meta, 'name') ||
          pick(identityData, 'full_name') ||
          pick(identityData, 'name') ||
          pick(identityData, 'global_name') ||
          pick(identityData, 'preferred_username') ||
          null

        const { data: inserted, error: insertErr } = await supabase
          .from('users')
          .insert({
            auth_user_id: session.user.id,
            display_name: null,
            activision_id: null,
            is_profile_complete: false,
            discord_name: discordName,
            discord_user_id: discordUserId,
          })
          .select('is_profile_complete')
          .single<{ is_profile_complete: boolean | null }>()

        if (insertErr) {
          console.error('users insert error:', insertErr)
          router.push('/onboarding')
          return
        }
        userRow = inserted
      }

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
        .select('is_admin, current_rating, wins, losses')
        .eq('id', session.user.id)
        .maybeSingle<{
          is_admin: boolean | null
          current_rating: number | null
          wins: number | null
          losses: number | null
        }>()
      setIsAdmin(!!profileRow?.is_admin)
      setRating(profileRow?.current_rating ?? null)
      setWins(profileRow?.wins ?? null)
      setLosses(profileRow?.losses ?? null)

      await fetchNotifications(session.user.id)

      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <main>
        <h1>ASCENT メニュー</h1>
        <p>読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>ASCENT メニュー</h1>
          <p className="muted">対戦・コミュニティ機能はここから</p>
        </div>
        <div className="row">
          <Tutorial pageKey="menu" steps={MENU_TUTORIAL} />
          <button onClick={() => router.push('/mypage')}>マイページ</button>
          <button onClick={() => router.push('/')}>トップページに戻る</button>
        </div>
      </div>

      {notifications.length > 0 && (
        <div className="section card-strong" style={{ borderColor: 'var(--accent-cyan, #00e5ff)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ marginTop: 0 }}>通知（{notifications.length}）</h2>
            <button onClick={handleDismissAll} style={{ fontSize: '0.8rem' }}>すべて既読</button>
          </div>
          <div className="stack">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="card"
                style={{ cursor: n.link ? 'pointer' : undefined }}
                onClick={() => handleNotificationClick(n)}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <p>
                    {n.type === 'blog_comment'
                      ? n.body.replace('commented on your post', 'があなたの記事にコメントしました')
                      : n.type === 'comment_reply'
                      ? n.body.replace('replied to your comment', 'があなたのコメントに返信しました')
                      : n.type === 'direct_message'
                      ? n.body.replace('sent you a message', 'からDMが届きました')
                      : n.body}
                  </p>
                  <span className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {new Date(n.created_at).toLocaleString('ja-JP')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section card-strong">
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>対戦を始める</h2>
        <div
          className="row"
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            gap: 32,
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => router.push('/match')}
            style={{
              fontSize: '1.5rem',
              padding: '20px 48px',
              boxShadow: 'var(--glow-cyan)',
            }}
          >
            対戦開始
          </button>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ minWidth: 120, textAlign: 'center' }}>
              <p className="muted" style={{ margin: 0 }}>レート</p>
              <h3 style={{ margin: '4px 0 0' }}>{rating ?? '-'}</h3>
            </div>
            <div className="card" style={{ minWidth: 140, textAlign: 'center' }}>
              <p className="muted" style={{ margin: 0 }}>個人戦績</p>
              <h3 style={{ margin: '4px 0 0' }}>
                {wins ?? 0}勝 {losses ?? 0}敗
              </h3>
            </div>
          </div>
        </div>
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
          <button onClick={() => router.push('/dm')}>DM</button>
          <button onClick={() => router.push('/blog')}>レビュー</button>
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
          {isAdmin && (
            <button onClick={() => router.push('/admin/tournaments')}>
              大会告知管理
            </button>
          )}
          {isAdmin && (
            <button onClick={() => router.push('/admin/seasons')}>
              シーズン管理
            </button>
          )}
          {isAdmin && (
            <button onClick={() => router.push('/admin/roles')}>
              ロール管理
            </button>
          )}
          {isAdmin && (
            <button onClick={() => router.push('/admin/dashboard')}>
              ダッシュボード
            </button>
          )}
          {isAdmin && (
            <button onClick={() => router.push('/admin/affiliates')}>
              購入リンク管理
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
