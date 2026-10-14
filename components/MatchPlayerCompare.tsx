'use client'

// ============================================================
// 試合ページ用プレイヤー比較
// 1つの交流戦内の保存済みゲームを累計し、両チーム全プレイヤーを
// ヒートマップ付きで比較する (チームページのダッシュボードと同じ配色)。
// ============================================================

import { useMemo } from 'react'
import {
  num, fmt, fmtPct, kd, heatBg, relT, winRateOf,
  StatTable, thStyle, thLeft, tdStyle, tdLeft,
} from '@/components/scrimStatsUtils'

type GameLite = { id: string; host_score: number | null; guest_score: number | null }
type StatLite = {
  game_id: string
  side: 'host' | 'guest'
  raw_name: string
  user_id: string | null
  kills: number | null
  deaths: number | null
  assists: number | null
  damage: number | null
  stats?: Record<string, unknown> | null
}

type Agg = {
  key: string
  name: string
  side: 'host' | 'guest'
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
}

export default function MatchPlayerCompare({ games, stats, hostName, guestName }: {
  games: GameLite[]
  stats: StatLite[]
  hostName: string
  guestName: string
}) {
  const players = useMemo(() => {
    const gameById = new Map(games.map(g => [g.id, g]))
    const map = new Map<string, Agg>()
    for (const s of stats) {
      const g = gameById.get(s.game_id)
      if (!g) continue
      const key = s.user_id ?? `raw:${s.side}:${s.raw_name.toLowerCase().replace(/\s+/g, '')}`
      let p = map.get(key)
      if (!p) {
        p = {
          key, name: s.raw_name, side: s.side,
          games: 0, wins: 0, losses: 0, k: 0, d: 0, a: 0, dmg: 0,
          objTimeSum: 0, objTimeN: 0, objKillsSum: 0, objKillsN: 0,
          onesidedSum: 0, onesidedN: 0, maxStreak: 0, plants: 0, defuses: 0,
        }
        map.set(key, p)
      }
      p.games += 1
      if (g.host_score !== null && g.guest_score !== null && g.host_score !== g.guest_score) {
        const hostWon = g.host_score > g.guest_score
        if ((s.side === 'host') === hostWon) p.wins += 1
        else p.losses += 1
      }
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
    }
    return [...map.values()].sort((x, y) => (kd(y.k, y.d) ?? 0) - (kd(x.k, x.d) ?? 0))
  }, [games, stats])

  // 列ごとの値一覧 (全プレイヤー横断の相対ヒートマップ用)
  const vals = useMemo(() => {
    const defined = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x))
    const of = (f: (p: Agg) => number | null) => defined(players.map(f))
    return {
      avgK: of(p => p.k / p.games),
      avgD: of(p => p.d / p.games),
      avgA: of(p => p.a / p.games),
      kdv: of(p => kd(p.k, p.d)),
      kadv: of(p => kd(p.k + p.a, p.d)),
      avgDmg: of(p => p.dmg / p.games),
      objTime: of(p => (p.objTimeN ? p.objTimeSum / p.objTimeN : null)),
      objKills: of(p => (p.objKillsN ? p.objKillsSum / p.objKillsN : null)),
      onesided: of(p => (p.onesidedN ? p.onesidedSum / p.onesidedN : null)),
      maxStreak: of(p => (p.maxStreak > 0 ? p.maxStreak : null)),
      winRate: of(p => winRateOf(p.wins, p.losses)),
    }
  }, [players])

  if (players.length === 0) return null

  return (
    <div style={{ marginTop: 14 }}>
      <div className="stat-label" style={{ marginBottom: 6 }}>プレイヤー比較 (この交流戦の累計)</div>
      <StatTable minWidth={920} head={<>
        <th style={thLeft}>プレイヤー</th><th style={thLeft}>チーム</th><th style={thStyle}>G</th>
        <th style={thStyle}>平均K</th><th style={thStyle}>平均D</th><th style={thStyle}>平均A</th>
        <th style={thStyle}>K/D</th><th style={thStyle}>(K+A)/D</th><th style={thStyle}>平均威力</th><th style={thStyle}>平均占拠</th>
        <th style={thStyle}>目標K</th><th style={thStyle}>ワンサイドK</th><th style={thStyle}>最大ST</th><th style={thStyle}>設置</th><th style={thStyle}>解除</th><th style={thStyle}>勝率</th>
      </>}>
        {players.map(p => {
          const objTime = p.objTimeN ? p.objTimeSum / p.objTimeN : null
          const objKills = p.objKillsN ? p.objKillsSum / p.objKillsN : null
          const onesided = p.onesidedN ? p.onesidedSum / p.onesidedN : null
          return (
            <tr key={p.key} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ ...tdLeft, fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
              <td style={{ ...tdLeft, fontSize: 11 }} className="muted">{p.side === 'host' ? hostName : guestName}</td>
              <td style={tdStyle} className="mono">{p.games}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.avgK, p.k / p.games)) }} className="mono">{fmt(p.k / p.games, 1)}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.avgD, p.d / p.games, true)) }} className="mono">{fmt(p.d / p.games, 1)}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.avgA, p.a / p.games)) }} className="mono">{fmt(p.a / p.games, 1)}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.kdv, kd(p.k, p.d))), fontWeight: 700 }} className="mono">{fmt(kd(p.k, p.d))}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.kadv, kd(p.k + p.a, p.d))) }} className="mono">{fmt(kd(p.k + p.a, p.d))}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.avgDmg, p.dmg / p.games)) }} className="mono">{fmt(p.dmg / p.games, 0)}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.objTime, objTime)) }} className="mono">{objTime !== null ? `${Math.round(objTime)}秒` : '-'}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.objKills, objKills)) }} className="mono">{objKills !== null ? fmt(objKills, 1) : '-'}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.onesided, onesided)) }} className="mono">{onesided !== null ? fmt(onesided, 1) : '-'}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.maxStreak, p.maxStreak > 0 ? p.maxStreak : null)) }} className="mono">{p.maxStreak || '-'}</td>
              <td style={tdStyle} className="mono">{p.plants || '-'}</td>
              <td style={tdStyle} className="mono">{p.defuses || '-'}</td>
              <td style={{ ...tdStyle, ...heatBg(relT(vals.winRate, winRateOf(p.wins, p.losses))) }} className="mono">{fmtPct(p.wins, p.losses)}</td>
            </tr>
          )
        })}
      </StatTable>
      <p className="dim" style={{ fontSize: 10.5, marginTop: 4, marginBottom: 0 }}>
        セルの色は全プレイヤー横断の相対評価 (<span style={{ color: 'var(--success)' }}>緑=優秀</span> / <span style={{ color: 'var(--danger)' }}>赤=改善余地</span>)。
        K/D・(K+A)/D は累計キル÷累計デス。平均占拠・目標K等はその列があるモードのゲームのみで平均。設置/解除はSNDの合計。
      </p>
    </div>
  )
}
