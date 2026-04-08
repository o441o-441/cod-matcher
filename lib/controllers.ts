// 使用デバイス選択肢。メーカーごとにグルーピング。
// 一覧は monoru.trie-marketing.co.jp の掲載情報および
// FPS / COD 競技シーンで一般的に使われるモデルを参考に整理。
// 追加・編集はこのファイルだけを更新すれば全画面に反映されます。

export type ControllerGroup = {
  manufacturer: string
  options: string[]
}

export const CONTROLLER_GROUPS: ControllerGroup[] = [
  {
    manufacturer: 'Sony',
    options: ['DualSense (PS5)', 'DualSense Edge (PS5)', 'DualShock 4 (PS4)'],
  },
  {
    manufacturer: 'Microsoft / Xbox',
    options: [
      'Xbox Wireless Controller',
      'Xbox Elite Wireless Controller Series 2',
      'Xbox Elite Wireless Controller Series 2 Core',
    ],
  },
  {
    manufacturer: 'SCUF',
    options: [
      'SCUF Reflex',
      'SCUF Reflex Pro',
      'SCUF Reflex FPS',
      'SCUF Instinct Pro',
      'SCUF Envision Pro',
    ],
  },
  {
    manufacturer: 'Razer',
    options: [
      'Razer Wolverine V2',
      'Razer Wolverine V2 Pro',
      'Razer Wolverine V2 Chroma',
      'Razer Wolverine V3 Pro',
      'Razer Wolverine V3 Tournament Edition',
    ],
  },
  {
    manufacturer: 'BIGBIG WON',
    options: [
      'BIGBIG WON Rainbow 2 SE',
      'BIGBIG WON Rainbow 2 Pro',
      'BIGBIG WON BLITZ2',
      'BIGBIG WON BLITZ2 TMR',
    ],
  },
  {
    manufacturer: 'GameSir',
    options: [
      'GameSir G7 SE',
      'GameSir G7 HE',
      'GameSir Cyclone',
      'GameSir Cyclone Pro',
      'GameSir Nova Lite',
    ],
  },
  {
    manufacturer: '8BitDo',
    options: ['8BitDo Ultimate Controller', '8BitDo Pro 2'],
  },
  {
    manufacturer: 'Nacon',
    options: [
      'Nacon Revolution X Pro',
      'Nacon Revolution 5 Pro',
      'Nacon Revolution Unlimited Pro',
    ],
  },
  {
    manufacturer: 'HORI',
    options: ['HORI Fighting Commander OCTA', 'HORI Onyx+'],
  },
  {
    manufacturer: 'マウス',
    options: ['マウス＆キーボード'],
  },
  {
    manufacturer: 'その他',
    options: ['その他'],
  },
]

// フラットなセレクトオプション (value/label) を生成
export const flatControllerOptions = CONTROLLER_GROUPS.flatMap((g) =>
  g.options.map((opt) => ({ group: g.manufacturer, value: opt, label: opt }))
)
