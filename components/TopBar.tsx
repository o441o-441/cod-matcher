'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type ProfileData = {
  display_name: string | null
  current_rating: number | null
}

const NAV_LINKS = [
  { id: '/', label: 'HOME' },
  { id: '/menu', label: 'MENU' },
  { id: '/match', label: 'MATCH' },
  { id: '/ranking', label: 'RANKING' },
  { id: '/blog', label: 'REVIEWS' },
  { id: '/mypage', label: 'MY PAGE' },
]

export default function TopBar({
  onOpenFriends,
  friendsOpen,
  unreadCount = 0,
}: {
  onOpenFriends?: () => void
  friendsOpen?: boolean
  unreadCount?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        setSignedIn(false)
        return
      }
      setSignedIn(true)
      const { data } = await supabase
        .from('profiles')
        .select('display_name, current_rating')
        .eq('id', session.user.id)
        .maybeSingle<ProfileData>()
      if (data) setProfile(data)
    }
    load()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user)
      if (!session?.user) setProfile(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/'
    return pathname.startsWith(path)
  }

  const initials = profile?.display_name
    ? profile.display_name.slice(0, 2).toUpperCase()
    : '??'

  return (
    <div className="topbar">
      <div className="container topbar-inner">
        <div className="brand" onClick={() => router.push('/')}>
          <div className="brand-mark">A</div>
          <div className="brand-word">
            ASCENT<em>.</em>
          </div>
        </div>

        <div className="nav" style={{ flex: 1, justifyContent: 'center' }}>
          {NAV_LINKS.map((l) => (
            <div
              key={l.id}
              className={`nav-link ${isActive(l.id) ? 'active' : ''}`}
              onClick={() => router.push(l.id)}
            >
              {l.label}
            </div>
          ))}
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          {signedIn && onOpenFriends && (
            <button
              className={`fd-toggle ${friendsOpen ? 'active' : ''}`}
              onClick={onOpenFriends}
              title="フレンド (Shift+F)"
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 20c0-2.2 1.8-4 4-4s4 1.8 4 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              {unreadCount > 0 && <span className="fd-toggle-badge">{unreadCount}</span>}
            </button>
          )}

          {signedIn && profile ? (
            <div
              className="user-chip"
              onClick={() => router.push('/mypage')}
            >
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                {initials}
              </div>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{profile.display_name}</div>
                <div
                  className="mono tabular"
                  style={{ fontSize: 11, color: 'var(--cyan)' }}
                >
                  SR {profile.current_rating ?? '---'}
                </div>
              </div>
            </div>
          ) : (
            <button
              className="btn-ghost"
              style={{ padding: '8px 14px' }}
              onClick={() => router.push('/login')}
            >
              ログイン
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
