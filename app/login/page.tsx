'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()

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
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>ASCENT ログイン</h1>
        <button onClick={() => router.push('/')}>トップページに戻る</button>
      </div>
      <div className="section">
        <button onClick={handleDiscordLogin}>Discordでログイン</button>
      </div>
    </main>
  )
}
