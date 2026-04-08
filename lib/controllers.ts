// 使用デバイス選択肢。メーカーごとにグルーピング。
// 一覧は monoru.trie-marketing.co.jp の掲載情報、gamepadla.com のテスト済みリスト、
// および FPS / COD 競技シーンで一般的に使われるモデルを参考に整理。
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
      'Xbox Adaptive Controller',
    ],
  },
  {
    manufacturer: 'Nintendo',
    options: ['Nintendo Switch Pro Controller'],
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
      'Razer Kishi V2',
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
    manufacturer: 'Flydigi',
    options: [
      'Flydigi Apex 2',
      'Flydigi Apex 3',
      'Flydigi Apex 4',
      'Flydigi Vader 2',
      'Flydigi Vader 3 Pro',
      'Flydigi Vader 4 Pro',
      'Flydigi Vader 5 Pro',
      'Flydigi Direwolf 2',
    ],
  },
  {
    manufacturer: 'GameSir',
    options: [
      'GameSir G7',
      'GameSir G7 SE',
      'GameSir G7 HE',
      'GameSir T4 Kaleid',
      'GameSir T4 Pro',
      'GameSir T4 mini',
      'GameSir Cyclone',
      'GameSir Cyclone 2',
      'GameSir Cyclone Pro',
      'GameSir Nova',
      'GameSir Nova Lite',
      'GameSir X2s',
    ],
  },
  {
    manufacturer: '8BitDo',
    options: [
      '8BitDo Ultimate Controller',
      '8BitDo Ultimate 2C',
      '8BitDo Ultimate Bluetooth',
      '8BitDo Pro 2',
      '8BitDo SN30 Pro',
      '8BitDo Lite SE',
    ],
  },
  {
    manufacturer: 'Nacon',
    options: [
      'Nacon Revolution X',
      'Nacon Revolution X Pro',
      'Nacon Revolution 5 Pro',
      'Nacon Revolution Unlimited Pro',
    ],
  },
  {
    manufacturer: 'HORI',
    options: [
      'HORI Fighting Commander OCTA',
      'HORI Onyx+',
      'HORI Split Pad Pro',
    ],
  },
  {
    manufacturer: 'Thrustmaster',
    options: ['Thrustmaster eSwap X Pro', 'Thrustmaster eSwap S Pro'],
  },
  {
    manufacturer: 'PowerA',
    options: [
      'PowerA Fusion Pro 2',
      'PowerA Fusion Pro 3',
      'PowerA Spectra Infinity',
    ],
  },
  {
    manufacturer: 'Turtle Beach',
    options: ['Turtle Beach Recon Controller', 'Turtle Beach Stealth Ultra'],
  },
  {
    manufacturer: 'Mad Catz',
    options: ['Mad Catz C.A.T. 9'],
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
