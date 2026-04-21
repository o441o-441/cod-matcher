'use client'

import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const handleDiscordLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      alert(error.message)
    }
  }

  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
      <div className="card-strong" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div className="eyebrow">ASCENT</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          <em>ログイン</em>
        </h1>
        <p className="muted" style={{ marginBottom: 24 }}>
          Discordアカウントでログインしてください
        </p>
        <button className="btn-primary btn-block btn-lg" onClick={handleDiscordLogin}>
          Discordでログイン
        </button>
      </div>
    </main>
  )
}
