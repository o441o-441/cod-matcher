'use client'

import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="footer-new">
      <div className="container">
        <div className="foot-grid">
          <div className="foot-col">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo_yoko.png" alt="ASCENT" style={{ height: 38, marginBottom: 16, filter: 'drop-shadow(0 0 12px rgba(0,229,255,0.25))' }} />
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: 0, maxWidth: 320 }}>
              Call of Dutyの4v4競技シーンを1つに。ランクマッチ・カスタム・スクリム・大会運営をワンストップで提供。
            </p>
            <div className="foot-social" style={{ marginTop: 18 }}>
              <a href="https://discord.gg/" target="_blank" rel="noopener noreferrer" aria-label="Discord">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02" /></svg>
              </a>
              <a href="https://x.com/" target="_blank" rel="noopener noreferrer" aria-label="X">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </a>
            </div>
          </div>
          <div className="foot-col">
            <h4>Play</h4>
            <ul>
              <li><Link href="/match">ランクマッチ</Link></li>
              <li><Link href="/custom">8人カスタム</Link></li>
              <li><Link href="/custom">スクリム</Link></li>
              <li><Link href="/tournaments">大会一覧</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Compete</h4>
            <ul>
              <li><Link href="/ranking">ランキング</Link></li>
              <li><Link href="/tiers">ティア表</Link></li>
              <li><Link href="/mypage">マイページ</Link></li>
              <li><Link href="/history">対戦履歴</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>About</h4>
            <ul>
              <li><Link href="/rules">ルール</Link></li>
              <li><Link href="/blog">コントローラーレビュー</Link></li>
              <li><Link href="/terms">利用規約</Link></li>
              <li><Link href="/privacy">プライバシー</Link></li>
            </ul>
          </div>
        </div>
        <div className="foot-divider" />
        <div className="foot-bottom">
          <div className="foot-copy">&copy; 2026 ASCENT · CoD 4v4 PLATFORM</div>
          <div className="row" style={{ gap: 16 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--success)', boxShadow: '0 0 8px var(--success)', marginRight: 8, verticalAlign: 'middle' }} />
              ALL SYSTEMS NOMINAL
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
