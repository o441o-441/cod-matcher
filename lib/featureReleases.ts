'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ============================================================
// 機能の段階公開スケジュール (クライアント側ヘルパー)
//
// スケジュールは app_settings.feature_release_* が正で、
// rpc_feature_releases() で取得する。判定はサーバー時刻基準
// (クライアント時計のずれを now とのオフセットで補正)。
// あくまでUX用の表示制御で、実効ガードはDBトリガー (trg_feature_gate)。
// ============================================================

export type FeatureKey = '8s' | 'ranked' | 'scrim' | 'tournament'

export const FEATURE_META: Record<FeatureKey, { label: string; path: string; desc: string }> = {
  '8s': { label: '8s（8人カスタム）', path: '/custom', desc: '即席ロビーで8人カスタム。レート変動なし' },
  ranked: { label: 'ランクマッチ', path: '/match', desc: '4v4レート戦。キューに入って対戦相手を探す' },
  scrim: { label: '交流戦ボード', path: '/custom/board', desc: 'チーム同士で対戦相手を見つける' },
  tournament: { label: '大会', path: '/tournaments', desc: 'トーナメント・リーグ戦の開催と参加' },
}

// NEWバッジ (公開から5日間)
const NEW_BADGE_DAYS = 5

export type FeatureReleases = {
  // サーバー時刻と端末時刻のオフセット (ms)。serverNow = Date.now() + offset
  offsetMs: number
  // 機能キー → 公開日時 (epoch ms)。エントリなし = 公開済み扱い
  releases: Partial<Record<FeatureKey, number>>
}

let cached: FeatureReleases | null = null
let inflight: Promise<FeatureReleases> | null = null

export async function fetchFeatureReleases(): Promise<FeatureReleases> {
  if (cached) return cached
  if (!inflight) {
    inflight = (async () => {
      try {
        const { data, error } = await supabase.rpc('rpc_feature_releases')
        if (error) throw error
        const res = data as { now: string; releases: Record<string, string> }
        const releases: Partial<Record<FeatureKey, number>> = {}
        for (const [k, v] of Object.entries(res.releases ?? {})) {
          const t = Date.parse(v)
          if (!Number.isNaN(t)) releases[k as FeatureKey] = t
        }
        cached = { offsetMs: Date.parse(res.now) - Date.now(), releases }
      } catch {
        // 取得失敗時はフェイルオープン (表示制御のみ。実効ガードはDB側)
        cached = { offsetMs: 0, releases: {} }
      }
      return cached
    })()
  }
  return inflight
}

export const serverNow = (fr: FeatureReleases) => Date.now() + fr.offsetMs

export const isReleased = (fr: FeatureReleases, key: FeatureKey) => {
  const at = fr.releases[key]
  return at == null || at <= serverNow(fr)
}

// 公開日時が180日以上先 = 凍結中 (時期未定) として扱う。
// 凍結はDB側で feature_release_* を遠い未来 (例: 2099年) にするだけ
export const isTbd = (fr: FeatureReleases, key: FeatureKey) => {
  const at = fr.releases[key]
  return at != null && at - serverNow(fr) > 180 * 24 * 60 * 60 * 1000
}

// 公開から5日間は true (未公開は false)
export const isNewlyReleased = (fr: FeatureReleases, key: FeatureKey) => {
  const at = fr.releases[key]
  if (at == null) return false
  const now = serverNow(fr)
  return at <= now && now < at + NEW_BADGE_DAYS * 24 * 60 * 60 * 1000
}

// 公開日時の表示 (例: 10/24(金) 12:00)
export const releaseLabel = (fr: FeatureReleases, key: FeatureKey) => {
  const at = fr.releases[key]
  if (at == null) return ''
  const d = new Date(at)
  const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${youbi}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function useFeatureReleases() {
  const [fr, setFr] = useState<FeatureReleases | null>(cached)
  useEffect(() => {
    if (fr) return
    let cancelled = false
    void fetchFeatureReleases().then(v => { if (!cancelled) setFr(v) })
    return () => { cancelled = true }
  }, [fr])
  return fr // null = 読込中
}
