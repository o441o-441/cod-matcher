'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Tutorial } from '@/components/Tutorial'
import { usePageView } from '@/lib/usePageView'
import { getCache, setCache } from '@/lib/cache'
import { LoadingSkeleton } from '@/components/UIState'

const MENU_TUTORIAL = [
  { title: 'メニュー画面', body: 'ここがメインメニューです。対戦開始やフレンド管理など、すべての機能にここからアクセスできます。' },
  { title: '対戦を始める', body: '「対戦開始」ボタンを押すとマッチング画面に移動します。ソロでもチームでも参加できます。' },
  { title: 'レートと戦績', body: '対戦開始ボタンの横にあなたの個人レートと戦績が表示されます。試合結果が承認されるとレートが変動します。' },
  { title: 'マイページ', body: '右上の「マイページ」からプロフィール編集や自己紹介の設定ができます。' },
]

function getTierInfo(r: number | null): { label: string; color: string } {
  if (r == null) return { label: '—', color: 'var(--text-dim)' }
  if (r >= 2400) return { label: 'ASCENDANT', color: 'var(--tier-ascendant)' }
  if (r >= 2000) return { label: 'DIAMOND', color: 'var(--tier-diamond)' }
  if (r >= 1600) return { label: 'PLATINUM', color: 'var(--tier-platinum)' }
  if (r >= 1200) return { label: 'GOLD', color: 'var(--tier-gold)' }
  if (r >= 800) return { label: 'SILVER', color: 'var(--tier-silver)' }
  return { label: 'BRONZE', color: 'var(--tier-bronze)' }
}

export default function MenuPage() {
  const router = useRouter()

  type MenuCache = { hasTeam: boolean; isAdmin: boolean; rating: number | null; wins: number | null; losses: number | null }
  const cached = typeof window !== 'undefined' ? getCache<MenuCache>('menu_data') : null

  const [loading, setLoading] = useState(!cached)
  const [hasTeam, setHasTeam] = useState(cached?.hasTeam ?? false)
  const [isAdmin, setIsAdmin] = useState(cached?.isAdmin ?? false)
  const [rating, setRating] = useState<number | null>(cached?.rating ?? null)
  const [wins, setWins] = useState<number | null>(cached?.wins ?? null)
  const [losses, setLosses] = useState<number | null>(cached?.losses ?? null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
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

      const [memberRes, profileRes, notifRes] = await Promise.all([
        supabase.from('team_members').select('team_id').eq('user_id', session.user.id).maybeSingle<{ team_id: string | null }>(),
        supabase.from('profiles').select('is_admin, current_rating, wins, losses').eq('id', session.user.id).maybeSingle<{ is_admin: boolean | null; current_rating: number | null; wins: number | null; losses: number | null }>(),
        supabase.from('notifications').select('id, type, body, link, created_at').eq('user_id', session.user.id).eq('is_read', false).order('created_at', { ascending: false }).limit(10),
      ])

      setHasTeam(!!memberRes.data?.team_id)

      const profileRow = profileRes.data
      setIsAdmin(!!profileRow?.is_admin)
      setRating(profileRow?.current_rating ?? null)
      setWins(profileRow?.wins ?? null)
      setLosses(profileRow?.losses ?? null)

      setMyUserId(session.user.id)
      setNotifications((notifRes.data ?? []) as { id: string; type: string; body: string; link: string | null; created_at: string }[])

      setCache('menu_data', {
        hasTeam: !!memberRes.data?.team_id,
        isAdmin: !!profileRow?.is_admin,
        rating: profileRow?.current_rating ?? null,
        wins: profileRow?.wins ?? null,
        losses: profileRow?.losses ?? null,
      })

      setLoading(false)
    }

    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!myUserId) return
    const channel = supabase
      .channel(`menu-notifications-${myUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${myUserId}` },
        () => void fetchNotifications(myUserId)
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId])

  if (loading) {
    return (
      <main>
        <div className="eyebrow">MAIN / MENU</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)', marginTop: 8 }}>ASCENT メニュー</h1>
        <LoadingSkeleton cards={3} />
      </main>
    )
  }

  const totalGames = (wins ?? 0) + (losses ?? 0)
  const winRate = totalGames > 0 ? Math.round(((wins ?? 0) / totalGames) * 100) : 0
  const tier = getTierInfo(rating)

  return (
    <main>
      <div className="eyebrow">MAIN / MENU</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)', marginTop: 8 }}>
        ASCENT <em>メニュー</em>
      </h1>
      <Tutorial pageKey="menu" steps={MENU_TUTORIAL} />

      {/* ── Primary CTA ── */}
      <div className="card-strong mt-l" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 32,
            alignItems: 'center',
            padding: 32,
          }}
        >
          {/* Left: text + stats */}
          <div>
            <div className="eyebrow">PRIMARY ACTION</div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 44,
                fontWeight: 800,
                lineHeight: 1.1,
                marginTop: 8,
              }}
            >
              対戦を<span style={{ color: 'var(--cyan)', textShadow: '0 0 24px rgba(0,229,255,0.5)' }}>開始</span>。
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              ソロまたはチームでマッチメイキングに参加します
            </p>

            <div className="row" style={{ marginTop: 20, gap: 16, flexWrap: 'wrap' }}>
              <button
                className="btn-primary btn-xl"
                onClick={() => router.push('/match')}
              >
                対戦開始
              </button>

              <div className="row" style={{ gap: 20 }}>
                <div className="stack-sm">
                  <span className="stat-label">SR</span>
                  <span className="mono tabular" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>
                    {rating ?? '—'}
                  </span>
                </div>
                <div className="stack-sm">
                  <span className="stat-label">戦績</span>
                  <span className="mono tabular" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>
                    {wins ?? 0}W {losses ?? 0}L
                  </span>
                </div>
                <div className="stack-sm">
                  <span className="stat-label">勝率</span>
                  <span className="mono tabular" style={{ fontSize: 18, fontWeight: 700, color: winRate >= 50 ? 'var(--success)' : 'var(--text-strong)' }}>
                    {winRate}%
                  </span>
                </div>
                <div className="stack-sm">
                  <span className="stat-label">連勝</span>
                  <span className="mono tabular" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>
                    —
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: circular rating display */}
          <div style={{ position: 'relative', width: 220, height: 220, flexShrink: 0 }}>
            {/* Conic-gradient blur ring */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: `conic-gradient(from 180deg, ${tier.color}, var(--violet), ${tier.color})`,
                opacity: 0.35,
                filter: 'blur(20px)',
              }}
            />
            {/* Outer ring */}
            <div
              style={{
                position: 'absolute',
                inset: 4,
                borderRadius: '50%',
                background: `conic-gradient(from 180deg, ${tier.color}, var(--violet), ${tier.color})`,
                opacity: 0.6,
              }}
            />
            {/* Inner circle */}
            <div
              style={{
                position: 'absolute',
                inset: 8,
                borderRadius: '50%',
                background: 'var(--bg)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              {/* Tier badge */}
              <span
                className="badge"
                style={{
                  color: tier.color,
                  borderColor: tier.color,
                  background: 'rgba(0,0,0,0.4)',
                  fontSize: 9,
                  padding: '3px 8px',
                }}
              >
                <span className="badge-dot" style={{ background: tier.color, boxShadow: `0 0 10px ${tier.color}` }} />
                {tier.label}
              </span>
              {/* Rating number */}
              <span
                className="mono tabular"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 42,
                  fontWeight: 800,
                  color: 'var(--text-strong)',
                  lineHeight: 1,
                  marginTop: 4,
                }}
              >
                {rating ?? '—'}
              </span>
              {/* Peak */}
              <span className="muted" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
                PEAK {rating ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Secondary sections (3-col) ── */}
      <div className="grid-3 mt-l">
        {/* Team */}
        <div className="card-strong">
          <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--cyan-dim)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>チーム</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>チームの作成・管理</div>
          <div className="stack" style={{ marginTop: 16 }}>
            {hasTeam ? (
              <button className="btn-ghost btn-block" onClick={() => router.push('/team/edit')}>
                チーム編集
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ) : (
              <>
                <button className="btn-ghost btn-block" onClick={() => router.push('/team/create')}>
                  チームを作成
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button className="btn-ghost btn-block" onClick={() => router.push('/team/join')}>
                  チームに参加
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Community */}
        <div className="card-strong">
          <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--cyan-dim)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>コミュニティ</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>フレンド・DM・ランキング</div>
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="btn-ghost btn-block" onClick={() => router.push('/friends')}>
              フレンド管理
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="btn-ghost btn-block" onClick={() => router.push('/dm')}>
              DM
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="btn-ghost btn-block" onClick={() => router.push('/blog')}>
              レビュー
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="btn-ghost btn-block" onClick={() => router.push('/ranking')}>
              ランキング
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="btn-ghost btn-block" onClick={() => router.push('/history')}>
              マッチ履歴
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        {/* Competitive / その他 */}
        <div className="card-strong">
          <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--cyan-dim)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>競技</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>ルール・通報・管理</div>
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="btn-ghost btn-block" onClick={() => router.push('/rules')}>
              ルール一覧
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="btn-ghost btn-block" onClick={() => router.push('/reports')}>
              通報履歴
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/reports')}>
                通報管理
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/announcements')}>
                お知らせ管理
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/tournaments')}>
                大会告知管理
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/seasons')}>
                シーズン管理
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/roles')}>
                ロール管理
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/dashboard')}>
                ダッシュボード
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {isAdmin && (
              <button className="btn-ghost btn-block" onClick={() => router.push('/admin/affiliates')}>
                購入リンク管理
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Notifications ── */}
      {notifications.length > 0 && (
        <div className="card-strong mt-l">
          <div className="rowx" style={{ marginBottom: 14 }}>
            <div className="sec-title" style={{ margin: 0 }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 1112 0v4l2 3H4l2-3V9zM10 19a2 2 0 004 0" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
              通知（{notifications.length}）
            </div>
            <button className="btn-ghost btn-sm" onClick={handleDismissAll}>すべて既読</button>
          </div>
          <div className="stack">
            {notifications.map((n) => {
              const isHot = n.type === 'direct_message'
              return (
                <div
                  key={n.id}
                  className="card"
                  style={{ cursor: n.link ? 'pointer' : undefined, padding: '14px 16px' }}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 12, alignItems: 'center' }}>
                    {/* Dot indicator */}
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isHot ? 'var(--magenta)' : 'var(--cyan)',
                        boxShadow: isHot ? '0 0 10px var(--magenta)' : '0 0 10px var(--cyan)',
                        flexShrink: 0,
                      }}
                    />
                    {/* Text */}
                    <p style={{ margin: 0, fontSize: 13 }}>
                      {n.type === 'blog_comment'
                        ? n.body.replace('commented on your post', 'があなたの記事にコメントしました')
                        : n.type === 'comment_reply'
                        ? n.body.replace('replied to your comment', 'があなたのコメントに返信しました')
                        : n.type === 'direct_message'
                        ? n.body.replace('sent you a message', 'からDMが届きました')
                        : n.body}
                    </p>
                    {/* Time */}
                    <span className="muted mono" style={{ fontSize: 10, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(n.created_at).toLocaleString('ja-JP')}
                    </span>
                    {/* Action */}
                    {n.link && (
                      <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); handleNotificationClick(n) }}>
                        表示
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </main>
  )
}
