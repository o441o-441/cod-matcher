'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { base64ToJpegBlob, captureJpeg, fetchYouTubeVideo, parseYouTubeId, sampleHudFrames, seekTo } from '@/lib/hpVideo'
import { deriveOriented, type RawFrameReading } from '@/lib/hpTimeline'

// ============================================================
// LK動画 (試合録画) の解析フロー
//
// 1ゲームぶんの録画を選択し、
//   A) 新規提出: 動画末尾のスコアボード画面を既存の scoreboard-parse で
//      解析してスタッツを保存 (既存の画像提出と同じ保存経路) した上で、
//      試合中のHUDをサンプリングしてヒル保持の推移も保存する
//   B) 既存ゲームに追加: 提出済みのHPゲームにヒル推移だけを後付けする
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

type HudReading = { i: number; left: number | null; right: number | null; clock: number | null; hill: number | null }

const fmtT = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const FRAMES_PER_REQUEST = 8
const MAX_FRAMES = 360

// YouTube URL入力の表示フラグ。YouTubeがデータセンターIP (Supabase) からの
// 取得をbot判定で拒否しているため現状はほぼ確実に失敗する。裏側 (yt-fetch) は
// 残してあるので、YouTube側の制限が緩和されたら true に戻すだけで復活する
const ENABLE_YOUTUBE_INPUT: boolean = false

export default function HpVideoAnalyzer({ matchId, games, hostName, guestName, onSaved, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [target, setTarget] = useState<string>('new') // 'new' | 既存HPゲームのid
  const [startT, setStartT] = useState(0)
  const [endT, setEndT] = useState(0)
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const [ytUrl, setYtUrl] = useState('')
  const [ytLoading, setYtLoading] = useState(false)
  const [ytProgress, setYtProgress] = useState('')

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const hpGames = games.filter(g => g.mode === 'hp')
  const interval = Math.max(2.5, (Math.max(0, endT - startT)) / MAX_FRAMES)

  const handleFile = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (url) URL.revokeObjectURL(url)
    setError(null); setDoneMsg(null)
    setFileName(f.name)
    setUrl(URL.createObjectURL(f))
  }

  // YouTube動画をEdge Function経由で一度ダウンロードし、ローカル動画と同じフローに乗せる
  const loadYouTube = async () => {
    if (ytLoading || running) return
    const videoId = parseYouTubeId(ytUrl)
    if (!videoId) { setError('YouTubeのURLを認識できませんでした (例: https://youtube.com/watch?v=...)'); return }
    setYtLoading(true); setError(null); setDoneMsg(null)
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
    setDuration(v.duration)
    setStartT(0)
    setEndT(Math.max(0, v.duration - 0.5))
  }

  const run = async () => {
    const vid = videoRef.current
    if (!vid || running) return
    if (endT - startT < 60) { setError('解析範囲が短すぎます (開始位置と終了位置を確認してください)'); return }
    setRunning(true); setError(null); setDoneMsg(null)
    vid.pause()
    try {
      let game: AnalyzerGame
      if (target === 'new') {
        // ---- 動画末尾のスコアボードを既存経路 (scoreboard-parse → rpc_scrim_submit_game) で保存 ----
        const gameNo = Math.max(0, ...games.map(g => g.game_no)) + 1
        if (gameNo > 12) throw new Error('1試合に保存できるのは12ゲームまでです')
        setStage('スコアボード画面を解析中...')
        await seekTo(vid, endT)
        const sb = captureJpeg(vid, { width: 1600, quality: 0.85 })
        const path = `${matchId}/${crypto.randomUUID()}.jpg`
        const { error: upErr } = await supabase.storage.from('scoreboards').upload(path, base64ToJpegBlob(sb), { contentType: 'image/jpeg' })
        if (upErr) throw new Error('スコアボード画像のアップロードに失敗しました: ' + upErr.message)
        const { data, error } = await supabase.functions.invoke('scoreboard-parse', { body: { image_path: path, match_id: matchId } })
        if (error) throw new Error('スコアボードのAI解析に失敗しました。終了位置をリザルト画面に合わせてください')
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
        onSaved()
        if (mode !== 'hp') {
          setDoneMsg(`GAME ${gameNo} のスタッツを保存しました (ハードポイント以外のためヒル推移の解析はスキップしました)`)
          return
        }
        game = { id: gameId, game_no: gameNo, mode, map: r.map, host_score: hostScore, guest_score: guestScore, host_slot: aIsHost ? 'team1' : 'team2' }
      } else {
        const g = hpGames.find(x => x.id === target)
        if (!g) throw new Error('対象のゲームが見つかりません')
        game = g
      }

      // ---- 試合中のHUDをサンプリング ----
      setStage('フレームを抽出中... 0%')
      const sampleEnd = target === 'new' ? Math.max(startT, endT - 3) : endT
      const frames = await sampleHudFrames(vid, {
        startT, endT: sampleEnd, interval,
        onProgress: (d, tot) => setStage(`フレームを抽出中... ${Math.round((d / tot) * 100)}%`),
      })
      if (frames.length < 10) throw new Error('フレームを十分に抽出できませんでした')

      // ---- Edge Function でHUD読み取り (8枚ずつ・並列2) ----
      const batches: typeof frames[] = []
      for (let i = 0; i < frames.length; i += FRAMES_PER_REQUEST) batches.push(frames.slice(i, i + FRAMES_PER_REQUEST))
      const totalBatches = batches.length
      let doneBatches = 0
      const readings: RawFrameReading[] = []
      setStage(`AIがHUDを読み取り中... 0/${totalBatches}`)
      const worker = async () => {
        for (;;) {
          const batch = batches.shift()
          if (!batch) return
          const { data, error } = await supabase.functions.invoke('hp-video-parse', {
            body: { frames: batch.map(f => ({ i: f.i, data: f.data })) },
          })
          if (error) throw new Error('HUDのAI読み取りに失敗しました。もう一度お試しください')
          for (const r of ((data as { readings?: HudReading[] })?.readings ?? [])) {
            const f = batch.find(x => x.i === r.i)
            if (f) readings.push({ t: f.t, left: r.left, right: r.right, clock: r.clock, hill: r.hill })
          }
          doneBatches += 1
          setStage(`AIがHUDを読み取り中... ${doneBatches}/${totalBatches}`)
        }
      }
      await Promise.all([worker(), worker()])

      // ---- 推移を導出して保存 ----
      setStage('ヒル保持の推移を計算中...')
      const derived = deriveOriented(readings, game)
      if (derived.rotations.length === 0) {
        throw new Error('スコアの推移を読み取れませんでした。試合中のHUD (上部のスコア表示) が映っている動画か確認してください')
      }
      const { error: tlErr } = await supabase.rpc('rpc_scrim_submit_hp_timeline', {
        p_game_id: game.id,
        p_sample_interval: interval,
        p_rotation_method: derived.method,
        p_samples: derived.samples,
        p_rotations: derived.rotations,
      })
      if (tlErr) throw new Error('推移の保存に失敗しました: ' + tlErr.message)
      setDoneMsg(`GAME ${game.game_no} のヒル保持推移を保存しました (${derived.rotations.length}ポイント)`)
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
        1ゲームぶんの録画 (観戦/配信視点) の動画ファイルを選択してください。YouTubeにある動画は一度ダウンロードしてから読み込んでください。
        動画はサーバーに保存されず、ブラウザ内でフレームだけを切り出してAIが読み取ります。
        ハードポイントでは「どのチームが地点に乗れていたか」の推移も保存されます。
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
      {ENABLE_YOUTUBE_INPUT && (
        <p className="dim" style={{ fontSize: 10.5, margin: '4px 0 0' }}>
          ※ YouTube側の制限で直接取得できないことがあります。その場合は動画をダウンロードして「動画ファイルを選択」からお試しください。
        </p>
      )}
      {fileName && <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>読み込み済み: {fileName}</p>}

      {url && (
        <div style={{ marginTop: 10 }}>
          <video ref={videoRef} src={url} controls muted playsInline preload="metadata"
            onLoadedMetadata={onMeta}
            style={{ width: '100%', maxHeight: 360, borderRadius: 8, border: '1px solid var(--line)', background: '#000' }} />

          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
          {target === 'new' && (
            <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
              「終了」はリザルト (スコアボード) が表示されている画面に合わせてください。その画面からスタッツを読み取ります。
            </p>
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
      {doneMsg && <p style={{ color: 'var(--success)', fontSize: 12, margin: '10px 0 0' }}>✓ {doneMsg}</p>}
      <p className="dim" style={{ fontSize: 10.5, margin: '10px 0 0' }}>
        {hostName} / {guestName} の割り当ては保存済みスコアとの照合で自動判定されます。逆になっていた場合は推移表示の「左右入れ替え」で修正できます。
      </p>
    </div>
  )
}
