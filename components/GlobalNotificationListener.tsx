'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

function playNotificationSound() {
  try {
    const ctx = new AudioContext()
    const times = [
      { freq: 523, delay: 0 },
      { freq: 659, delay: 0.12 },
      { freq: 784, delay: 0.24 },
    ]
    for (const t of times) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(t.freq, ctx.currentTime + t.delay)
      gain.gain.setValueAtTime(0.2, ctx.currentTime + t.delay)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t.delay + 0.2)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + t.delay)
      osc.stop(ctx.currentTime + t.delay + 0.2)
    }
  } catch {
    // Audio not available
  }
}

export default function GlobalNotificationListener() {
  const { showToast } = useToast()
  const [userId, setUserId] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const subscribedRef = useRef(false)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!cancelled && session?.user?.id) {
        setUserId(session.user.id)
      }
    }
    void getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setUserId(session?.user?.id ?? null)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    if (subscribedRef.current) return
    subscribedRef.current = true

    const channel = supabase
      .channel(`global-notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { body?: string; link?: string | null }
          const body = typeof row.body === 'string' ? row.body : '新しい通知があります'
          playNotificationSound()
          showToast(body, 'info')
        }
      )
      .subscribe((status) => {
        // 接続断で通知が止まったままにならないよう、失敗時は少し待って再購読
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('notification channel status:', status)
          if (retryRef.current) clearTimeout(retryRef.current)
          retryRef.current = setTimeout(() => {
            subscribedRef.current = false
            void supabase.removeChannel(channel)
            setRetryTick((t) => t + 1)
          }, 5000)
        }
      })

    return () => {
      subscribedRef.current = false
      if (retryRef.current) clearTimeout(retryRef.current)
      void supabase.removeChannel(channel)
    }
  }, [userId, showToast, retryTick])

  return null
}
