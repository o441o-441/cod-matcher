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
  const [eliminationType, setEliminationType] = useState<'single' | 'double'>('single')
  const [entryMode, setEntryMode] = useState<'team' | 'solo'>('team')
  const [matchFormat, setMatchFormat] = useState('bo1')
  const [bo1Mode, setBo1Mode] = useState('random')
  const [capacity, setCapacity] = useState(8)
  const [rateCapOn, setRateCapOn] = useState(false)
  const [rateCap, setRateCap] = useState(2000)
  const [seedingMethod, setSeedingMethod] = useState('random')
  const [entryDeadline, setEntryDeadline] = useState('')
  const [eventStart, setEventStart] = useState('')
  const [prize, setPrize] = useState('')
  const [rules, setRules] = useState('')
  const [gfReset, setGfReset] = useState(true)
  // Block league
  const [blockCount, setBlockCount] = useState(1)
  const [playoffAdvance, setPlayoffAdvance] = useState<number | null>(null)
  const [playoffElimType, setPlayoffElimType] = useState<'single' | 'double'>('single')

  const handleCreate = async () => {
    if (!title.trim()) { showToast('タイトルを入力してください', 'error'); return }

    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { showToast('ログインが必要です', 'error'); setLoading(false); return }

    const { data, error } = await supabase.from('tournaments').insert({
      title: title.trim(),
      description: description.trim() || null,
      format,
      elimination_type: eliminationType,
      entry_mode: entryMode,
      match_format: matchFormat,
      bo1_mode: matchFormat === 'bo1' ? bo1Mode : 'random',
      status: 'recruit',
      capacity,
      rate_cap: rateCapOn ? rateCap : null,
      seeding_method: seedingMethod,
      entry_deadline: entryDeadline || null,
      event_start: eventStart || null,
      host_user_id: session.user.id,
      prize: prize.trim() || null,
      rules: rules.trim() || null,
      gf_reset: eliminationType === 'double' || playoffElimType === 'double' ? gfReset : true,
      block_count: format === 'league' ? blockCount : 1,
      playoff_advance_count: format === 'league' && blockCount >= 2 ? playoffAdvance : null,
      playoff_elimination_type: format === 'league' && blockCount >= 2 ? playoffElimType : 'single',
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
            <label htmlFor="t-title" className="stat-label">大会タイトル</label>
            <input id="t-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="例: NEON CIRCUIT VOL.08" aria-required="true" />
          </div>

          <div>
            <label htmlFor="t-desc" className="stat-label">説明</label>
            <textarea id="t-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="大会の説明、ルール等" rows={3} />
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

          {/* エリミネーションタイプ（トーナメント形式のみ） */}
          {format === 'tournament' && (
            <div>
              <div className="stat-label">エリミネーション方式</div>
              <div className="grid grid-2" style={{ marginTop: 8 }}>
                <button
                  className="card"
                  style={{ textAlign: 'center', padding: 16, border: eliminationType === 'single' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                  onClick={() => setEliminationType('single')}
                >
                  <div style={{ fontWeight: 700 }}>SINGLE</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>1敗で敗退</p>
                </button>
                <button
                  className="card"
                  style={{ textAlign: 'center', padding: 16, border: eliminationType === 'double' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                  onClick={() => setEliminationType('double')}
                >
                  <div style={{ fontWeight: 700 }}>DOUBLE</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>2敗で敗退（敗者復活あり）</p>
                </button>
              </div>
            </div>
          )}

          {/* ブロック設定（リーグ形式のみ） */}
          {format === 'league' && (
            <div>
              <div className="stat-label">ブロック（グループ）数</div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                推奨: {Math.max(1, Math.floor(capacity / 4))}ブロック（1ブロック約{Math.ceil(capacity / Math.max(1, Math.floor(capacity / 4)))}チーム）
              </p>
              <select value={blockCount} onChange={e => setBlockCount(Number(e.target.value))} style={{ marginTop: 4 }}>
                <option value={1}>1（総当たり・ブロック分けなし）</option>
                {[2, 3, 4, 6, 8].filter(n => n <= capacity / 2).map(n => (
                  <option key={n} value={n}>{n}ブロック（各{Math.ceil(capacity / n)}チーム）</option>
                ))}
              </select>
            </div>
          )}

          {/* ブロックリーグ決勝設定 */}
          {format === 'league' && blockCount >= 2 && (
            <>
              <div>
                <label htmlFor="t-advance" className="stat-label">各グループ進出数</label>
                <p className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                  推奨: 各グループ上位{Math.max(1, Math.floor(Math.ceil(capacity / blockCount) / 2))}チーム → 決勝{Math.max(1, Math.floor(Math.ceil(capacity / blockCount) / 2)) * blockCount}チーム
                </p>
                <input id="t-advance" type="number" value={playoffAdvance ?? Math.max(1, Math.floor(Math.ceil(capacity / blockCount) / 2))} onChange={e => setPlayoffAdvance(e.target.value ? Number(e.target.value) : null)} min={1} max={Math.ceil(capacity / blockCount) - 1} style={{ marginTop: 4 }} />
              </div>
              <div>
                <div className="stat-label">決勝トーナメント形式</div>
                <div className="grid grid-2" style={{ marginTop: 8 }}>
                  <button type="button" className="card" style={{ textAlign: 'center', padding: 16, border: playoffElimType === 'single' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }} onClick={() => setPlayoffElimType('single')}>
                    <div style={{ fontWeight: 700 }}>SINGLE</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>1敗で敗退</p>
                  </button>
                  <button type="button" className="card" style={{ textAlign: 'center', padding: 16, border: playoffElimType === 'double' ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }} onClick={() => setPlayoffElimType('double')}>
                    <div style={{ fontWeight: 700 }}>DOUBLE</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>2敗で敗退</p>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* GFリセット（ダブルエリミのみ） */}
          {((format === 'tournament' && eliminationType === 'double') || (format === 'league' && blockCount >= 2 && playoffElimType === 'double')) && (
            <div>
              <div className="stat-label">Grand Final リセット</div>
              <div className="grid grid-2" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="card"
                  style={{ textAlign: 'center', padding: 16, border: gfReset ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                  onClick={() => setGfReset(true)}
                >
                  <div style={{ fontWeight: 700 }}>ON</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Losers側がGFに勝ったらリセットマッチ</p>
                </button>
                <button
                  type="button"
                  className="card"
                  style={{ textAlign: 'center', padding: 16, border: !gfReset ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                  onClick={() => setGfReset(false)}
                >
                  <div style={{ fontWeight: 700 }}>OFF</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GF1回のみ、リセットなし</p>
                </button>
              </div>
            </div>
          )}

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
              <label htmlFor="t-capacity" className="stat-label">{entryMode === 'team' ? 'チーム数' : 'プレイヤー数'}</label>
              <select id="t-capacity" value={capacity} onChange={e => setCapacity(Number(e.target.value))} style={{ marginTop: 6 }}>
                {[4, 8, 16, 32, 64].map(n => (
                  <option key={n} value={n}>{n} {entryMode === 'team' ? 'teams' : 'players'}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-match-format" className="stat-label">試合形式</label>
              <select id="t-match-format" value={matchFormat} onChange={e => setMatchFormat(e.target.value)} style={{ marginTop: 6 }}>
                <option value="bo1">BO1</option>
                <option value="bo3">BO3</option>
                <option value="bo5">BO5</option>
              </select>
            </div>
          </div>

          {/* BO1モード選択 */}
          {matchFormat === 'bo1' && (
            <div>
              <div className="stat-label">BO1 モード</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
                {[
                  { value: 'random', label: 'ランダム', desc: 'HP:67% SND:22% OVL:11%' },
                  { value: 'hp', label: 'HARDPOINT', desc: '固定' },
                  { value: 'snd', label: 'S&D', desc: '固定' },
                  { value: 'ovl', label: 'OVERLOAD', desc: '固定' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    className="card"
                    style={{ textAlign: 'center', padding: 12, cursor: 'pointer', border: bo1Mode === opt.value ? '2px solid var(--cyan)' : undefined }}
                    onClick={() => setBo1Mode(opt.value)}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 日程 */}
          <div className="grid grid-2">
            <div>
              <label htmlFor="t-deadline" className="stat-label">エントリー締切</label>
              <input id="t-deadline" type="datetime-local" value={entryDeadline} onChange={e => setEntryDeadline(e.target.value)} style={{ marginTop: 6 }} />
            </div>
            <div>
              <label htmlFor="t-start" className="stat-label">開始日時</label>
              <input id="t-start" type="datetime-local" value={eventStart} onChange={e => setEventStart(e.target.value)} style={{ marginTop: 6 }} />
            </div>
          </div>

          {/* レート制限 */}
          <div>
            <div className="stat-label">ピークレート制限</div>
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="card"
                style={{ textAlign: 'center', padding: 16, border: !rateCapOn ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                onClick={() => setRateCapOn(false)}
              >
                <div style={{ fontWeight: 700 }}>なし</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>レート制限なし</p>
              </button>
              <button
                type="button"
                className="card"
                style={{ textAlign: 'center', padding: 16, border: rateCapOn ? '2px solid var(--cyan)' : undefined, cursor: 'pointer' }}
                onClick={() => setRateCapOn(true)}
              >
                <div style={{ fontWeight: 700 }}>あり</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>ピークレートで参加制限</p>
              </button>
            </div>
            {rateCapOn && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor="t-ratecap" className="stat-label">レート上限値</label>
                <input id="t-ratecap" type="number" value={rateCap} onChange={e => setRateCap(Number(e.target.value))} min={1000} max={3000} step={100} aria-describedby="ratecap-hint" style={{ marginTop: 6 }} />
                <p id="ratecap-hint" className="muted" style={{ fontSize: 11, marginTop: 4 }}>最高レートがこの値以下のプレイヤー/チームのみ参加可能</p>
              </div>
            )}
          </div>

          {/* シード方式 */}
          <div>
            <label htmlFor="t-seeding" className="stat-label">シード/振り分け方式</label>
            <select id="t-seeding" value={seedingMethod} onChange={e => setSeedingMethod(e.target.value)} style={{ marginTop: 6 }}>
              <option value="random">ランダム</option>
              <option value="rating">レート考慮（バランス配分）</option>
              <option value="manual">主催者が手動で振り分け</option>
            </select>
          </div>

          {/* 賞品 */}
          <div>
            <label htmlFor="t-prize" className="stat-label">賞品（任意）</label>
            <input id="t-prize" value={prize} onChange={e => setPrize(e.target.value)} placeholder="例: 500K / コスメティックバンドル" style={{ marginTop: 6 }} />
          </div>

          {/* 追加ルール */}
          <div>
            <label htmlFor="t-rules" className="stat-label">追加ルール（任意）</label>
            <textarea id="t-rules" value={rules} onChange={e => setRules(e.target.value)} placeholder="GA準拠、禁止武器等" rows={2} style={{ marginTop: 6 }} />
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
