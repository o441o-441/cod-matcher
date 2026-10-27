'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  base64ToJpegBlob, captureJpeg, fetchYouTubeVideo, parseYouTubeId, seekTo,
} from '@/lib/hpVideo'
import { deriveOriented, detectAnchorFromClock, type RawFrameReading } from '@/lib/hpTimeline'
import { loadCalib, readHudScores, saveCalib, warmupOcr, type HudCalib } from '@/lib/hpOcr'
import { readScoreboardSignature } from '@/lib/sbDetect'

// ============================================================
// LK動画 (試合録画) の解析フロー
//
// 動画をシークして各ゲームの「スコアボード (リザルト) 画面」を
// 試合数ぶん登録するだけで、あとは自動:
//   - スコアボード画面を既存の scoreboard-parse (AI) で解析してスタッツ保存
//   - ハードポイントは、そのスコアボードから前のスコアボードまでの区間を
//     ブラウザOCR (無料) で1秒間隔読み取り
//   - 試合開始位置はゲーム残り時間が 4:59 になった瞬間として自動判定し、
//     そこを1ポイント目の開始として60秒ごとに区切る
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

const fmtT = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const MAX_VIDEO_SEC = 2 * 3600 // これを超える動画はエラー
const SCAN_STEP_SEC = 0.2 // 自動検出のサンプリング間隔 (秒)。スコアボードは試合終了後0.3秒しか表示されないため細かく刻む
const SCAN_REFINE_SEC = 0.1 // 検出後に表示区間の端を探る間隔 (秒)
const SCAN_REFINE_MAX_STEPS = 5 // 表示は0.3秒程度なので端探りは片側0.5秒まで
const SCAN_SKIP_AFTER_HIT_SEC = 5 * 60 // 検出後、次のゲームまで飛ばす幅 (ゲーム間は5分以上空く)
const SCAN_STAGE_EVERY = 25 // 進捗表示の更新間隔 (ステップ数。0.2秒刻みで約5秒ごと)
const OCR_INTERVAL_SEC = 1 // OCRのサンプリング間隔 (秒)
const OCR_MAX_FRAMES = 1200 // 1ゲームのOCRサンプリング上限 (超える長さは間隔が広がる)
const GAME_LOOKBACK_SEC = 16 * 60 // スコアボードから遡って読む最大範囲 (1ゲームの最長想定)

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
  const [sbMarks, setSbMarks] = useState<number[]>([]) // スコアボード画面の動画内位置 (秒)
  const [thumbs, setThumbs] = useState<Record<number, string>>({}) // 位置 → サムネイル (dataURL)
  const [scanning, setScanning] = useState(false)
  const [scanStage, setScanStage] = useState('')
  const scanCancel = useRef(false)

  // ヒル推移の読み取りはブラウザOCR (無料・通信なし) のみ
  const [calib, setCalib] = useState<HudCalib>(() => loadCalib())
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => { saveCalib(calib) }, [calib])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const hpGames = games.filter(g => g.mode === 'hp')
  const sortedMarks = [...sbMarks].sort((a, b) => a - b)

  const handleFile = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (url) URL.revokeObjectURL(url)
    setError(null); setResults([]); setSbMarks([]); setThumbs({})
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
      setSbMarks([]); setThumbs({})
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
  }

  const addMark = () => {
    const v = videoRef.current
    if (!v || running || scanning) return
    const t = Math.round(v.currentTime * 10) / 10
    try {
      const thumb = 'data:image/jpeg;base64,' + captureJpeg(v, { width: 240, quality: 0.6 })
      setThumbs(prev => ({ ...prev, [t]: thumb }))
    } catch { /* サムネイルが取れなくても位置登録は続ける */ }
    setSbMarks(m => (m.some(x => Math.abs(x - t) < 2) ? m : [...m, t]))
  }

  const removeMark = (t: number) => {
    setSbMarks(m => m.filter(x => x !== t))
    setThumbs(prev => { const next = { ...prev }; delete next[t]; return next })
  }

  const clearMarks = () => { setSbMarks([]); setThumbs({}) }

  // ---- スコアボード画面の自動検出 ----
  // 2本のチーム区切り線 (シアン/オレンジ) のピクセル判定で動画全体を
  // 粗くスキャンし、見つけた表示区間の中央をスコアボード位置として登録する。
  // 全てブラウザ内処理 (無料)。誤検出はサムネイルを見て ✕ で外せる
  const autoScan = async () => {
    const vid = videoRef.current
    if (!vid || running || scanning || !vid.duration) return
    setScanning(true); setError(null)
    scanCancel.current = false
    vid.pause()
    const canvas = document.createElement('canvas')
    let foundCount = 0
    try {
      const end = Math.max(0, vid.duration - 0.3)
      let t = 1
      let step = 0
      while (t <= end && !scanCancel.current) {
        if (step % SCAN_STAGE_EVERY === 0) {
          setScanStage(`スキャン中... ${fmtT(t)} / ${fmtT(end)} (検出 ${foundCount}件)`)
        }
        step += 1
        let hit = false
        try {
          await seekTo(vid, t)
          hit = readScoreboardSignature(vid, canvas)
        } catch { /* シーク失敗は未検出として先へ進む */ }
        if (!hit) { t = Math.round((t + SCAN_STEP_SEC) * 10) / 10; continue }
        // 表示区間の端を探り、中央のフレームを採用 (表示アニメーション途中を避ける)
        let lo = t
        let hi = t
        for (let i = 0; i < SCAN_REFINE_MAX_STEPS && lo - SCAN_REFINE_SEC >= 0; i++) {
          try {
            await seekTo(vid, lo - SCAN_REFINE_SEC)
            if (!readScoreboardSignature(vid, canvas)) break
            lo -= SCAN_REFINE_SEC
          } catch { break }
        }
        for (let i = 0; i < SCAN_REFINE_MAX_STEPS && hi + SCAN_REFINE_SEC <= end; i++) {
          try {
            await seekTo(vid, hi + SCAN_REFINE_SEC)
            if (!readScoreboardSignature(vid, canvas)) break
            hi += SCAN_REFINE_SEC
          } catch { break }
        }
        const mid = Math.round(((lo + hi) / 2) * 10) / 10
        try {
          await seekTo(vid, mid)
          const thumb = 'data:image/jpeg;base64,' + captureJpeg(vid, { width: 240, quality: 0.6 })
          setThumbs(prev => ({ ...prev, [mid]: thumb }))
        } catch { /* サムネイル無しでも登録はする */ }
        setSbMarks(m => (m.some(x => Math.abs(x - mid) < 10) ? m : [...m, mid]))
        foundCount += 1
        t = hi + SCAN_SKIP_AFTER_HIT_SEC
      }
      if (foundCount === 0 && !scanCancel.current) {
        setError('スコアボード画面を検出できませんでした。録画の画質や画面比率によっては検出できないことがあります。手動でシークして「追加」してください')
      }
    } finally {
      setScanning(false)
      setScanStage('')
    }
  }

  // 現在表示中のフレームでOCRの読み取りテスト (枠位置の調整用)
  const testRead = async () => {
    const vid = videoRef.current
    if (!vid || testing || running || scanning) return
    setTesting(true); setTestResult(null)
    try {
      await warmupOcr()
      const { left, right, clock } = await readHudScores(vid, calib)
      setTestResult(`読み取り結果 — 左: ${left ?? '×'} / 右: ${right ?? '×'} / 残り時間: ${clock !== null ? fmtT(clock) : '×'}`)
    } catch (e) {
      setTestResult('読み取りに失敗しました: ' + (e instanceof Error ? e.message : 'エラー'))
    } finally {
      setTesting(false)
    }
  }

  // ---- 指定時刻の画面をスコアボードとして解析・保存 (既存経路) ----
  const submitScoreboardAt = async (vid: HTMLVideoElement, t: number, gameNo: number): Promise<AnalyzerGame> => {
    await seekTo(vid, t)
    const sb = captureJpeg(vid, { width: 1600, quality: 0.85 })
    const path = `${matchId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage.from('scoreboards').upload(path, base64ToJpegBlob(sb), { contentType: 'image/jpeg' })
    if (upErr) throw new Error('スコアボード画像のアップロードに失敗しました: ' + upErr.message)
    const { data, error: fnErr } = await supabase.functions.invoke('scoreboard-parse', { body: { image_path: path, match_id: matchId } })
    if (fnErr) throw new Error('スコアボードのAI解析に失敗しました。位置がリザルト画面に合っているか確認してください')
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

  // ---- 区間のHUDをOCRで読み取り、ヒル保持の推移を保存 ----
  // 試合開始はゲーム残り時間 (4:59になった瞬間) から自動判定する
  const runTimelineFor = async (
    vid: HTMLVideoElement,
    game: AnalyzerGame,
    rangeStart: number,
    rangeEnd: number,
    onStage: (text: string) => void
  ): Promise<{ n: number; anchorAt: number }> => {
    onStage('OCRエンジンを準備中...')
    await warmupOcr()
    const interval = Math.max(OCR_INTERVAL_SEC, (Math.max(0, rangeEnd - rangeStart)) / OCR_MAX_FRAMES)
    const times: number[] = []
    for (let t = rangeStart; t <= rangeEnd; t += interval) times.push(Math.round(t * 10) / 10)
    const readings: RawFrameReading[] = []
    for (let i = 0; i < times.length; i++) {
      try {
        await seekTo(vid, times[i])
        const { left, right, clock } = await readHudScores(vid, calib)
        readings.push({ t: times[i], left, right, clock, hill: null })
      } catch { /* シーク失敗したフレームは飛ばす */ }
      onStage(`OCRで読み取り中... ${i + 1}/${times.length}`)
    }
    onStage('ヒル保持の推移を計算中...')
    const anchorT = detectAnchorFromClock(readings)
    if (anchorT === null) {
      throw new Error('ゲーム残り時間を読み取れず、試合開始位置を判定できませんでした。「残り時間枠」の位置を調整してください')
    }
    // 試合開始より前 (ロビー等) の誤読を混ぜないよう、開始以降だけで導出する
    const inGame = readings.filter(r => r.t >= anchorT - 2)
    const okCount = inGame.filter(r => r.left !== null || r.right !== null).length
    if (inGame.length === 0 || okCount / inGame.length < 0.3) {
      throw new Error('OCRでスコアをほとんど読み取れませんでした。「スコア枠」の位置を調整してください')
    }
    const derived = deriveOriented(inGame, game, { anchorT })
    if (derived.rotations.length === 0) {
      throw new Error('スコアの推移を読み取れませんでした')
    }
    const { error: tlErr } = await supabase.rpc('rpc_scrim_submit_hp_timeline', {
      p_game_id: game.id,
      p_sample_interval: interval,
      p_rotation_method: 'clock',
      p_samples: derived.samples,
      p_rotations: derived.rotations,
    })
    if (tlErr) throw new Error('推移の保存に失敗しました: ' + tlErr.message)
    return { n: derived.rotations.length, anchorAt: anchorT }
  }

  // ---- 登録されたスコアボード位置を順に処理 ----
  const run = async () => {
    const vid = videoRef.current
    if (!vid || running || scanning) return
    const marks = [...sbMarks].sort((a, b) => a - b)
    if (marks.length === 0) { setError('スコアボード画面の位置を追加してください'); return }
    setRunning(true); setError(null); setResults([])
    vid.pause()
    try {
      if (target === 'new') {
        const msgs: string[] = []
        let gameNo = Math.max(0, ...games.map(g => g.game_no)) + 1
        for (let i = 0; i < marks.length; i++) {
          const sbT = marks[i]
          const label = `ゲーム${i + 1}/${marks.length}`
          if (gameNo > 12) { msgs.push('1試合12ゲームの上限に達したため残りをスキップしました'); break }
          try {
            setStage(`${label}: スコアボードを解析中...`)
            const game = await submitScoreboardAt(vid, sbT, gameNo)
            gameNo += 1
            onSaved()
            if (game.mode === 'hp') {
              try {
                // このゲームの範囲 = 前のスコアボードの後 〜 このスコアボードの直前
                const rangeStart = Math.max(i > 0 ? marks[i - 1] + 2 : 0, sbT - GAME_LOOKBACK_SEC)
                const rangeEnd = Math.max(rangeStart, sbT - 3)
                const res = await runTimelineFor(vid, game, rangeStart, rangeEnd, p => setStage(`${label}: ${p}`))
                msgs.push(`✓ GAME ${game.game_no}${game.map ? ` (${game.map})` : ''}: スタッツ + ヒル推移 (${res.n}ポイント、試合開始 ${fmtT(res.anchorAt)}) を保存`)
                onSaved()
              } catch (e2) {
                msgs.push(`△ GAME ${game.game_no}: スタッツは保存、ヒル推移は失敗 — ${e2 instanceof Error ? e2.message : 'エラー'}`)
              }
            } else {
              msgs.push(`✓ GAME ${game.game_no}${game.map ? ` (${game.map})` : ''}: スタッツを保存 (ハードポイント以外のため推移なし)`)
            }
          } catch (e) {
            msgs.push(`✗ ${label} (${fmtT(sbT)}): スコアボード解析に失敗 — ${e instanceof Error ? e.message : 'エラー'}`)
          }
          setResults([...msgs])
        }
        msgs.push('完了しました。間違いがあれば各ゲームの「取り消す」で削除して再提出できます')
        setResults([...msgs])
      } else {
        // 既存HPゲームへの後付け: 最初に登録した位置をそのゲームのスコアボードとして使う
        const g = hpGames.find(x => x.id === target)
        if (!g) throw new Error('対象のゲームが見つかりません')
        const sbT = marks[0]
        const rangeStart = Math.max(0, sbT - GAME_LOOKBACK_SEC)
        const res = await runTimelineFor(vid, g, rangeStart, Math.max(rangeStart, sbT - 3), p => setStage(p))
        setResults([`✓ GAME ${g.game_no} のヒル保持推移を保存しました (${res.n}ポイント、試合開始 ${fmtT(res.anchorAt)})`])
        onSaved()
      }
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
        LK動画 (観戦/配信視点の録画・2時間まで) を読み込んで「自動検出」を押すと、各ゲームのスコアボード (リザルト) 画面を探して登録し、
        スタッツとハードポイントのヒル保持推移を順に保存します。試合開始位置は残り時間から自動判定されます。
        YouTubeにある動画は一度ダウンロードしてから読み込んでください。
        動画はサーバーに保存されません。AIを使うのはスコアボード画像の解析だけで、推移の読み取りはブラウザ内OCR (無料) です。
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn-ghost btn-sm" style={{ cursor: running ? 'wait' : 'pointer', display: 'inline-block' }}>
          📁 動画ファイルを選択
          <input type="file" accept="video/*" style={{ display: 'none' }} disabled={running || ytLoading || scanning}
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
            {/* OCRの読み取り枠プレビュー (左右スコア + 中央の残り時間) */}
            {([-1, 1] as const).map(side => (
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
            <div aria-hidden style={{
              position: 'absolute',
              left: `${(0.5 - calib.clockW / 2) * 100}%`,
              top: `${calib.clockY * 100}%`,
              width: `${calib.clockW * 100}%`,
              height: `${calib.clockH * 100}%`,
              border: '1.5px solid #f59e0b',
              borderRadius: 3,
              pointerEvents: 'none',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            }} />
          </div>

          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={target} onChange={e => setTarget(e.target.value)} disabled={running} style={{ fontSize: 12 }}>
              <option value="new">新規ゲームとして提出 (スタッツ + ヒル推移)</option>
              {hpGames.map(g => (
                <option key={g.id} value={g.id}>GAME {g.game_no}{g.map ? ` (${g.map})` : ''} にヒル推移だけ追加</option>
              ))}
            </select>
            {duration > 0 && <span className="dim" style={{ fontSize: 11 }}>動画 {fmtT(duration)}</span>}
          </div>

          {/* スコアボード位置の登録 */}
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-primary btn-sm" disabled={running || scanning} onClick={() => void autoScan()}>
              {scanning ? (scanStage || 'スキャン中...') : '🔎 スコアボード画面を自動検出'}
            </button>
            {scanning && (
              <button className="btn-ghost btn-sm" style={{ fontSize: 10.5 }} onClick={() => { scanCancel.current = true }}>
                中断
              </button>
            )}
            <button className="btn-ghost btn-sm" disabled={running || scanning} onClick={addMark}>
              ➕ 現在位置を手動で追加
            </button>
            {sbMarks.length > 0 && (
              <button className="btn-ghost btn-sm" style={{ fontSize: 10.5 }} disabled={running || scanning} onClick={clearMarks}>
                すべてクリア
              </button>
            )}
          </div>
          {sortedMarks.length > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {sortedMarks.map((t, i) => (
                <div key={t} className="card" style={{ padding: 6, width: 132 }}>
                  {thumbs[t] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[t]} alt={`スコアボード候補 ${fmtT(t)}`}
                      style={{ width: '100%', borderRadius: 4, display: 'block', cursor: 'pointer' }}
                      onClick={() => { const v = videoRef.current; if (v && !running && !scanning) v.currentTime = t }} />
                  )}
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span className="mono" style={{ fontSize: 10.5 }}>{i + 1}. {fmtT(t)}</span>
                    <button type="button" disabled={running || scanning} onClick={() => removeMark(t)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                      aria-label={`${fmtT(t)} を削除`}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
            「自動検出」は動画全体を0.2秒刻みでスキャンして各ゲームのリザルト画面 (表示は0.3秒だけ) を探します (ブラウザ内処理・無料、動画10分あたり1〜3分ほど)。
            検出結果はサムネイルで確認し、間違いは ✕ で外してください。
            {target === 'new'
              ? ' 試合の順番どおりでなくても、位置順に並べ替えて処理されます。'
              : ' 既存ゲームへの後付けでは、最初に登録した1つだけが使われます。'}
          </p>

          {/* OCRの読み取り枠調整 */}
          <div className="card" style={{ padding: 10, marginTop: 8 }}>
              <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
                動画の上の<span style={{ color: '#00e5ff' }}>水色</span>/<span style={{ color: '#ff2bd6' }}>ピンク</span>の枠が左右チームのスコア、
                <span style={{ color: '#f59e0b' }}>オレンジ</span>の枠が画面中央最上部のゲーム残り時間を読む範囲です。
                試合中の画面に合わせてから、各枠が数字をぴったり囲むようスライダーで調整し、「テスト読み取り」で確認してください。
              </p>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
                <span className="stat-label" style={{ margin: 0 }}>スコア枠</span>
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
              <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 11, alignItems: 'center', marginTop: 6 }}>
                <span className="stat-label" style={{ margin: 0 }}>残り時間枠</span>
                {([
                  ['縦位置', 'clockY', 0, 0.15],
                  ['幅', 'clockW', 0.03, 0.15],
                  ['高さ', 'clockH', 0.02, 0.1],
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

          <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary btn-sm" onClick={() => void run()} disabled={running || scanning || sbMarks.length === 0}>
              {running ? (stage || '解析中...') : `解析して保存${sortedMarks.length > 0 ? ` (${target === 'new' ? `${sortedMarks.length}ゲーム` : '1ゲーム'})` : ''}`}
            </button>
            {running && <span className="muted" style={{ fontSize: 11 }}>1ゲームあたり数分かかります。このままお待ちください</span>}
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
        {hostName} / {guestName} の割り当てはスコアボードの最終スコアとの照合で自動判定されます。
      </p>
    </div>
  )
}
