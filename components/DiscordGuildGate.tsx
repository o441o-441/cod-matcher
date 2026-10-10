'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ============================================================
// 専用Discordサーバー参加の強制ゲート (AppShellでグローバル表示)
//
// ログイン中のユーザーに対して Edge Function `discord-guild` で
// サーバー参加を確認する。guilds.join スコープのトークンが
// あれば関数側で自動参加するため、通常ユーザーには何も見えない。
// 未参加が確定した場合のみ全画面モーダルでブロックする。
// 判定不能 (Bot未設定・Discord障害) はフェイルオープン。
// ============================================================

const CACHE_KEY = 'discord_guild_ok_v1'
const CACHE_TTL = 30 * 60 * 1000 // 参加確認済みの再チェック間隔

export default function DiscordGuildGate({ uid }: { uid: string }) {
  const [blocked, setBlocked] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const runCheck = useCallback(async (force: boolean) => {
    if (!force) {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (raw) {
          const c = JSON.parse(raw) as { t: number; uid: string }
          if (c.uid === uid && Date.now() - c.t < CACHE_TTL) return
        }
      } catch { /* キャッシュ破損は無視して再チェック */ }
    }
    setChecking(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data, error } = await supabase.functions.invoke('discord-guild', {
        body: { provider_token: session.provider_token ?? null },
      })
      if (error) { setBlocked(false); return } // フェイルオープン
      const r = data as { member: boolean | null; invite_url: string | null }
      setInviteUrl(r.invite_url)
      if (r.member === false) {
        sessionStorage.removeItem(CACHE_KEY)
        setBlocked(true)
      } else {
        setBlocked(false)
        if (r.member === true) {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), uid }))
        }
      }
    } catch {
      setBlocked(false) // フェイルオープン
    } finally {
      setChecking(false)
    }
  }, [uid])

  useEffect(() => { void runCheck(false) }, [runCheck])

  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (!blocked) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 5000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(5,8,14,0.88)', backdropFilter: 'blur(10px)' }}
      role="dialog" aria-modal="true" aria-label="Discordサーバーへの参加が必要です">
      <div className="card-strong" style={{ maxWidth: 480, width: '100%' }}>
        <div className="eyebrow">COMMUNITY REQUIRED</div>
        <h2 style={{ marginTop: 8, fontSize: 22 }}>Discordサーバーへの参加が必要です</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
          ASCENTの利用には専用Discordサーバーへの参加が必要です。
          対戦の連絡・8sの募集通知・運営からのお知らせはすべてサーバー内で行われます。
          参加後に「参加を確認」を押してください。
        </p>
        <div className="stack-sm" style={{ marginTop: 16 }}>
          {inviteUrl ? (
            <a href={inviteUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-block btn-lg"
              style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}>
              Discordサーバーに参加する
            </a>
          ) : (
            <p className="danger" style={{ fontSize: 12, margin: 0 }}>招待リンクが未設定です。運営にお問い合わせください。</p>
          )}
          <button className="btn-ghost btn-block" onClick={() => void runCheck(true)} disabled={checking}>
            {checking ? '確認中...' : '参加を確認'}
          </button>
          <button type="button" onClick={() => void logout()}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, padding: 6 }}>
            ログアウトする
          </button>
        </div>
      </div>
    </div>
  )
}
