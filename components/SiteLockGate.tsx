'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ============================================================
// サイトロック (公開準備モード)
// app_settings.site_locked = 'true' の間、管理者以外は
// トップページと /login 以外へアクセスするとトップへ戻される。
// 解除は DB のスイッチを 'false' にするだけ (再デプロイ不要)。
// クライアント側ゲートなのでUX用の施錠であり、データ保護はRLSが担う。
// ============================================================

const ALLOWED_PATHS = ['/', '/login']

export default function SiteLockGate() {
  const pathname = usePathname()
  const router = useRouter()
  // null = 判定中 (未判定の間はリダイレクトしない)
  const [locked, setLocked] = useState<boolean | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const [{ data: lockRes }, { data: { session } }] = await Promise.all([
          supabase.rpc('rpc_site_lock'),
          supabase.auth.getSession(),
        ])
        if (cancelled) return
        const isLocked = !!(lockRes as { locked?: boolean } | null)?.locked
        setLocked(isLocked)
        if (!isLocked) { setIsAdmin(null); return }
        if (!session?.user) { setIsAdmin(false); return }
        const { data: prof } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', session.user.id)
          .maybeSingle<{ is_admin: boolean }>()
        if (!cancelled) setIsAdmin(!!prof?.is_admin)
      } catch {
        if (!cancelled) setLocked(false) // 判定失敗時はフェイルオープン
      }
    }
    void check()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (locked !== true || isAdmin !== false) return
    if (ALLOWED_PATHS.includes(pathname)) return
    router.replace('/')
  }, [locked, isAdmin, pathname, router])

  // ロック中に非管理者が許可外ページを開いた場合は、リダイレクトまで中身を隠す
  if (locked === true && isAdmin === false && !ALLOWED_PATHS.includes(pathname)) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 6000, display: 'grid', placeItems: 'center', background: 'rgba(5,8,14,0.92)' }}>
        <p className="muted" style={{ fontSize: 14 }}>公開準備中です — トップページへ戻ります...</p>
      </div>
    )
  }
  return null
}
