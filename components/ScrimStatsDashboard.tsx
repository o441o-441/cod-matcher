'use client'

// ============================================================
// 交流戦スタッツダッシュボード (チームページ用)
//
// スコアボード提出 (scrim_match_games / scrim_game_player_stats) を
// クライアント側で集計して表示する。参考: たぬき合戦データ解析.xlsx
//   - フィルター: 対戦相手 / サイド / モード / マップ / 期間(直近N試合)
//   - チーム概要 / プレイヤー比較 / マップ別成績 / マップ別K/D /
//     モード別成績 / 対戦相手別成績 / 試合一覧
// K/D・(K+A)/D は合計キル÷合計デスで算出 (試合ごとの平均ではない)。
// 勝率は勝敗がついたゲームのみ対象。得失点差はスコアが両方あるゲームのみ。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const MODE_LABEL: Record<string, string> = { hp: 'ハードポイント', snd: 'サーチ&デストロイ', ovl: 'オーバーロード' }
const MODE_SHORT: Record<string, string> = { hp: 'HP', snd: 'SND', ovl: 'OVL' }

type GameRow = {
  id: string
  match_id: string
  game_no: number
  mode: string
  map: string | null
  host_score: number | null
  guest_score: number | null
  duration_seconds: number | null
  created_at: string
}

type StatRow = {
  game_id: string
  side: string
  raw_name: string
  user_id: string | null
  kills: number | null
  deaths: number | null
  assists: number | null
  damage: number | null
  stats: Record<string, unknown> | null
}

// 1ゲームを自チーム視点に変換した行
type Game = {
  id: string
  matchId: string
  date: string
  createdAt: string
  mode: string
  map: string
  side: 'host' | 'guest'
  opponent: string
  ownScore: number | null
  oppScore: number | null
  result: 'w' | 'l' | 'd' | null
  diff: number | null
  duration: number | null
}

type PlayerAgg = {
  key: string
  name: string
  linked: boolean
  games: number
  wins: number
  losses: number
  k: number
  d: number
  a: number
  dmg: number
  objTimeSum: number
  objTimeN: number
  objKillsSum: number
  objKillsN: number
  onesidedSum: number
  onesidedN: number
  maxStreak: number
  plants: number
  defuses: number
  firstBloods: number
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const fmt = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(digits)

const fmtPct = (wins: number, losses: number): string =>
  wins + losses === 0 ? '-' : `${Math.round((wins / (wins + losses)) * 100)}%`

const fmtSigned = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`

const fmtDur = (sec: number | null): string => {
  if (sec === null || !Number.isFinite(sec)) return '-'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const kd = (k: number, d: number): number | null => (d > 0 ? k / d : k > 0 ? k : null)

const thStyle: React.CSSProperties = { textAlign: 'right', fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap' }
const thLeft: React.CSSProperties = { ...thStyle, textAlign: 'left' }
const tdStyle: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', whiteSpace: 'nowrap' }
const tdLeft: React.CSSProperties = { ...tdStyle, textAlign: 'left' }

function StatTable({ head, children, minWidth = 520 }: { head: React.ReactNode; children: React.ReactNode; minWidth?: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth, fontSize: 12, borderCollapse: 'collapse' }}>
        <thead><tr className="muted" style={{ fontSize: 10, borderBottom: '1px solid var(--line)' }}>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export default function ScrimStatsDashboard({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [games, setGames] = useState<Game[]>([])
  const [statRows, setStatRows] = useState<StatRow[]>([])
  const [nameMap, setNameMap] = useState<Record<string, string>>({})

  const [fOpp, setFOpp] = useState('all')
  const [fSide, setFSide] = useState('all')
  const [fMode, setFMode] = useState('all')
  const [fMap, setFMap] = useState('all')
  const [fRange, setFRange] = useState('all')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data: matchData } = await supabase
        .from('scrim_matches')
        .select('id, date, host_team_id, guest_team_id, host_room_id, guest_room_id')
        .or(`host_team_id.eq.${teamId},guest_team_id.eq.${teamId}`)
      const matches = (matchData ?? []) as {
        id: string; date: string
        host_team_id: string | null; guest_team_id: string | null
        host_room_id: string | null; guest_room_id: string | null
      }[]
      if (matches.length === 0) { if (!cancelled) { setGames([]); setStatRows([]); setLoading(false) } return }

      const { data: gameData } = await supabase
        .from('scrim_match_games')
        .select('id, match_id, game_no, mode, map, host_score, guest_score, duration_seconds, created_at')
        .in('match_id', matches.map(m => m.id))
      const gameRows = (gameData ?? []) as GameRow[]
      if (gameRows.length === 0) { if (!cancelled) { setGames([]); setStatRows([]); setLoading(false) } return }

      // 対戦相手の名前 (チーム or 混成ルーム)
      const oppTeamIds = new Set<string>()
      const oppRoomIds = new Set<string>()
      for (const m of matches) {
        const side = m.host_team_id === teamId ? 'host' : 'guest'
        const oppTeam = side === 'host' ? m.guest_team_id : m.host_team_id
        const oppRoom = side === 'host' ? m.guest_room_id : m.host_room_id
        if (oppTeam) oppTeamIds.add(oppTeam)
        else if (oppRoom) oppRoomIds.add(oppRoom)
      }
      const [{ data: oppTeams }, { data: oppRooms }, { data: statData }] = await Promise.all([
        oppTeamIds.size ? supabase.from('teams').select('id, name').in('id', [...oppTeamIds]) : Promise.resolve({ data: [] }),
        oppRoomIds.size ? supabase.from('scrim_mixed_rooms').select('id, name').in('id', [...oppRoomIds]) : Promise.resolve({ data: [] }),
        supabase
          .from('scrim_game_player_stats')
          .select('game_id, side, raw_name, user_id, kills, deaths, assists, damage, stats')
          .in('game_id', gameRows.map(g => g.id)),
      ])
      const oppName = new Map<string, string>()
      for (const t of (oppTeams ?? []) as { id: string; name: string }[]) oppName.set(`t:${t.id}`, t.name)
      for (const r of (oppRooms ?? []) as { id: string; name: string }[]) oppName.set(`r:${r.id}`, `${r.name} (混成)`)

      const matchById = new Map(matches.map(m => [m.id, m]))
      const gameList: Game[] = gameRows.map(g => {
        const m = matchById.get(g.match_id)!
        const side: 'host' | 'guest' = m.host_team_id === teamId ? 'host' : 'guest'
        const oppTeam = side === 'host' ? m.guest_team_id : m.host_team_id
        const oppRoom = side === 'host' ? m.guest_room_id : m.host_room_id
        const opponent = (oppTeam ? oppName.get(`t:${oppTeam}`) : oppRoom ? oppName.get(`r:${oppRoom}`) : null) ?? '不明'
        const ownScore = side === 'host' ? g.host_score : g.guest_score
        const oppScore = side === 'host' ? g.guest_score : g.host_score
        const result = ownScore === null || oppScore === null ? null
          : ownScore > oppScore ? 'w' : ownScore < oppScore ? 'l' : 'd'
        return {
          id: g.id, matchId: g.match_id, date: m.date, createdAt: g.created_at,
          mode: g.mode, map: g.map ?? '不明', side, opponent,
          ownScore, oppScore, result,
          diff: ownScore !== null && oppScore !== null ? ownScore - oppScore : null,
          duration: g.duration_seconds,
        }
      })
      gameList.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))

      // 紐付け済みプレイヤーの表示名
      const stats = (statData ?? []) as StatRow[]
      const uids = [...new Set(stats.map(s => s.user_id).filter((x): x is string => !!x))]
      let names: Record<string, string> = {}
      if (uids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', uids)
        names = Object.fromEntries(((profs ?? []) as { id: string; display_name: string | null }[]).map(p => [p.id, p.display_name ?? '(名前未設定)']))
      }

      if (!cancelled) {
        setGames(gameList)
        setStatRows(stats)
        setNameMap(names)
        setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [teamId])

  const opponents = useMemo(() => [...new Set(games.map(g => g.opponent))].sort(), [games])
  const maps = useMemo(() => [...new Set(games.map(g => g.map))].sort(), [games])

  // フィルター適用 (期間=直近N試合は他のフィルター適用後の新しい順)
  const filtered = useMemo(() => {
    let list = games.filter(g =>
      (fOpp === 'all' || g.opponent === fOpp) &&
      (fSide === 'all' || g.side === fSide) &&
      (fMode === 'all' || g.mode === fMode) &&
      (fMap === 'all' || g.map === fMap)
    )
    if (fRange !== 'all') list = list.slice(0, Number(fRange))
    return list
  }, [games, fOpp, fSide, fMode, fMap, fRange])

  const gameById = useMemo(() => new Map(filtered.map(g => [g.id, g])), [filtered])

  // 自チーム側のスタッツ行のみ
  const ownStats = useMemo(
    () => statRows.filter(s => { const g = gameById.get(s.game_id); return g && s.side === g.side }),
    [statRows, gameById]
  )
  const overview = useMemo(() => {
    const wins = filtered.filter(g => g.result === 'w').length
    const losses = filtered.filter(g => g.result === 'l').length
    const diffs = filtered.map(g => g.diff).filter((x): x is number => x !== null)
    const durs = filtered.map(g => g.duration).filter((x): x is number => x !== null)
    let k = 0, d = 0, a = 0
    for (const s of ownStats) { k += s.kills ?? 0; d += s.deaths ?? 0; a += s.assists ?? 0 }
    return {
      games: filtered.length, wins, losses,
      kdVal: kd(k, d), kadVal: kd(k + a, d),
      avgDiff: diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : null,
      avgDur: durs.length ? durs.reduce((x, y) => x + y, 0) / durs.length : null,
    }
  }, [filtered, ownStats])

  const players = useMemo(() => {
    const map = new Map<string, PlayerAgg>()
    for (const s of ownStats) {
      const g = gameById.get(s.game_id)!
      const key = s.user_id ?? `raw:${s.raw_name.toLowerCase().replace(/\s+/g, '')}`
      let p = map.get(key)
      if (!p) {
        p = {
          key, name: s.user_id ? (nameMap[s.user_id] ?? s.raw_name) : s.raw_name, linked: !!s.user_id,
          games: 0, wins: 0, losses: 0, k: 0, d: 0, a: 0, dmg: 0,
          objTimeSum: 0, objTimeN: 0, objKillsSum: 0, objKillsN: 0, onesidedSum: 0, onesidedN: 0,
          maxStreak: 0, plants: 0, defuses: 0, firstBloods: 0,
        }
        map.set(key, p)
      }
      p.games += 1
      if (g.result === 'w') p.wins += 1
      if (g.result === 'l') p.losses += 1
      p.k += s.kills ?? 0; p.d += s.deaths ?? 0; p.a += s.assists ?? 0; p.dmg += s.damage ?? 0
      const st = s.stats ?? {}
      const objTime = num(st['obj_time_sec'])
      if (objTime !== null) { p.objTimeSum += objTime; p.objTimeN += 1 }
      const objKills = num(st['obj_kills'])
      if (objKills !== null) { p.objKillsSum += objKills; p.objKillsN += 1 }
      const onesided = num(st['onesided_kills'])
      if (onesided !== null) { p.onesidedSum += onesided; p.onesidedN += 1 }
      const streak = num(st['max_streak'])
      if (streak !== null && streak > p.maxStreak) p.maxStreak = streak
      p.plants += num(st['plants']) ?? 0
      p.defuses += num(st['defuses']) ?? 0
      p.firstBloods += num(st['first_bloods']) ?? 0
    }
    return [...map.values()].sort((x, y) => y.games - x.games || (kd(y.k, y.d) ?? 0) - (kd(x.k, x.d) ?? 0))
  }, [ownStats, gameById, nameMap])

  // グループ別集計 (マップ / モード / 対戦相手で共用)
  const groupStats = useMemo(() => {
    const build = (keyOf: (g: Game) => string) => {
      const m = new Map<string, { games: Game[]; k: number; d: number }>()
      for (const g of filtered) {
        const key = keyOf(g)
        if (!m.has(key)) m.set(key, { games: [], k: 0, d: 0 })
        m.get(key)!.games.push(g)
      }
      for (const s of ownStats) {
        const g = gameById.get(s.game_id)!
        const e = m.get(keyOf(g))
        if (e) { e.k += s.kills ?? 0; e.d += s.deaths ?? 0 }
      }
      return [...m.entries()].map(([key, e]) => {
        const wins = e.games.filter(g => g.result === 'w').length
        const losses = e.games.filter(g => g.result === 'l').length
        const diffs = e.games.map(g => g.diff).filter((x): x is number => x !== null)
        return {
          key, n: e.games.length, wins, losses,
          avgDiff: diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : null,
          kdVal: kd(e.k, e.d),
          hostGames: e.games.filter(g => g.side === 'host'),
          guestGames: e.games.filter(g => g.side === 'guest'),
          lastDate: e.games.reduce((x, g) => (g.date > x ? g.date : x), ''),
        }
      }).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
    }
    return {
      byMap: build(g => g.map),
      byMode: build(g => g.mode),
      byOpp: build(g => g.opponent),
    }
  }, [filtered, ownStats, gameById])

  // マップ別プレイヤーK/D
  const mapPlayerKD = useMemo(() => {
    const cols = players.slice(0, 8)
    const acc = new Map<string, Map<string, { k: number; d: number }>>()
    for (const s of ownStats) {
      const g = gameById.get(s.game_id)!
      const pkey = s.user_id ?? `raw:${s.raw_name.toLowerCase().replace(/\s+/g, '')}`
      if (!acc.has(g.map)) acc.set(g.map, new Map())
      const row = acc.get(g.map)!
      if (!row.has(pkey)) row.set(pkey, { k: 0, d: 0 })
      const e = row.get(pkey)!
      e.k += s.kills ?? 0; e.d += s.deaths ?? 0
    }
    const rows = [...acc.entries()]
      .map(([mapName, row]) => ({ mapName, cells: cols.map(p => { const e = row.get(p.key); return e ? kd(e.k, e.d) : null }) }))
      .sort((a, b) => a.mapName.localeCompare(b.mapName))
    return { cols, rows }
  }, [players, ownStats, gameById])

  const winLoss = (wins: number, losses: number) => `${wins}-${losses}`

  if (loading) {
    return (
      <div className="section">
        <div className="card-strong">
          <div className="sec-title">交流戦スタッツ</div>
          <p className="muted" style={{ margin: 0 }}>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (games.length === 0) {
    return (
      <div className="section">
        <div className="card-strong">
          <div className="sec-title">交流戦スタッツ</div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            まだデータがありません。交流戦の試合ページからスコアボード画像を提出すると、ここに集計が表示されます。
          </p>
        </div>
      </div>
    )
  }

  const selStyle: React.CSSProperties = { fontSize: 12, padding: '4px 8px' }

  return (
    <div className="section">
      <div className="card-strong">
        <div className="rowx" style={{ marginBottom: 4 }}>
          <div className="sec-title" style={{ margin: 0 }}>交流戦スタッツ</div>
          <span className="muted" style={{ fontSize: 11 }}>記録 {games.length}ゲーム</span>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>
          提出されたスコアボードからの自動集計です。K/D・(K+A)/D は合計キル÷合計デス。
        </p>

        {/* フィルター */}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <select style={selStyle} value={fRange} onChange={e => setFRange(e.target.value)} aria-label="期間">
            <option value="all">全期間</option>
            <option value="5">直近5試合</option>
            <option value="10">直近10試合</option>
            <option value="20">直近20試合</option>
          </select>
          <select style={selStyle} value={fOpp} onChange={e => setFOpp(e.target.value)} aria-label="対戦相手">
            <option value="all">対戦相手: 全て</option>
            {opponents.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select style={selStyle} value={fSide} onChange={e => setFSide(e.target.value)} aria-label="サイド">
            <option value="all">サイド: 全て</option>
            <option value="host">ホスト</option>
            <option value="guest">ゲスト</option>
          </select>
          <select style={selStyle} value={fMode} onChange={e => setFMode(e.target.value)} aria-label="モード">
            <option value="all">モード: 全て</option>
            {Object.entries(MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select style={selStyle} value={fMap} onChange={e => setFMap(e.target.value)} aria-label="マップ">
            <option value="all">マップ: 全て</option>
            {maps.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>この条件に該当するゲームがありません。</p>
        ) : (
          <>
            {/* チーム概要 */}
            <div className="g4" style={{ marginBottom: 18 }}>
              <div className="stat"><span className="stat-label">試合数</span><span className="stat-val">{overview.games}</span></div>
              <div className="stat"><span className="stat-label">戦績</span><span className="stat-val">{overview.wins}勝 {overview.losses}敗</span></div>
              <div className="stat"><span className="stat-label">勝率</span><span className="stat-val">{fmtPct(overview.wins, overview.losses)}</span></div>
              <div className="stat"><span className="stat-label">チーム K/D</span><span className="stat-val">{fmt(overview.kdVal)}</span></div>
              <div className="stat"><span className="stat-label">(K+A)/D</span><span className="stat-val">{fmt(overview.kadVal)}</span></div>
              <div className="stat"><span className="stat-label">平均得失点差</span><span className="stat-val">{fmtSigned(overview.avgDiff)}</span></div>
              <div className="stat"><span className="stat-label">平均試合時間</span><span className="stat-val">{fmtDur(overview.avgDur)}</span></div>
            </div>

            {/* プレイヤー比較 */}
            <div className="stat-label" style={{ marginBottom: 6 }}>プレイヤー比較</div>
            <StatTable minWidth={860} head={<>
              <th style={thLeft}>プレイヤー</th><th style={thStyle}>試合</th><th style={thStyle}>平均K</th><th style={thStyle}>平均D</th><th style={thStyle}>平均A</th>
              <th style={thStyle}>K/D</th><th style={thStyle}>(K+A)/D</th><th style={thStyle}>平均威力</th><th style={thStyle}>平均占拠</th>
              <th style={thStyle}>目標K</th><th style={thStyle}>ワンサイドK</th><th style={thStyle}>最大ST</th><th style={thStyle}>設置</th><th style={thStyle}>解除</th><th style={thStyle}>勝率</th>
            </>}>
              {players.map(p => (
                <tr key={p.key} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ ...tdLeft, fontWeight: 600 }}>{p.name}{p.linked ? '' : <span className="dim" title="ASCENT未紐付け"> *</span>}</td>
                  <td style={tdStyle} className="mono">{p.games}</td>
                  <td style={tdStyle} className="mono">{fmt(p.k / p.games, 1)}</td>
                  <td style={tdStyle} className="mono">{fmt(p.d / p.games, 1)}</td>
                  <td style={tdStyle} className="mono">{fmt(p.a / p.games, 1)}</td>
                  <td style={tdStyle} className="mono">{fmt(kd(p.k, p.d))}</td>
                  <td style={tdStyle} className="mono">{fmt(kd(p.k + p.a, p.d))}</td>
                  <td style={tdStyle} className="mono">{fmt(p.dmg / p.games, 0)}</td>
                  <td style={tdStyle} className="mono">{p.objTimeN ? `${Math.round(p.objTimeSum / p.objTimeN)}秒` : '-'}</td>
                  <td style={tdStyle} className="mono">{p.objKillsN ? fmt(p.objKillsSum / p.objKillsN, 1) : '-'}</td>
                  <td style={tdStyle} className="mono">{p.onesidedN ? fmt(p.onesidedSum / p.onesidedN, 1) : '-'}</td>
                  <td style={tdStyle} className="mono">{p.maxStreak || '-'}</td>
                  <td style={tdStyle} className="mono">{p.plants || '-'}</td>
                  <td style={tdStyle} className="mono">{p.defuses || '-'}</td>
                  <td style={tdStyle} className="mono">{fmtPct(p.wins, p.losses)}</td>
                </tr>
              ))}
            </StatTable>
            <p className="dim" style={{ fontSize: 10.5, marginTop: 4 }}>
              * はASCENT未紐付けのプレイヤー。平均占拠・目標K等はその列があるモードのゲームのみで平均。設置/解除はSNDの合計。
            </p>

            {/* マップ別成績 */}
            <div className="stat-label" style={{ margin: '16px 0 6px' }}>マップ別成績</div>
            <StatTable minWidth={700} head={<>
              <th style={thLeft}>マップ</th><th style={thStyle}>試合</th><th style={thStyle}>戦績</th><th style={thStyle}>勝率</th><th style={thStyle}>平均得失点差</th>
              <th style={thStyle}>ホスト</th><th style={thStyle}>ホスト勝率</th><th style={thStyle}>ゲスト</th><th style={thStyle}>ゲスト勝率</th><th style={thStyle}>チームK/D</th>
            </>}>
              {groupStats.byMap.map(r => {
                const hw = r.hostGames.filter(g => g.result === 'w').length
                const hl = r.hostGames.filter(g => g.result === 'l').length
                const gw = r.guestGames.filter(g => g.result === 'w').length
                const gl = r.guestGames.filter(g => g.result === 'l').length
                return (
                  <tr key={r.key} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ ...tdLeft, fontWeight: 600 }}>{r.key}</td>
                    <td style={tdStyle} className="mono">{r.n}</td>
                    <td style={tdStyle} className="mono">{winLoss(r.wins, r.losses)}</td>
                    <td style={tdStyle} className="mono">{fmtPct(r.wins, r.losses)}</td>
                    <td style={tdStyle} className="mono">{fmtSigned(r.avgDiff)}</td>
                    <td style={tdStyle} className="mono">{r.hostGames.length}</td>
                    <td style={tdStyle} className="mono">{fmtPct(hw, hl)}</td>
                    <td style={tdStyle} className="mono">{r.guestGames.length}</td>
                    <td style={tdStyle} className="mono">{fmtPct(gw, gl)}</td>
                    <td style={tdStyle} className="mono">{fmt(r.kdVal)}</td>
                  </tr>
                )
              })}
            </StatTable>

            {/* マップ別プレイヤーK/D */}
            {mapPlayerKD.cols.length > 0 && (
              <>
                <div className="stat-label" style={{ margin: '16px 0 6px' }}>マップ別 K/D (プレイヤー)</div>
                <StatTable minWidth={420} head={<>
                  <th style={thLeft}>マップ</th>
                  {mapPlayerKD.cols.map(p => <th key={p.key} style={thStyle}>{p.name}</th>)}
                </>}>
                  {mapPlayerKD.rows.map(r => (
                    <tr key={r.mapName} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...tdLeft, fontWeight: 600 }}>{r.mapName}</td>
                      {r.cells.map((v, i) => (
                        <td key={i} style={{ ...tdStyle, color: v !== null && v >= 1 ? 'var(--success)' : undefined }} className="mono">{fmt(v)}</td>
                      ))}
                    </tr>
                  ))}
                </StatTable>
              </>
            )}

            {/* モード別成績 */}
            <div className="stat-label" style={{ margin: '16px 0 6px' }}>モード別成績</div>
            <StatTable minWidth={460} head={<>
              <th style={thLeft}>モード</th><th style={thStyle}>試合</th><th style={thStyle}>戦績</th><th style={thStyle}>勝率</th><th style={thStyle}>平均得失点差</th><th style={thStyle}>チームK/D</th>
            </>}>
              {groupStats.byMode.map(r => (
                <tr key={r.key} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ ...tdLeft, fontWeight: 600 }}>{MODE_LABEL[r.key] ?? r.key}</td>
                  <td style={tdStyle} className="mono">{r.n}</td>
                  <td style={tdStyle} className="mono">{winLoss(r.wins, r.losses)}</td>
                  <td style={tdStyle} className="mono">{fmtPct(r.wins, r.losses)}</td>
                  <td style={tdStyle} className="mono">{fmtSigned(r.avgDiff)}</td>
                  <td style={tdStyle} className="mono">{fmt(r.kdVal)}</td>
                </tr>
              ))}
            </StatTable>

            {/* 対戦相手別成績 */}
            <div className="stat-label" style={{ margin: '16px 0 6px' }}>対戦相手別成績</div>
            <StatTable minWidth={520} head={<>
              <th style={thLeft}>対戦相手</th><th style={thStyle}>試合</th><th style={thStyle}>戦績</th><th style={thStyle}>勝率</th><th style={thStyle}>平均得失点差</th><th style={thStyle}>最終対戦日</th>
            </>}>
              {groupStats.byOpp.map(r => (
                <tr key={r.key} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ ...tdLeft, fontWeight: 600 }}>{r.key}</td>
                  <td style={tdStyle} className="mono">{r.n}</td>
                  <td style={tdStyle} className="mono">{winLoss(r.wins, r.losses)}</td>
                  <td style={tdStyle} className="mono">{fmtPct(r.wins, r.losses)}</td>
                  <td style={tdStyle} className="mono">{fmtSigned(r.avgDiff)}</td>
                  <td style={tdStyle} className="mono">{r.lastDate || '-'}</td>
                </tr>
              ))}
            </StatTable>

            {/* 試合一覧 */}
            <div className="stat-label" style={{ margin: '16px 0 6px' }}>試合一覧 (新しい順・クリックで試合ページへ)</div>
            <StatTable minWidth={620} head={<>
              <th style={thLeft}>日付</th><th style={thLeft}>モード</th><th style={thLeft}>マップ</th><th style={thLeft}>サイド</th><th style={thLeft}>対戦相手</th>
              <th style={thStyle}>スコア</th><th style={thStyle}>結果</th><th style={thStyle}>得失点差</th>
            </>}>
              {filtered.slice(0, 30).map(g => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                  onClick={() => router.push(`/custom/board/${g.matchId}`)}>
                  <td style={tdLeft} className="mono">{g.date}</td>
                  <td style={tdLeft}>{MODE_SHORT[g.mode] ?? g.mode}</td>
                  <td style={tdLeft}>{g.map}</td>
                  <td style={tdLeft}>{g.side === 'host' ? 'ホスト' : 'ゲスト'}</td>
                  <td style={tdLeft}>{g.opponent}</td>
                  <td style={tdStyle} className="mono">{g.ownScore ?? '-'} - {g.oppScore ?? '-'}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: g.result === 'w' ? 'var(--success)' : g.result === 'l' ? 'var(--danger)' : undefined }}>
                    {g.result === 'w' ? 'WIN' : g.result === 'l' ? 'LOSE' : g.result === 'd' ? 'DRAW' : '-'}
                  </td>
                  <td style={tdStyle} className="mono">{g.diff !== null ? (g.diff > 0 ? `+${g.diff}` : g.diff) : '-'}</td>
                </tr>
              ))}
            </StatTable>
            {filtered.length > 30 && (
              <p className="dim" style={{ fontSize: 10.5, marginTop: 4 }}>最新30ゲームのみ表示しています (フィルターで絞り込めます)。</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
