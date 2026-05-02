// 使用デバイス選択肢。メーカーごとにグルーピング。
// FPS / COD 競技シーンで使われるモデルを中心に整理。
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
    manufacturer: 'SCUF',
    options: [
      'SCUF Reflex',
      'SCUF Reflex Pro',
      'SCUF Reflex FPS',
      'SCUF Valor Pro Wireless',
      'SCUF Instinct Pro',
      'SCUF Envision',
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
      'Razer Wolverine V3 Pro 8K',
      'Razer Wolverine V3 Tournament Edition',
      'Razer Kishi V2',
    ],
  },
  {
    manufacturer: 'Victrix / Turtle Beach',
    options: [
      'Victrix Pro BFG',
      'Victrix Pro BFG Reloaded',
      'Victrix Pro BFG Reloaded PC Edition',
      'Turtle Beach Recon Controller',
      'Turtle Beach Stealth Ultra',
    ],
  },
  {
    manufacturer: 'Nacon',
    options: [
      'Nacon Revolution X',
      'Nacon Revolution X Pro',
      'Nacon Revolution X Unlimited',
      'Nacon Revolution 5 Pro',
      'Nacon Revolution Unlimited Pro',
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
      'GameSir G7 Pro',
      'GameSir G7 Pro 8K',
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
    manufacturer: 'BIGBIG WON',
    options: [
      'BIGBIG WON Rainbow 2 SE',
      'BIGBIG WON Rainbow 2 Pro',
      'BIGBIG WON BLITZ2',
      'BIGBIG WON BLITZ2 TMR',
    ],
  },
  {
    manufacturer: 'GuliKit',
    options: [
      'GuliKit KingKong 2 Pro',
      'GuliKit KingKong 3 Max',
      'GuliKit KingKong 3 Pro',
      'GuliKit KK2 T',
      'GuliKit TT Pro',
      'GuliKit TT Max',
      'GuliKit ES Pro',
    ],
  },
  {
    manufacturer: 'EasySMX',
    options: [
      'EasySMX D10',
      'EasySMX X20',
    ],
  },
  {
    manufacturer: 'Machenike',
    options: [
      'Machenike G5 Pro',
      'Machenike G5 Pro V2',
    ],
  },
  {
    manufacturer: 'LeadJoy',
    options: [
      'LeadJoy Xeno Plus',
    ],
  },
  {
    manufacturer: 'PXN',
    options: [
      'PXN P5',
      'PXN P5 8K',
    ],
  },
  {
    manufacturer: 'Void Gaming',
    options: [
      'Void INTUITION PRO (ボタンタイプ)',
      'Void INTUITION PRO (パドルタイプ)',
      'Void INTUITION SHIRO',
      'Void エリートモデル',
      'Void クリティカルモデル',
      'Void FPS推奨モデル',
      'Void スターターモデル',
      'Void GENESIS',
      'Void PS4 FireBird',
    ],
  },
  {
    manufacturer: 'MERKA.G',
    options: [
      'MERKA.G FusionX',
      'MERKA.G REACTA',
      'MERKA.G ボタンタイプ (PS5)',
      'MERKA.G パドルタイプ (PS5)',
      'MERKA.G ボタンタイプ (PS4)',
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
    manufacturer: 'Mad Catz',
    options: ['Mad Catz C.A.T. 9'],
  },
  {
    manufacturer: 'Nintendo',
    options: ['Nintendo Switch Pro Controller'],
  },
  {
    manufacturer: 'MOJHON',
    options: ['MOJHON Rainbow3'],
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
