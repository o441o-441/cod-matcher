'use client'

import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container rowx">
        <div className="row">
          <span className="brand-word">
            ASCENT<em>.</em>
          </span>
          <span className="dim">&copy; 2026 — Ranked Matchmaking Platform</span>
        </div>
        <div className="row">
          <Link href="/terms">利用規約</Link>
          <Link href="/privacy">プライバシー</Link>
          <a href="https://discord.gg/" target="_blank" rel="noopener noreferrer">
            Discord
          </a>
        </div>
      </div>
    </footer>
  )
}
