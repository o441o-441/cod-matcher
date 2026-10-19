// ============================================================
// LK動画の自動ゲーム区間検出 (純関数)
//
// 動画全体を粗い間隔でスキャンしてAIが分類したフレーム
// (試合中 / リザルト画面 / その他) から、収録されている
// 複数ゲームの区間とスコアボード画面の位置を推定する。
//
// 区切りの判定材料:
//   - phase の連続性 (試合間はリザルト+ロビーで数十秒〜数分空く)
//   - スコアのリセット (大きい値 → ほぼ0 に戻ったら別ゲーム)
//   - 試合時間の巻き戻り (残り時間が大きく増えたら別ゲーム)
// ============================================================

export type ScanReading = {
  t: number // 動画内の秒
  phase: 'game' | 'result' | 'other'
  left: number | null
  right: number | null
  clock: number | null
}

export type DetectedGame = {
  startT: number
  endT: number
  scoreboardT: number | null // リザルト画面が見つからなければ null
}

// 試合中フレームの連続区間
type Run = { start: number; end: number; frames: ScanReading[] }

const MIN_GAME_SEC = 90 // これより短い区間はノイズとして捨てる
const MERGE_GAP_SEC = 25 // この間隔以下の途切れは同一ゲームとして結合候補

const lastScore = (r: Run): number => {
  for (let i = r.frames.length - 1; i >= 0; i--) {
    const f = r.frames[i]
    const v = Math.max(f.left ?? -1, f.right ?? -1)
    if (v >= 0) return v
  }
  return -1
}

const firstScore = (r: Run): number => {
  for (const f of r.frames) {
    const v = Math.max(f.left ?? -1, f.right ?? -1)
    if (v >= 0) return v
  }
  return -1
}

const lastClock = (r: Run): number | null => {
  for (let i = r.frames.length - 1; i >= 0; i--) {
    if (r.frames[i].clock !== null) return r.frames[i].clock
  }
  return null
}

const firstClock = (r: Run): number | null => {
  for (const f of r.frames) {
    if (f.clock !== null) return f.clock
  }
  return null
}

export function detectGames(scans: ScanReading[], sampleInterval: number): DetectedGame[] {
  const sorted = [...scans].sort((a, b) => a.t - b.t)

  // 1) phase='game' の連続区間を作る
  const runs: Run[] = []
  for (const s of sorted) {
    if (s.phase !== 'game') continue
    const cur = runs[runs.length - 1]
    if (cur && s.t - cur.end <= sampleInterval * 1.6) {
      cur.end = s.t
      cur.frames.push(s)
    } else {
      runs.push({ start: s.t, end: s.t, frames: [s] })
    }
  }

  // 2) 短い途切れは結合する。ただしスコアリセット/時計巻き戻りがあれば別ゲーム
  const merged: Run[] = []
  for (const r of runs) {
    const prev = merged[merged.length - 1]
    if (prev && r.start - prev.end <= MERGE_GAP_SEC) {
      const scoreReset = lastScore(prev) > 40 && firstScore(r) >= 0 && firstScore(r) < 15
      const pc = lastClock(prev)
      const nc = firstClock(r)
      const clockRewind = pc !== null && nc !== null && nc - pc > 90 // カウントダウンが大きく増えた
      if (!scoreReset && !clockRewind) {
        prev.end = r.end
        prev.frames.push(...r.frames)
        continue
      }
    }
    merged.push({ start: r.start, end: r.end, frames: [...r.frames] })
  }

  // 3) 短すぎる区間を除去
  const games = merged.filter(r => r.end - r.start >= MIN_GAME_SEC)

  // 4) 各ゲームの後ろにあるリザルト画面を探す (次のゲーム開始より手前)
  const out: DetectedGame[] = []
  for (let i = 0; i < games.length; i++) {
    const g = games[i]
    const windowEnd = i + 1 < games.length ? games[i + 1].start : Infinity
    const resultFrames = sorted.filter(s => s.phase === 'result' && s.t > g.end && s.t < windowEnd)
    // 連続するリザルト列の中央を採用 (表示アニメーション完了後の安定した画面を狙う)
    let scoreboardT: number | null = null
    if (resultFrames.length > 0) {
      const streak: number[] = [resultFrames[0].t]
      for (let k = 1; k < resultFrames.length; k++) {
        if (resultFrames[k].t - resultFrames[k - 1].t <= sampleInterval * 1.6) {
          streak.push(resultFrames[k].t)
        } else break // 最初のリザルト列だけを使う (再表示や次戦のものは無視)
      }
      scoreboardT = streak[Math.floor(streak.length / 2)]
    }
    out.push({
      startT: Math.max(0, Math.round((g.start - sampleInterval / 2) * 10) / 10),
      endT: Math.round((g.end + sampleInterval / 2) * 10) / 10,
      scoreboardT,
    })
  }
  return out
}
