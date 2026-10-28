'use client'

// ============================================================
// GTMイベント送信 (dataLayer.push の薄いラッパー)
//
// アプリ側はここを通してイベントを送るだけ。GA4への転送や
// 広告コンバージョン等への振り分けはGTM管理画面側で設定する
// (「GA4イベント」タグ + 「カスタムイベント」トリガー)。
// 計測はベストエフォート: 失敗してもアプリの動作には影響させない。
// ============================================================

import { sendGTMEvent } from '@next/third-parties/google'

export function gtmEvent(event: string, params?: Record<string, string | number | boolean>) {
  try {
    sendGTMEvent({ event, ...params })
  } catch {
    // 広告ブロッカー等でdataLayerが無くても無視
  }
}
