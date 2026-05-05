'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

export default function TournamentCreatePage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<'tournament' | 'league'>('tournament')
  const [entryMode, setEntryMode] = useState<'team' | 'solo'>('team')
  const [matchFormat, setMatchFormat] = useState('bo1')
  const [capacity, setCapacity] = useState(8)
  const [rateCapOn, setRateCapOn] = useState(false)
  const [rateCap, setRateCap] = useState(2000)
  const [seedingMethod, setSeedingMethod] = useState('random')
  const [entryDeadline, setEntryDeadline] = useState('')
  const [eventStart, setEventStart] = useState('')
  const [prize, setPrize] = useState('')
  const [rules, setRules] = useState('')

  const handleCreate = async () => {
    if (!title.trim()) { showToast('タイトルを入力してください', 'error'); return }

    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { showToast('ログインが必要です', 'error'); setLoading(false); return }

    const { data, error } = await supabase.from('tournaments').insert({
      title: title.trim(),
      description: description.trim() || null,
      format,
      entry_mode: entryMode,
      match_format: matchFormat,
      status: 'recruit',
      capacity,
      rate_cap: rateCapOn ? rateCap : null,
      seeding_method: seedingMethod,
      entry_deadline: entryDeadline || null,
      event_start: eventStart || null,
      host_user_id: session.user.id,
      prize: prize.trim() || null,
      rules: rules.trim() || null,
    }).select('id').single()

    setLoading(false)

    if (error) {
      showToast(error.message || '大会作成に失敗しました', 'error')
      return
    }

    showToast('大会を作成しました', 'success')
    router.push(`/tournaments/${(data as { id: string }).id}`)
  }

  return (
    <main>
      <div className="eyebrow">TOURNAMENTS / CREATE</div>
      <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
        <em>大会を開催</em>
      </h1>
      <p className="muted">リーグかトーナメントか、チームか個人か。すべてここで決める。</p>

      <div className="section" style={{ maxWidth: 800 }}>
        <div className="card-strong stack">
          {/* タイトル */}
          <div>
            <div className="stat-label">大会タイトル</div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例: NEON CIRCUIT VOL.08" />
          </div>

          <div>
            <div className="stat-label">説明</div>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="大会の説明、ルール等" rows={3} />
          </div>

          {/* 形式 */}
          <div>
            <div className="stat-label">形式</div>
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <button
                className={`card ${format === 'tournament' ? 'glow-hover' : ''}`}
                style={{ textAlign: 'center', padding: 16, border: format === 'tournament' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                onClick={() => setFormat('tournament')}
              >
                <div style={{ fontWeight: 700 }}>TOURNAMENT</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>単勝抜きのブラケット</p>
              </button>
              <button
                className={`card ${format === 'league' ? 'glow-hover' : ''}`}
                style={{ textAlign: 'center', padding: 16, border: format === 'league' ? '2px solid var(--violet, #8b5cf6)' : undefined, cursor: 'pointer' }}
                onClick={() => setFormat('league')}
              >
                <div style={{ fontWeight: 700 }}>LEAGUE</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>総当たり / ラウンドロビン</p>
              </button>
            </div>
          </div>

          {/* エントリー方式 */}
          <div>
            <div className="stat-label">エントリー方式</div>
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <button
                className="card"
                style={{ textAlign: 'center', padding: 16, border: entryMode === 'team' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                onClick={() => setEntryMode('team')}
              >
                <div style={{ fontWeight: 700 }}>TEAM 4v4</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>チーム単位でエントリー</p>
              </button>
              <button
                className="card"
                style={{ textAlign: 'center', padding: 16, border: entryMode === 'solo' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                onClick={() => setEntryMode('solo')}
              >
                <div style={{ fontWeight: 700 }}>SOLO → 4v4</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>個人エントリー → 自動チーム編成</p>
              </button>
            </div>
          </div>

          {/* 容量 + マッチ形式 */}
          <div className="grid grid-2">
            <div>
              <div className="stat-label">{entryMode === 'team' ? 'チーム数' : 'プレイヤー数'}</div>
              <select value={capacity} onChange={e => setCapacity(Number(e.target.value))} style={{ marginTop: 6 }}>
                {[4, 8, 16, 32, 64].map(n => (
                  <option key={n} value={n}>{n} {entryMode === 'team' ? 'teams' : 'players'}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="stat-label">試合形式</div>
              <select value={matchFormat} onChange={e => setMatchFormat(e.target.value)} style={{ marginTop: 6 }}>
                <option value="bo1">BO1</option>
                <option value="bo3">BO3</option>
                <option value="bo5">BO5</option>
              </select>
            </div>
          </div>

          {/* 日程 */}
          <div className="grid grid-2">
            <div>
              <div className="stat-label">エントリー締切</div>
              <input type="datetime-local" value={entryDeadline} onChange={e => setEntryDeadline(e.target.value)} style={{ marginTop: 6 }} />
            </div>
            <div>
              <div className="stat-label">開始日時</div>
              <input type="datetime-local" value={eventStart} onChange={e => setEventStart(e.target.value)} style={{ marginTop: 6 }} />
            </div>
          </div>

          {/* レート制限 */}
          <div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={rateCapOn} onChange={e => setRateCapOn(e.target.checked)} id="rate-cap-toggle" />
              <label htmlFor="rate-cap-toggle" className="stat-label" style={{ cursor: 'pointer' }}>ピークレート制限</label>
            </div>
            {rateCapOn && (
              <div style={{ marginTop: 8 }}>
                <input type="number" value={rateCap} onChange={e => setRateCap(Number(e.target.value))} min={1000} max={3000} step={100} />
                <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>最高レートがこの値以下のプレイヤー/チームのみ参加可能</p>
              </div>
            )}
          </div>

          {/* シード方式 */}
          <div>
            <div className="stat-label">シード/振り分け方式</div>
            <select value={seedingMethod} onChange={e => setSeedingMethod(e.target.value)} style={{ marginTop: 6 }}>
              <option value="random">ランダム</option>
              <option value="rating">レート考慮（バランス配分）</option>
              <option value="manual">主催者が手動で振り分け</option>
            </select>
          </div>

          {/* 賞品 */}
          <div>
            <div className="stat-label">賞品（任意）</div>
            <input value={prize} onChange={e => setPrize(e.target.value)} placeholder="例: 500K / コスメティックバンドル" style={{ marginTop: 6 }} />
          </div>

          {/* 追加ルール */}
          <div>
            <div className="stat-label">追加ルール（任意）</div>
            <textarea value={rules} onChange={e => setRules(e.target.value)} placeholder="GA準拠、禁止武器等" rows={2} style={{ marginTop: 6 }} />
          </div>

          {/* 送信 */}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
            <button className="btn-ghost" onClick={() => router.push('/tournaments')}>キャンセル</button>
            <button className="btn-primary" onClick={handleCreate} disabled={loading}>
              {loading ? '作成中...' : '大会を作成'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
