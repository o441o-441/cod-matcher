'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'ascent.cookieConsent'

type ConsentValue = 'accepted' | 'rejected'

export function getCookieConsent(): ConsentValue | null {
  if (typeof window === 'undefined') return null
  const v = window.localStorage.getItem(STORAGE_KEY)
  if (v === 'accepted' || v === 'rejected') return v
  return null
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const checkConsent = () => {
      if (getCookieConsent() === null) {
        setVisible(true)
      }
    }
    void Promise.resolve().then(checkConsent)
  }, [])

  const handleChoice = (value: ConsentValue) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // ignore storage errors
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie 同意"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        maxWidth: 720,
        margin: '0 auto',
        padding: '16px 20px',
        borderRadius: 14,
        border: '1px solid rgba(0, 229, 255, 0.35)',
        background: 'rgba(8, 12, 26, 0.92)',
        backdropFilter: 'blur(14px)',
        boxShadow:
          '0 0 0 1px rgba(0, 229, 255, 0.08) inset, 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 24px rgba(0, 229, 255, 0.2)',
        color: '#e8eeff',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ flex: '1 1 280px', fontSize: '0.9rem', lineHeight: 1.5 }}>
        本サイトでは、ユーザー体験の向上、アクセス解析および広告配信のために
        Cookie および類似技術を使用することがあります。詳細は{' '}
        <Link href="/privacy" style={{ textDecoration: 'underline' }}>
          プライバシーポリシー
        </Link>{' '}
        をご確認ください。
      </div>
      <div className="row" style={{ flex: '0 0 auto', gap: 8 }}>
        <button
          type="button"
          onClick={() => handleChoice('rejected')}
          style={{
            padding: '8px 14px',
            fontSize: '0.8rem',
          }}
        >
          拒否
        </button>
        <button
          type="button"
          onClick={() => handleChoice('accepted')}
          style={{
            padding: '8px 14px',
            fontSize: '0.8rem',
          }}
        >
          同意する
        </button>
      </div>
    </div>
  )
}
