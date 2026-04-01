'use client'

import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const handleDiscordLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/mypage`,
      },
    })

    if (error) {
      alert(error.message)
    }
  }

  return (
    <main style={{ padding: '40px' }}>
      <h1>ログイン</h1>
      <button onClick={handleDiscordLogin}>Discordでログイン</button>
    </main>
  )
}
