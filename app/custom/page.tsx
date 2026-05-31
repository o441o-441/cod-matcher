'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

type LobbyRow = {
  id: string; title: string; host_user_id: string; status: string
  rate_cap: number | null; created_at: string; member_count: number
  host_name: string | null
}

export default function CustomPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [tab, setTab] = useState<'8s' | 'scrim' | 'rules'>('8s')
  const [lobbies, setLobbies] = useState<LobbyRow[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createRateCap, setCreateRateCap] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const loadLobbies = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    setMyUserId(session?.user?.id ?? null)

    const { data } = await supabase
      .from('eights_lobbies')
      .select('id, title, host_user_id, status, rate_cap, created_at')
      .in('status', ['open', 'drafting'])
      .order('created_at', { ascending: false })

    const rows = (data ?? []) as { id: string; title: string; host_user_id: string; status: string; rate_cap: number | null; created_at: string }[]

    // Get member counts + host names
    const hostIds = [...new Set(rows.map(r => r.host_user_id))]
    const lobbyIds = rows.map(r => r.id)

    const [{ data: profiles }, { data: members }] = await Promise.all([
      hostIds.length > 0 ? supabase.from('profiles').select('id, display_name').in('id', hostIds) : Promise.resolve({ data: [] }),
      lobbyIds.length > 0 ? supabase.from('eights_lobby_members').select('lobby_id').in('lobby_id', lobbyIds) : Promise.resolve({ data: [] }),
    ])

    const nameMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]))
    const countMap = new Map<string, number>()
    for (const m of (members ?? []) as { lobby_id: string }[]) {
      countMap.set(m.lobby_id, (countMap.get(m.lobby_id) ?? 0) + 1)
    }

    setLobbies(rows.map(r => ({
      ...r,
      member_count: countMap.get(r.id) ?? 0,
      host_name: nameMap.get(r.host_user_id) ?? '不明',
    })))
  }, [])

  useEffect(() => { void loadLobbies() }, [loadLobbies])

  const handleCreate = async () => {
    if (!createTitle.trim()) { showToast('タイトルを入力してください', 'error'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_eights_create_lobby', {
      p_title: createTitle.trim(),
      p_rate_cap: createRateCap,
    })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    const result = data as { lobby_id: string }
    router.push(`/custom/eights/${result.lobby_id}`)
  }

  const handleJoin = async (lobbyId: string) => {
    setBusy(true)
    const { error } = await supabase.rpc('rpc_eights_join_lobby', { p_lobby_id: lobbyId })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    router.push(`/custom/eights/${lobbyId}`)
  }

  const HP_MAPS = ['酒', 'コロッサス', 'デン', 'スカー', 'グリッドロック', 'ハシエンダ']

  return (
    <main>
      <div className="eyebrow">CUSTOM / 8s + SCRIM</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        <em>カスタム</em>
      </h1>
      <p className="muted" style={{ marginTop: 10, maxWidth: 640 }}>
        8人カスタム（8s）と、パーティ単位でレートを近い相手とぶつけるスクリム（scrim）。ランクには影響しません。
      </p>

      {/* Tabs — large cards */}
      <div className="grid-3 section">
        <button type="button" className="card" onClick={() => setTab('8s')}
          style={{ textAlign: 'center', padding: 24, cursor: 'pointer', border: tab === '8s' ? '2px solid var(--cyan)' : undefined }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em' }}>8s</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>8人カスタム / 即席ロビー</p>
        </button>
        <button type="button" className="card" onClick={() => setTab('scrim')}
          style={{ textAlign: 'center', padding: 24, cursor: 'pointer', border: tab === 'scrim' ? '2px solid var(--magenta)' : undefined }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em' }}>SCRIM</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>パーティ vs パーティ / 練習試合</p>
        </button>
        <button type="button" className="card" onClick={() => setTab('rules')}
          style={{ textAlign: 'center', padding: 24, cursor: 'pointer', border: tab === 'rules' ? '2px solid var(--violet)' : undefined }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em' }}>RULES</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>8s と scrim のレギュレーション</p>
        </button>
      </div>

      {/* 8s Tab */}
      {tab === '8s' && (
        <div className="section">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>開催中の 8s ロビー</h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge"><span className="badge-dot" />LIVE {lobbies.length}</span>
              <button className="btn-primary" onClick={() => setShowCreate(true)}>+ 8s を開催する</button>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            8sを開催すると <span style={{ color: '#5865F2', fontWeight: 700 }}>Discord</span> の #8s-lobby に @everyone 通知が自動送信されます
          </p>

          {lobbies.length === 0 ? (
            <div className="empty">現在開催中の8sロビーはありません</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {lobbies.map(l => (
                <div key={l.id} className="card" style={{ padding: '14px 18px', cursor: 'pointer' }} onClick={() => handleJoin(l.id)}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{l.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>ホスト: {l.host_name}</div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge">{l.member_count}/8</span>
                      {l.rate_cap ? (
                        <span className="badge amber">≤ {l.rate_cap}</span>
                      ) : (
                        <span className="badge" style={{ fontSize: 9 }}>制限なし</span>
                      )}
                      <button className="btn-primary btn-sm" disabled={busy} onClick={e => { e.stopPropagation(); handleJoin(l.id) }}>参加</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create modal */}
          {showCreate && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}
              onClick={() => setShowCreate(false)}>
              <div className="card-strong" style={{ maxWidth: 460, width: '100%', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
                <h2 style={{ marginTop: 0 }}>8s を開催する</h2>
                <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'rgba(88,101,242,0.4)', background: 'rgba(88,101,242,0.08)' }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text)' }}>
                    <span style={{ color: '#5865F2', fontWeight: 700 }}>Discord</span> の #8s-lobby チャンネルに @everyone 通知が自動送信されます
                  </p>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="c-title" className="stat-label">ロビー名</label>
                  <input id="c-title" value={createTitle} onChange={e => setCreateTitle(e.target.value)} placeholder="例: YN's Lobby" style={{ marginTop: 6 }} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="c-rate" className="stat-label">ピークレート制限（任意）</label>
                  <input id="c-rate" type="number" value={createRateCap ?? ''} onChange={e => setCreateRateCap(e.target.value ? Number(e.target.value) : null)} placeholder="例: 2000（空欄で制限なし）" min={1000} max={3000} step={100} style={{ marginTop: 6 }} />
                </div>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn-ghost" onClick={() => setShowCreate(false)}>キャンセル</button>
                  <button className="btn-primary" onClick={handleCreate} disabled={busy}>{busy ? '作成中...' : '開催する'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scrim Tab */}
      {tab === 'scrim' && (
        <div className="section">
          <h2>Scrim</h2>
          <p className="muted">パーティ単位でキューをかけ、チームの最高個人レート平均が近い相手とマッチングされます。</p>
          <div className="card-strong" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontWeight: 700, margin: 0 }}>Scrim キュー</p>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>パーティを組むか、ソロで助っ人として参加できます</p>
              </div>
              <button className="btn-primary" onClick={() => router.push('/custom/scrim')}>
                Scrim キューへ
              </button>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16, padding: '14px 18px' }}>
            <div className="stat-label" style={{ marginBottom: 8 }}>HARDPOINT マッププール</div>
            <div className="row" style={{ gap: 6 }}>
              {HP_MAPS.map(m => <span key={m} className="badge" style={{ fontSize: 11 }}>{m}</span>)}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>scrimではバンピックは行わず、HPの全マップを実施します。</p>
          </div>
        </div>
      )}

      {/* Rules Tab */}
      {tab === 'rules' && (
        <div className="section">
          <h2>ルール</h2>
          <div className="card-strong markdown-body">
            <h3>8s ルール</h3>
            <ul>
              <li>参加人数: 8人（4v4）</li>
              <li>チーム振り分けはホストが実行（ランダム or レート+ロール考慮）</li>
              <li>ロール: AR, SMG, FLEX から各自選択</li>
              <li>レート制限を設けたロビーも開催可能</li>
              <li>レート変動なし</li>
            </ul>
            <h3>Scrim ルール</h3>
            <ul>
              <li>パーティ単位でキュー（ソロ参加も可能 — 助っ人として合流）</li>
              <li>マッチング: チームの最高個人レート平均が近い順</li>
              <li>モード: Hardpoint のみ（バンピックなし・全マップ実施）</li>
              <li>マッププール: {HP_MAPS.join(', ')}</li>
              <li>ホスト抽選あり</li>
              <li>1時間半経過で終了提案</li>
              <li>レート変動なし</li>
            </ul>
            <h3>共通ルール</h3>
            <ul>
              <li>GA（紳士協定）準拠</li>
              <li>チート・コンバーター使用禁止</li>
              <li>暴言・煽り行為禁止</li>
              <li>違反者は通報機能から報告してください</li>
            </ul>
          </div>
        </div>
      )}
    </main>
  )
}
