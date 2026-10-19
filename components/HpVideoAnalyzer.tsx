'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  base64ToJpegBlob, captureFramesAt, captureJpeg, fetchYouTubeVideo, parseYouTubeId,
  sampleHudFrames, seekTo, type VideoFrame,
} from '@/lib/hpVideo'
import { deriveOriented, type RawFrameReading } from '@/lib/hpTimeline'
import { detectGames } from '@/lib/lkScan'

// ============================================================
// LK動画 (試合録画) の解析フロー
//
// LK動画には複数ゲームが連続で収録されているため、既定は全自動:
//   1. 動画全体を粗くスキャンしてAIがフレームを分類
//      (試合中 / リザルト画面 / その他)
//   2. ゲーム区間とスコアボード画面の位置を自動検出 (lib/lkScan.ts)
//   3. 各ゲームについて、リザルト画面を既存の scoreboard-parse で
//      解析してスタッツを保存し、HPなら区間内のHUDを精査して
//      ヒル保持の推移も保存する
// 検出がうまくいかない動画向けに、1ゲームずつ範囲を指定する
// 手動モードも折りたたみで残している。
// 動画そのものはアップロードしない (ブラウザ内でフレーム抽出のみ)。
// ============================================================

export type AnalyzerGame = {
  id: string
  game_no: number
  mode: string
  map: string | null
  host_score: number | null
  guest_score: number | null
  host_slot: 'team1' | 'team2' | null
}

type Props = {
  matchId: string
  games: AnalyzerGame[]
  hostName: string
  guestName: string
  onSaved: () => void
  onClose: () => void
}

type ParseResponse = {
  ok: boolean; mode: string | null; map: string | null; duration_seconds: number | null
  team_a_score: number | null; team_b_score: number | null; a_is_host: boolean | null
  players: { team: 'A' | 'B'; name: string; kills: number | null; deaths: number | null; assists: number | null; damage: number | null; stats: Record<string, unknown>; side: 'host' | 'guest' | null; matched_user_id: string | null }[]
}

type HudReading = { i: number; left: number | null; right: number | null; clock: number | null; hill: number | null; phase?: string }
type FrameReading = RawFrameReading & { phase?: 'game' | 'result' | 'other' }

const fmtT = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const FRAMES_PER_REQUEST = 8
const MAX_FRAMES = 360 // 1ゲームのHUD精査の上限
const SCAN_MIN_INTERVAL = 3 // 自動検出スキャンの間隔 (秒)
const SCAN_MAX_FRAMES = 2400 // 2時間 (上限) の動画でも3秒間隔を維持できる枚数
const SCAN_CHUNK = 160 // メモリ節約のため、抽出→分類をこの枚数ずつ交互に行う
const MAX_VIDEO_SEC = 2 * 3600 // これを超える動画はエラー

// YouTube URL入力の表示フラグ。YouTubeがデータセンターIP (Supabase) からの
// 取得をbot判定で拒否しているため現状はほぼ確実に失敗する。裏側 (yt-fetch) は
// 残してあるので、YouTube側の制限が緩和されたら true に戻すだけで復活する
const ENABLE_YOUTUBE_INPUT: boolean = false

export default function HpVideoAnalyzer({ matchId, games, hostName, guestName, onSaved, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<string[]>([])
  const [ytUrl, setYtUrl] = useState('')
  const [ytLoading, setYtLoading] = useState(false)
  const [ytProgress, setYtProgress] = useState('')

  // 手動モード (フォールバック)
  const [manualOpen, setManualOpen] = useState(false)
  const [target, setTarget] = useState<string>('new') // 'new' | 既存HPゲームのid
  const [startT, setStartT] = useState(0)
  const [endT, setEndT] = useState(0)

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const hpGames = games.filter(g => g.mode === 'hp')

  const handleFile = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (url) URL.revokeObjectURL(url)
    setError(null); setResults([])
    setFileName(f.name)
    setUrl(URL.createObjectURL(f))
  }

  // YouTube動画をEdge Function経由で一度ダウンロードし、ローカル動画と同じフローに乗せる
  const loadYouTube = async () => {
    if (ytLoading || running) return
    const videoId = parseYouTubeId(ytUrl)
    if (!videoId) { setError('YouTubeのURLを認識できませんでした (例: https://youtube.com/watch?v=...)'); return }
    setYtLoading(true); setError(null); setResults([])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('ログインが必要です')
      setYtProgress('動画を取得中...')
      const { blob, title } = await fetchYouTubeVideo(videoId, session.access_token, (loaded, total) => {
        const mb = (loaded / 1024 / 1024).toFixed(0)
        setYtProgress(total ? `動画を取得中... ${mb}MB / ${(total / 1024 / 1024).toFixed(0)}MB` : `動画を取得中... ${mb}MB`)
      })
      if (url) URL.revokeObjectURL(url)
      setFileName(title ?? `YouTube (${videoId})`)
      setUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'YouTube動画の取得に失敗しました')
    } finally {
      setYtLoading(false)
      setYtProgress('')
    }
  }

  const onMeta = () => {
    const v = videoRef.current
    if (!v) return
    if (v.duration > MAX_VIDEO_SEC) {
      if (url) URL.revokeObjectURL(url)
      setUrl(null)
      setFileName('')
      setError('動画が長すぎます (2時間まで)。分割してからお試しください')
      return
    }
    setDuration(v.duration)
    setStartT(0)
    setEndT(Math.max(0, v.duration - 0.5))
  }

  // ---- 共通: フレームのバッチ送信 (8枚ずつ・並列2) ----
  const invokeFrames = async (
    frames: VideoFrame[],
    kind: 'hud' | 'scan',
    onBatch?: (done: number, total: number) => void
  ): Promise<FrameReading[]> => {
    const batches: VideoFrame[][] = []
    for (let i = 0; i < frames.length; i += FRAMES_PER_REQUEST) batches.push(frames.slice(i, i + FRAMES_PER_REQUEST))
    const total = batches.length
    let done = 0
    const out: FrameReading[] = []
    const worker = async () => {
      for (;;) {
        const batch = batches.shift()
        if (!batch) return
        const { data, error: fnErr } = await supabase.functions.invoke('hp-video-parse', {
          body: { kind, frames: batch.map(f => ({ i: f.i, data: f.data })) },
        })
        if (fnErr) throw new Error('AIの読み取りに失敗しました。もう一度お試しください')
        for (const r of ((data as { readings?: HudReading[] })?.readings ?? [])) {
          const f = batch.find(x => x.i === r.i)
          if (!f) continue
          const phase = r.phase === 'game' || r.phase === 'result' ? r.phase : r.phase === 'other' ? 'other' : undefined
          out.push({ t: f.t, left: r.left, right: r.right, clock: r.clock, hill: r.hill, phase })
        }
        done += 1
        onBatch?.(done, total)
      }
    }
    await Promise.all([worker(), worker()])
    return out
  }

  // ---- 共通: 指定時刻の画面をスコアボードとして解析・保存 (既存経路) ----
  const submitScoreboardAt = async (vid: HTMLVideoElement, t: number, gameNo: number): Promise<AnalyzerGame> => {
    await seekTo(vid, t)
    const sb = captureJpeg(vid, { width: 1600, quality: 0.85 })
    const path = `${matchId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage.from('scoreboards').upload(path, base64ToJpegBlob(sb), { contentType: 'image/jpeg' })
    if (upErr) throw new Error('スコアボード画像のアップロードに失敗しました: ' + upErr.message)
    const { data, error: fnErr } = await supabase.functions.invoke('scoreboard-parse', { body: { image_path: path, match_id: matchId } })
    if (fnErr) throw new Error('スコアボードのAI解析に失敗しました')
    const r = data as ParseResponse
    const aIsHost = r.a_is_host !== false
    const hostScore = aIsHost ? r.team_a_score : r.team_b_score
    const guestScore = aIsHost ? r.team_b_score : r.team_a_score
    const mode = (r.mode === 'snd' || r.mode === 'ovl') ? r.mode : 'hp'
    const { data: saved, error: saveErr } = await supabase.rpc('rpc_scrim_submit_game', {
      p_match_id: matchId,
      p_game_no: gameNo,
      p_mode: mode,
      p_map: r.map,
      p_host_score: hostScore,
      p_guest_score: guestScore,
      p_duration_seconds: r.duration_seconds,
      p_image_path: path,
      p_host_slot: aIsHost ? 'team1' : 'team2',
      p_players: (r.players ?? []).map(p => ({
        side: p.side ?? (((p.team === 'A') === aIsHost) ? 'host' : 'guest'),
        raw_name: p.name,
        user_id: p.matched_user_id,
        kills: p.kills, deaths: p.deaths, assists: p.assists, damage: p.damage,
        stats: p.stats ?? {},
      })),
    })
    if (saveErr) throw new Error('スタッツの保存に失敗しました: ' + saveErr.message)
    const gameId = (saved as { game_id?: string } | null)?.game_id
    if (!gameId) throw new Error('保存結果を取得できませんでした')
    return { id: gameId, game_no: gameNo, mode, map: r.map, host_score: hostScore, guest_score: guestScore, host_slot: aIsHost ? 'team1' : 'team2' }
  }

  // ---- 共通: 区間のHUDを精査してヒル保持の推移を保存 ----
  const runTimelineFor = async (
    vid: HTMLVideoElement,
    game: AnalyzerGame,
    segStart: number,
    segEnd: number,
    onStage: (text: string) => void
  ): Promise<number> => {
    const interval = Math.max(2.5, (Math.max(0, segEnd - segStart)) / MAX_FRAMES)
    onStage('フレームを抽出中... 0%')
    const frames = await sampleHudFrames(vid, {
      startT: segStart, endT: segEnd, interval,
      onProgress: (d, tot) => onStage(`フレームを抽出中... ${Math.round((d / tot) * 100)}%`),
    })
    if (frames.length < 10) throw new Error('フレームを十分に抽出できませんでした')
    const readings = await invokeFrames(frames, 'hud', (d, tot) => onStage(`AIがHUDを読み取り中... ${d}/${tot}`))
    onStage('ヒル保持の推移を計算中...')
    const derived = deriveOriented(readings, game)
    if (derived.rotations.length === 0) {
      throw new Error('スコアの推移を読み取れませんでした')
    }
    const { error: tlErr } = await supabase.rpc('rpc_scrim_submit_hp_timeline', {
      p_game_id: game.id,
      p_sample_interval: interval,
      p_rotation_method: derived.method,
      p_samples: derived.samples,
      p_rotations: derived.rotations,
    })
    if (tlErr) throw new Error('推移の保存に失敗しました: ' + tlErr.message)
    return derived.rotations.length
  }

  // ---- 自動モード: 動画内の全ゲームを検出して順に保存 ----
  const runAuto = async () => {
    const vid = videoRef.current
    if (!vid || running) return
    setRunning(true); setError(null); setResults([])
    vid.pause()
    try {
      const dur = vid.duration
      if (dur > MAX_VIDEO_SEC) throw new Error('動画が長すぎます (2時間まで)。分割してからお試しください')
      const scanInterval = Math.max(SCAN_MIN_INTERVAL, dur / SCAN_MAX_FRAMES)
      const scanEnd = Math.max(0, dur - 0.5)
      const allTimes: number[] = []
      for (let t = 0; t <= scanEnd; t += scanInterval) allTimes.push(Math.round(t * 10) / 10)
      // 長時間動画でもメモリを使いすぎないよう、抽出とAI分類をチャンクごとに交互に行う
      const chunks: number[][] = []
      for (let off = 0; off < allTimes.length; off += SCAN_CHUNK) chunks.push(allTimes.slice(off, off + SCAN_CHUNK))
      const totalBatches = chunks.reduce((s, c) => s + Math.ceil(c.length / FRAMES_PER_REQUEST), 0)
      const scans: FrameReading[] = []
      let extractedDone = 0
      let classifiedDone = 0
      setStage('動画全体をスキャン中... 0%')
      for (const chunkTimes of chunks) {
        const frames = await captureFramesAt(vid, chunkTimes, { cropTopRatio: 1, width: 640, quality: 0.6 },
          d => setStage(`動画全体をスキャン中 (フレーム抽出)... ${Math.round(((extractedDone + d) / allTimes.length) * 100)}%`))
        extractedDone += chunkTimes.length
        if (frames.length === 0) continue
        const readings = await invokeFrames(frames, 'scan',
          d => setStage(`AIがフレームを分類中... ${classifiedDone + d}/${totalBatches}`))
        classifiedDone += Math.ceil(frames.length / FRAMES_PER_REQUEST)
        scans.push(...readings)
      }
      if (scans.length < 10) throw new Error('フレームを抽出できませんでした')
      const detected = detectGames(
        scans.map(s => ({ t: s.t, phase: s.phase ?? 'other', left: s.left, right: s.right, clock: s.clock })),
        scanInterval
      )
      if (detected.length === 0) {
        throw new Error('試合を検出できませんでした。下の「手動で範囲を指定」をお試しください')
      }

      const msgs: string[] = [
        `${detected.length}ゲームを検出: ` + detected.map((g, i) => `#${i + 1} ${fmtT(g.startT)}〜${fmtT(g.endT)}`).join(' / '),
      ]
      setResults([...msgs])

      let gameNo = Math.max(0, ...games.map(g => g.game_no)) + 1
      for (let idx = 0; idx < detected.length; idx++) {
        const seg = detected[idx]
        const label = `ゲーム${idx + 1}/${detected.length}`
        if (gameNo > 12) { msgs.push('1試合12ゲームの上限に達したため残りをスキップしました'); break }
        try {
          setStage(`${label}: スコアボードを解析中...`)
          // リザルト画面が見つからなかったゲームは試合終了直後の画面で代用を試みる
          const sbT = seg.scoreboardT ?? Math.min(seg.endT + 8, dur - 0.5)
          const info = await submitScoreboardAt(vid, sbT, gameNo)
          gameNo += 1
          onSaved()
          if (info.mode === 'hp') {
            try {
              const n = await runTimelineFor(vid, info, seg.startT, seg.endT, p => setStage(`${label}: ${p}`))
              msgs.push(`✓ GAME ${info.game_no}${info.map ? ` (${info.map})` : ''}: スタッツ + ヒル推移 (${n}ポイント) を保存`)
              onSaved()
            } catch (e2) {
              msgs.push(`△ GAME ${info.game_no}: スタッツは保存、ヒル推移は失敗 — ${e2 instanceof Error ? e2.message : 'エラー'}`)
            }
          } else {
            msgs.push(`✓ GAME ${info.game_no}${info.map ? ` (${info.map})` : ''}: スタッツを保存 (ハードポイント以外のため推移なし)`)
          }
        } catch (e) {
          msgs.push(`✗ ${label} (${fmtT(seg.startT)}〜): スコアボード解析に失敗 — ${e instanceof Error ? e.message : 'エラー'}`)
        }
        setResults([...msgs])
      }
      msgs.push('完了しました。間違いがあれば各ゲームの「取り消す」で削除して再提出できます')
      setResults([...msgs])
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析中にエラーが発生しました')
    } finally {
      setRunning(false)
      setStage('')
    }
  }

  // ---- 手動モード: 1ゲームぶんの範囲を指定して保存 ----
  const runManual = async () => {
    const vid = videoRef.current
    if (!vid || running) return
    if (endT - startT < 60) { setError('解析範囲が短すぎます (開始位置と終了位置を確認してください)'); return }
    setRunning(true); setError(null); setResults([])
    vid.pause()
    try {
      let game: AnalyzerGame
      if (target === 'new') {
        const gameNo = Math.max(0, ...games.map(g => g.game_no)) + 1
        if (gameNo > 12) throw new Error('1試合に保存できるのは12ゲームまでです')
        setStage('スコアボード画面を解析中...')
        game = await submitScoreboardAt(vid, endT, gameNo)
        onSaved()
        if (game.mode !== 'hp') {
          setResults([`✓ GAME ${game.game_no} のスタッツを保存しました (ハードポイント以外のためヒル推移の解析はスキップ)`])
          return
        }
      } else {
        const g = hpGames.find(x => x.id === target)
        if (!g) throw new Error('対象のゲームが見つかりません')
        game = g
      }
      const segEnd = target === 'new' ? Math.max(startT, endT - 3) : endT
      const n = await runTimelineFor(vid, game, startT, segEnd, p => setStage(p))
      setResults([`✓ GAME ${game.game_no} のヒル保持推移を保存しました (${n}ポイント)`])
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析中にエラーが発生しました')
    } finally {
      setRunning(false)
      setStage('')
    }
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12, borderColor: 'rgba(0,229,255,0.25)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>🎬 LK動画から解析 <span className="badge" style={{ fontSize: 9, marginLeft: 4 }}>β</span></div>
        <button className="btn-ghost btn-sm" onClick={onClose} disabled={running}>閉じる</button>
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 10 }}>
        LK動画 (観戦/配信視点の録画) の動画ファイルを選択してください。複数ゲームが入ったままで大丈夫です。
        YouTubeにある動画は一度ダウンロードしてから読み込んでください。
        動画はサーバーに保存されず、ブラウザ内でフレームだけを切り出してAIが読み取ります。
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn-ghost btn-sm" style={{ cursor: running ? 'wait' : 'pointer', display: 'inline-block' }}>
          📁 動画ファイルを選択
          <input type="file" accept="video/*" style={{ display: 'none' }} disabled={running || ytLoading}
            onChange={e => { handleFile(e.target.files); e.target.value = '' }} />
        </label>
        {ENABLE_YOUTUBE_INPUT && (
          <>
            <span className="dim" style={{ fontSize: 11 }}>または</span>
            <input
              value={ytUrl}
              onChange={e => setYtUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              disabled={running || ytLoading}
              style={{ width: 260, fontSize: 12 }}
            />
            <button type="button" className="btn-ghost btn-sm" disabled={running || ytLoading || !ytUrl.trim()}
              onClick={() => void loadYouTube()}>
              {ytLoading ? (ytProgress || '取得中...') : '▶ YouTubeから読み込む'}
            </button>
          </>
        )}
      </div>
      {fileName && <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>読み込み済み: {fileName}</p>}

      {url && (
        <div style={{ marginTop: 10 }}>
          <video ref={videoRef} src={url} controls muted playsInline preload="metadata"
            onLoadedMetadata={onMeta}
            style={{ width: '100%', maxHeight: 360, borderRadius: 8, border: '1px solid var(--line)', background: '#000' }} />

          <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary btn-sm" onClick={() => void runAuto()} disabled={running}>
              {running ? '解析中...' : '🤖 全ゲームを自動で解析して保存'}
            </button>
            {duration > 0 && <span className="dim" style={{ fontSize: 11 }}>動画 {fmtT(duration)}</span>}
          </div>
          <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
            動画内の全ゲームとスコアボード画面を自動検出し、順にスタッツとヒル保持推移を保存します。長い動画では10分以上かかることがあります。
          </p>
          {running && stage && <p style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--amber)' }}>{stage}</p>}

          {/* 手動モード (自動検出がうまくいかない動画向け) */}
          <button type="button" className="btn-ghost btn-sm" style={{ fontSize: 11, marginTop: 12 }} disabled={running}
            onClick={() => setManualOpen(v => !v)}>
            {manualOpen ? '▲ 手動指定を閉じる' : '▼ 手動で範囲を指定する (1ゲームずつ)'}
          </button>
          {manualOpen && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={target} onChange={e => setTarget(e.target.value)} disabled={running} style={{ fontSize: 12 }}>
                  <option value="new">新規ゲームとして提出 (スタッツ + ヒル推移)</option>
                  {hpGames.map(g => (
                    <option key={g.id} value={g.id}>GAME {g.game_no}{g.map ? ` (${g.map})` : ''} にヒル推移だけ追加</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
                <button className="btn-ghost btn-sm" disabled={running}
                  onClick={() => { const v = videoRef.current; if (v) setStartT(Math.min(v.currentTime, endT)) }}>
                  現在位置を試合開始に設定
                </button>
                <span className="mono">開始 {fmtT(startT)}</span>
                <button className="btn-ghost btn-sm" disabled={running}
                  onClick={() => { const v = videoRef.current; if (v) setEndT(Math.max(v.currentTime, startT)) }}>
                  {target === 'new' ? '現在位置をスコアボード画面に設定' : '現在位置を試合終了に設定'}
                </button>
                <span className="mono">終了 {fmtT(endT)}</span>
              </div>
              {target === 'new' && (
                <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
                  「終了」はリザルト (スコアボード) が表示されている画面に合わせてください。その画面からスタッツを読み取ります。
                </p>
              )}
              <button className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => void runManual()} disabled={running}>
                この範囲を解析して保存
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '10px 0 0' }}>{error}</p>}
      {results.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          {results.map((m, i) => (
            <p key={i} style={{ margin: '3px 0', color: m.startsWith('✗') ? 'var(--danger)' : m.startsWith('✓') ? 'var(--success)' : undefined }}>{m}</p>
          ))}
        </div>
      )}
      <p className="dim" style={{ fontSize: 10.5, margin: '10px 0 0' }}>
        {hostName} / {guestName} の割り当ては保存済みスコアとの照合で自動判定されます。逆になっていた場合は推移表示の「左右入れ替え」で修正できます。
      </p>
    </div>
  )
}
