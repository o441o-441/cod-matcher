// 交流戦キャンセル理由 (scrim_matches.cancel_reason)。
// SQL側のホワイトリスト (rpc_scrimboard_cancel) と合わせること。
// 'conduct' は相手への通知に理由を載せず、キャンセル後に通報ページへ誘導する
export const SCRIM_CANCEL_REASONS = [
  { value: 'skill_gap', label: '実力差が大きいため' },
  { value: 'schedule', label: 'スケジュール変更のため' },
  { value: 'conduct', label: '相手の素行に問題があるため（通報）' },
  { value: 'other', label: 'その他' },
] as const

export type ScrimCancelReason = (typeof SCRIM_CANCEL_REASONS)[number]['value']
