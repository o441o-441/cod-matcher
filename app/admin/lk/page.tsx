'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard } from '@/components/UIState'
import ScrimStatsDashboard from '@/components/ScrimStatsDashboard'

// ============================================================
// 運営用: LK動画解析・データ登録ページ
//
// ボード外の対戦 (外部チームとの対戦など) を手動で登録し、
// 既存のLK解析フロー (/custom/board/[matchId]) でデータ化する。
// 相手チーム名は自由入力 — 存在しない場合は非表示の
// プレースホルダーチームが自動作成される (一覧には出ない)。
// 登録は rpc_admin_lk_register_match (管理者のみ・通知なし)。
// ============================================================

const slotLabel = (i: number) => `${5 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`
const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type TeamRow = { id: string; name: string; is_disbanded: boolean }
type MatchRow = {
  id: string; date: string; slot_start: number
  host_team_id: string | null; guest_team_id: string | null
  status: string; created_at: string
  host_name?: string; guest_name?: string; games?: number
}

export default function AdminLkPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [recent, setRecent] = useState<MatchRow[]>([])

  const [hostTeamId, setHostTeamId] = useState('')
  const [opponent, setOpponent] = useState('')
  const [date, setDate] = useState(fmtDate(new Date()))
  const [slotStart, setSlotStart] = useState(32) // 21:00
  const [hpMaps, setHpMaps] = useState(6)
  const [sndMaps, setSndMaps] = useState(0)
  const [ovlMaps, setOvlMaps] = useState(0)
  const [busy, setBusy] = useState(false)
  // 累計データ表示用 (記録用チーム含む任意のチーム)
  const [statsTeamId, setStatsTeamId] = useState('')

  const load = useCallback(async () => {
    const [{ data: teamRows }, { data: matchRows }] = await Promise.all([
      supabase.from('teams').select('id, name, is_disbanded').order('is_disbanded').order('name'),
      supabase.from('scrim_matches')
        .select('id, date, slot_start, host_team_id, guest_team_id, status, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    const ts = (teamRows ?? []) as TeamRow[]
    setTeams(ts)

    const ms = (matchRows ?? []) as MatchRow[]
    const nameOf = new Map(ts.map(t => [t.id, t.name]))
    // 保存済みゲーム数 (解析済みかどうかの目印)
    if (ms.length > 0) {
      const { data: gameRows } = await supabase
        .from('scrim_match_games')
        .select('match_id')
        .in('match_id', ms.map(m => m.id))
      const counts = new Map<string, number>()
      for (const g of (gameRows ?? []) as { match_id: string }[]) {
        counts.set(g.match_id, (counts.get(g.match_id) ?? 0) + 1)
      }
      for (const m of ms) {
        m.host_name = m.host_team_id ? nameOf.get(m.host_team_id) ?? '不明' : '(混成)'
        m.guest_name = m.guest_team_id ? nameOf.get(m.guest_team_id) ?? '不明' : '(混成)'
        m.games = counts.get(m.id) ?? 0
      }
    }
    setRecent(ms)
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }
      const { data: me } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()
      if (!me?.is_admin) { showToast('権限がありません', 'error'); router.push('/menu'); return }
      setAuthorized(true)
      await load()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRegister = async () => {
    if (!hostTeamId) { showToast('自チームを選択してください', 'error'); return }
    if (!opponent.trim()) { showToast('相手チーム名を入力してください', 'error'); return }
    if (hpMaps + sndMaps + ovlMaps === 0) { showToast('モード構成を1つ以上指定してください', 'error'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_admin_lk_register_match', {
      p_host_team_id: hostTeamId,
      p_opponent_name: opponent.trim(),
      p_date: date,
      p_slot_start: slotStart,
      p_hp_maps: hpMaps,
      p_snd_maps: sndMaps,
      p_ovl_maps: ovlMaps,
    })
    setBusy(false)
    if (error) { showToast(error.message || '登録に失敗しました', 'error'); return }
    const matchId = (data as { match_id?: string } | null)?.match_id
    showToast('対戦を登録しました。LK解析ページへ移動します', 'success')
    if (matchId) router.push(`/custom/board/${matchId}`)
  }

  if (loading || !authorized) {
    return (
      <main>
        <div className="eyebrow">ADMIN / LK</div>
        <h1 className="display" style={{ marginBottom: 8 }}><em>LK解析</em>・データ登録</h1>
        <LoadingCard />
      </main>
    )
  }

  return (
    <main>
      <div className="eyebrow">ADMIN / LK</div>
      <h1 className="display" style={{ marginBottom: 8 }}><em>LK解析</em>・データ登録</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        ボード外の対戦 (外部チームとの対戦など) を登録して、既存のLK動画解析でスタッツ・ヒル推移をデータ化します。
        登録した対戦の解析・集計は通常の試合ページと同じ画面で行います (通知は飛びません)。
      </p>

      {/* 登録フォーム */}
      <div className="section card-strong">
        <div className="sec-title">対戦を登録</div>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <div>
            <label className="stat-label">自チーム (データを紐付けるチーム)</label>
            <select value={hostTeamId} onChange={e => setHostTeamId(e.target.value)} style={{ marginTop: 4 }}>
              <option value="">選択してください</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.is_disbanded ? ' (解散済み)' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="stat-label">相手チーム名 (自由入力)</label>
            <input
              value={opponent}
              onChange={e => setOpponent(e.target.value)}
              placeholder="相手チーム名"
              maxLength={30}
              list="lk-team-names"
              style={{ marginTop: 4 }}
            />
            <datalist id="lk-team-names">
              {teams.filter(t => t.id !== hostTeamId).map(t => <option key={t.id} value={t.name} />)}
            </datalist>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="stat-label">日付</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ marginTop: 4 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="stat-label">開始時刻</label>
              <select value={slotStart} onChange={e => setSlotStart(Number(e.target.value))} style={{ marginTop: 4 }}>
                {Array.from({ length: 48 }, (_, i) => <option key={i} value={i}>{slotLabel(i)}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="stat-label">ハーポ</label>
              <select value={hpMaps} onChange={e => setHpMaps(Number(e.target.value))} style={{ marginTop: 4 }}>
                {[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}マップ</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="stat-label">サーチ</label>
              <select value={sndMaps} onChange={e => setSndMaps(Number(e.target.value))} style={{ marginTop: 4 }}>
                {[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}マップ</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="stat-label">ハイジャック</label>
              <select value={ovlMaps} onChange={e => setOvlMaps(Number(e.target.value))} style={{ marginTop: 4 }}>
                {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}マップ</option>)}
              </select>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          相手チームがASCENTに存在しない場合は、一覧に表示されない記録用チームが自動作成されます。
          同名のチームが既にある場合はそのチームに紐付きます。
        </p>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn-primary" onClick={() => void handleRegister()} disabled={busy}>
            {busy ? '登録中...' : '対戦を登録して解析へ →'}
          </button>
        </div>
      </div>

      {/* 累計データ (チームページと同じスタッツダッシュボード) */}
      <div className="section card-strong">
        <div className="rowx">
          <div className="sec-title" style={{ marginBottom: 0 }}>累計データ</div>
          <select
            value={statsTeamId}
            onChange={e => setStatsTeamId(e.target.value)}
            style={{ width: 'auto', minWidth: 220 }}
          >
            <option value="">チームを選択 (記録用チームも可)</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.is_disbanded ? ' (記録用/解散済み)' : ''}</option>
            ))}
          </select>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
          チームページの累計データと同じ集計です。管理者登録の対戦も、そのチームが参加した対戦として含まれます。
        </p>
      </div>
      {statsTeamId && <ScrimStatsDashboard key={statsTeamId} teamId={statsTeamId} />}

      {/* 最近の対戦 */}
      <div className="section card-strong">
        <div className="sec-title">最近の対戦 (解析・集計はリンク先で)</div>
        {recent.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>対戦がありません</p>
        ) : (
          <div className="stack-sm">
            {recent.map(m => (
              <div key={m.id} className="card" style={{ padding: '10px 14px', cursor: 'pointer' }}
                role="button" tabIndex={0}
                onClick={() => router.push(`/custom/board/${m.id}`)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/custom/board/${m.id}`) } }}>
                <div className="rowx">
                  <span style={{ fontWeight: 700, fontSize: 14 }}>
                    {m.host_name} <span className="muted">vs</span> {m.guest_name}
                  </span>
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {m.date} {slotLabel(m.slot_start)}
                    {m.status === 'cancelled' && ' · キャンセル'}
                    {' · '}
                    <span style={{ color: (m.games ?? 0) > 0 ? 'var(--success)' : 'var(--text-dim)' }}>
                      {(m.games ?? 0) > 0 ? `解析済み ${m.games}ゲーム` : '未解析'}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
