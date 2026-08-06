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
  const [myLobbyId, setMyLobbyId] = useState<string | null>(null)

  const loadLobbies = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setMyUserId(uid)

    // Check if user is already in an active lobby
    if (uid) {
      const { data: myMembership } = await supabase
        .from('eights_lobby_members')
        .select('lobby_id, eights_lobbies!inner(id, status)')
        .eq('user_id', uid)
        .in('eights_lobbies.status', ['open', 'drafting'])
        .limit(1)
        .maybeSingle()
      setMyLobbyId((myMembership as { lobby_id: string } | null)?.lobby_id ?? null)
    }

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
    // Already in this lobby — just navigate
    if (myLobbyId === lobbyId) { router.push(`/custom/eights/${lobbyId}`); return }
    setBusy(true)
    const { error } = await supabase.rpc('rpc_eights_join_lobby', { p_lobby_id: lobbyId })
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    router.push(`/custom/eights/${lobbyId}`)
  }

  return (
    <main>
      <div className="eyebrow">CUSTOM / 8s + SCRIM</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        <em>カスタム</em>
      </h1>
      <p className="muted" style={{ marginTop: 10, maxWidth: 640 }}>
        8人カスタム（8s）と、チーム同士で対戦相手を見つける交流戦ボード（scrim）。ランクには影響しません。
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
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>チーム vs チーム / 交流戦ボード</p>
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

          {myLobbyId && (
            <div className="card" style={{ borderColor: 'rgba(0,245,160,0.35)', background: 'var(--success-soft)', marginBottom: 16, padding: '14px 18px' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>参加中のロビーがあります</span>
                <button className="btn-primary btn-sm" onClick={() => router.push(`/custom/eights/${myLobbyId}`)}>ロビーに戻る</button>
              </div>
            </div>
          )}

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
                      <button className={`${myLobbyId === l.id ? 'btn-ghost' : 'btn-primary'} btn-sm`} disabled={busy} onClick={e => { e.stopPropagation(); handleJoin(l.id) }}>
                        {myLobbyId === l.id ? '戻る' : '参加'}
                      </button>
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

      {/* Scrim Tab (交流戦ボード) */}
      {tab === 'scrim' && (
        <div className="section">
          <h2>交流戦ボード</h2>
          <p className="muted">1週間分のチームの空き時間を出し合い、ボードから相手チームを選んでその場で対戦を確定します。成立すると両チームの Discord に通知されます。</p>
          <div className="card-strong" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontWeight: 700, margin: 0 }}>交流戦ボード</p>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>空き時間の入力・相手探し・成立まですべてここから</p>
              </div>
              <button className="btn-primary" onClick={() => router.push('/custom/board')}>
                ボードへ
              </button>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16, padding: '14px 18px' }}>
            <div className="stat-label" style={{ marginBottom: 8 }}>ポイント</div>
            <div className="stack-sm" style={{ fontSize: 13 }}>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>1.</span>メンバーが空き時間を入力（曜日テンプレで自動反映も可）</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>2.</span>4人揃った枠が自動でボードに公開される</div>
              <div className="muted"><span style={{ color: 'var(--magenta)', marginRight: 8, fontWeight: 700 }}>3.</span>モード（ハーポ回し / サーチ / オバロ / 複合）を選んで相手の ▶ を押すだけ</div>
            </div>
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
            <h3>交流戦ボード（Scrim）ルール</h3>
            <ul>
              <li>チーム単位で参加（4人以上のチームが必要）</li>
              <li>各枠30分（20:00〜25:00）。同じ枠に4人以上揃うと募集として公開</li>
              <li>モード: ハーポ回し / サーチ / オバロ / 複合（マップ数選択可）</li>
              <li>成立と同時に両チームの Discord に通知（キャンセル時も通知）</li>
              <li>キャンセル回数は相手チームから見えます</li>
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
