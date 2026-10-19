'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  base64ToJpegBlob, captureJpeg, fetchYouTubeVideo, parseYouTubeId,
  sampleHudFrames, seekTo, type VideoFrame,
} from '@/lib/hpVideo'
import { deriveOriented, type RawFrameReading } from '@/lib/hpTimeline'
import { loadCalib, readHudScores, saveCalib, warmupOcr, type HudCalib } from '@/lib/hpOcr'

// ============================================================
// LK動画 (試合録画) の解析フロー
//
// 1ゲームずつ、動画をシークして
//   - 試合開始位置 (= 1ポイント目の開始。以降60秒ごとに次のポイント)
//   - スコアボード (リザルト) 画面の位置
// を指定して解析する。
//   A) 新規提出: スコアボード画面を既存の scoreboard-parse で解析して
//      スタッツを保存し、HPなら区間内のHUDを精査してヒル推移も保存
//   B) 既存ゲームに追加: 提出済みのHPゲームにヒル推移だけを後付け
// 動画そのものはアップロードしない (ブラウザ内でフレーム抽出のみ)。
//
// ※ 全ゲーム自動検出 (フレーム分類スキャン) は精度が出なかったため
//   廃止した。検出ロジックは lib/lkScan.ts に残している。
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

type HudReading = { i: number; left: number | null; right: number | null; clock: number | null; hill: number | null }

const fmtT = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const FRAMES_PER_REQUEST = 8
const MAX_FRAMES = 360 // 1ゲームのHUD精査の上限
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

  const [target, setTarget] = useState<string>('new') // 'new' | 既存HPゲームのid
  const [startT, setStartT] = useState(0)
  const [endT, setEndT] = useState(0)

  // ヒル推移の読み取り方式。既定はブラウザOCR (無料・通信なし)
  const [readMode, setReadMode] = useState<'ocr' | 'ai'>('ocr')
  const [calib, setCalib] = useState<HudCalib>(() => loadCalib())
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => { saveCalib(calib) }, [calib])
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

  // 現在表示中のフレームでOCRの読み取りテスト (枠位置の調整用)
  const testRead = async () => {
    const vid = videoRef.current
    if (!vid || testing || running) return
    setTesting(true); setTestResult(null)
    try {
      await warmupOcr()
      const { left, right } = await readHudScores(vid, calib)
      setTestResult(`読み取り結果 — 左: ${left ?? '×'} / 右: ${right ?? '×'}`)
    } catch (e) {
      setTestResult('読み取りに失敗しました: ' + (e instanceof Error ? e.message : 'エラー'))
    } finally {
      setTesting(false)
    }
  }

  // ---- フレームのバッチ送信 (8枚ずつ・並列2) ----
  const invokeFrames = async (
    frames: VideoFrame[],
    onBatch?: (done: number, total: number) => void
  ): Promise<RawFrameReading[]> => {
    const batches: VideoFrame[][] = []
    for (let i = 0; i < frames.length; i += FRAMES_PER_REQUEST) batches.push(frames.slice(i, i + FRAMES_PER_REQUEST))
    const total = batches.length
    let done = 0
    const out: RawFrameReading[] = []
    const worker = async () => {
      for (;;) {
        const batch = batches.shift()
        if (!batch) return
        const { data, error: fnErr } = await supabase.functions.invoke('hp-video-parse', {
          body: { frames: batch.map(f => ({ i: f.i, data: f.data })) },
        })
        if (fnErr) throw new Error('AIの読み取りに失敗しました。もう一度お試しください')
        for (const r of ((data as { readings?: HudReading[] })?.readings ?? [])) {
          const f = batch.find(x => x.i === r.i)
          if (f) out.push({ t: f.t, left: r.left, right: r.right, clock: r.clock, hill: r.hill })
        }
        done += 1
        onBatch?.(done, total)
      }
    }
    await Promise.all([worker(), worker()])
    return out
  }

  // ---- 指定時刻の画面をスコアボードとして解析・保存 (既存経路) ----
  const submitScoreboardAt = async (vid: HTMLVideoElement, t: number, gameNo: number): Promise<AnalyzerGame> => {
    await seekTo(vid, t)
    const sb = captureJpeg(vid, { width: 1600, quality: 0.85 })
    const path = `${matchId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage.from('scoreboards').upload(path, base64ToJpegBlob(sb), { contentType: 'image/jpeg' })
    if (upErr) throw new Error('スコアボード画像のアップロードに失敗しました: ' + upErr.message)
    const { data, error: fnErr } = await supabase.functions.invoke('scoreboard-parse', { body: { image_path: path, match_id: matchId } })
    if (fnErr) throw new Error('スコアボードのAI解析に失敗しました。「終了」をリザルト画面に合わせてください')
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

  // ---- 区間のHUDを精査してヒル保持の推移を保存 ----
  // anchorT (試合開始位置) を1ポイント目の開始とし、60秒ごとに区切る
  const runTimelineFor = async (
    vid: HTMLVideoElement,
    game: AnalyzerGame,
    anchorT: number,
    segEnd: number,
    onStage: (text: string) => void
  ): Promise<number> => {
    let readings: RawFrameReading[]
    let interval: number
    if (readMode === 'ocr') {
      // ブラウザOCR (無料): 左右スコアの枠だけ切り出してローカルで読む
      onStage('OCRエンジンを準備中...')
      await warmupOcr()
      interval = Math.max(2, (Math.max(0, segEnd - anchorT)) / 600)
      const times: number[] = []
      for (let t = anchorT; t <= segEnd; t += interval) times.push(Math.round(t * 10) / 10)
      readings = []
      for (let i = 0; i < times.length; i++) {
        try {
          await seekTo(vid, times[i])
          const { left, right } = await readHudScores(vid, calib)
          readings.push({ t: times[i], left, right, clock: null, hill: null })
        } catch { /* シーク失敗したフレームは飛ばす */ }
        onStage(`OCRでスコアを読み取り中... ${i + 1}/${times.length}`)
      }
      const okCount = readings.filter(r => r.left !== null || r.right !== null).length
      if (readings.length === 0 || okCount / readings.length < 0.3) {
        throw new Error('OCRでスコアをほとんど読み取れませんでした。「テスト読み取り」で枠の位置を調整するか、AI方式に切り替えてください')
      }
    } else {
      // AI (クレジット消費): 画面上部クロップをEdge Function経由で読む
      interval = Math.max(2.5, (Math.max(0, segEnd - anchorT)) / MAX_FRAMES)
      onStage('フレームを抽出中... 0%')
      const frames = await sampleHudFrames(vid, {
        startT: anchorT, endT: segEnd, interval,
        onProgress: (d, tot) => onStage(`フレームを抽出中... ${Math.round((d / tot) * 100)}%`),
      })
      if (frames.length < 10) throw new Error('フレームを十分に抽出できませんでした')
      readings = await invokeFrames(frames, (d, tot) => onStage(`AIがHUDを読み取り中... ${d}/${tot}`))
    }
    onStage('ヒル保持の推移を計算中...')
    const derived = deriveOriented(readings, game, { anchorT })
    if (derived.rotations.length === 0) {
      throw new Error('スコアの推移を読み取れませんでした。「開始」が試合開始の画面に合っているか確認してください')
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

  // ---- 1ゲームぶんの範囲を指定して保存 ----
  const run = async () => {
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
        LK動画 (観戦/配信視点の録画・2時間まで) を読み込み、1ゲームずつ「試合開始」と「スコアボード画面」の位置を指定して解析します。
        YouTubeにある動画は一度ダウンロードしてから読み込んでください。
        動画はサーバーに保存されません。ヒル推移はブラウザ内のOCRで無料で読み取り、AIを使うのはスコアボード画像1枚の解析だけです。
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
          <div style={{ position: 'relative' }}>
            <video ref={videoRef} src={url} controls muted playsInline preload="metadata"
              onLoadedMetadata={onMeta}
              style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid var(--line)', background: '#000', display: 'block' }} />
            {/* OCRの読み取り枠プレビュー */}
            {readMode === 'ocr' && ([-1, 1] as const).map(side => (
              <div key={side} aria-hidden style={{
                position: 'absolute',
                left: `${(0.5 + side * calib.cx - calib.w / 2) * 100}%`,
                top: `${calib.y * 100}%`,
                width: `${calib.w * 100}%`,
                height: `${calib.h * 100}%`,
                border: `1.5px solid ${side === -1 ? '#00e5ff' : '#ff2bd6'}`,
                borderRadius: 3,
                pointerEvents: 'none',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
              }} />
            ))}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
            {duration > 0 && <span className="dim">(動画 {fmtT(duration)})</span>}
          </div>
          <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
            「開始」は試合が始まる瞬間に合わせてください。そこを1ポイント目の開始として、60秒ごとに次のポイントと数えます。
            {target === 'new' && ' 「終了」はリザルト (スコアボード) が表示されている画面に合わせてください。その画面からスタッツを読み取ります。'}
          </p>

          {/* ヒル推移の読み取り方式 */}
          <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
            <span className="stat-label" style={{ margin: 0 }}>スコアの読み取り方式</span>
            <label style={{ cursor: 'pointer' }}>
              <input type="radio" name="readMode" checked={readMode === 'ocr'} disabled={running}
                onChange={() => setReadMode('ocr')} /> ブラウザOCR (無料)
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input type="radio" name="readMode" checked={readMode === 'ai'} disabled={running}
                onChange={() => setReadMode('ai')} /> AI (高精度・クレジット消費)
            </label>
          </div>

          {readMode === 'ocr' && (
            <div className="card" style={{ padding: 10, marginTop: 8 }}>
              <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
                動画の上に表示されている<span style={{ color: '#00e5ff' }}>水色</span>/<span style={{ color: '#ff2bd6' }}>ピンク</span>の枠が、
                左右チームのスコアを読む範囲です。試合中の画面に合わせてから、枠がスコアの数字をぴったり囲むようスライダーで調整し、「テスト読み取り」で確認してください。
              </p>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
                {([
                  ['横位置', 'cx', 0.02, 0.25],
                  ['縦位置', 'y', 0, 0.2],
                  ['幅', 'w', 0.02, 0.15],
                  ['高さ', 'h', 0.02, 0.12],
                ] as const).map(([label, key, min, max]) => (
                  <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {label}
                    <input type="range" min={min} max={max} step={0.002} value={calib[key]} disabled={running}
                      onChange={e => setCalib(c => ({ ...c, [key]: Number(e.target.value) }))}
                      style={{ width: 110 }} />
                  </label>
                ))}
              </div>
              <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void testRead()} disabled={running || testing}>
                  {testing ? '読み取り中...' : '🔍 この画面でテスト読み取り'}
                </button>
                {testResult && <span className="mono" style={{ fontSize: 12 }}>{testResult}</span>}
              </div>
              <p className="dim" style={{ fontSize: 10.5, margin: '6px 0 0' }}>
                初回はOCRエンジン (数MB) のダウンロードに少し時間がかかります。読み取りはすべてブラウザ内で行われ、クレジットは消費しません。
              </p>
            </div>
          )}

          <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary btn-sm" onClick={() => void run()} disabled={running}>
              {running ? (stage || '解析中...') : '解析して保存'}
            </button>
            {running && <span className="muted" style={{ fontSize: 11 }}>解析には数分かかることがあります。このままお待ちください</span>}
          </div>
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
