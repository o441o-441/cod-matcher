// Discord スラッシュコマンド「/空き」の登録スクリプト
//
// 使い方:
//   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=yyy node scripts/register-discord-command.mjs
//   (ギルド限定で即時反映したい場合は DISCORD_GUILD_ID=zzz も指定。
//    グローバル登録は反映まで最大1時間かかる)

const appId = process.env.DISCORD_APP_ID
const botToken = process.env.DISCORD_BOT_TOKEN
const guildId = process.env.DISCORD_GUILD_ID // 任意

if (!appId || !botToken) {
  console.error('DISCORD_APP_ID と DISCORD_BOT_TOKEN を環境変数で指定してください')
  process.exit(1)
}

const command = {
  name: '空き',
  description: '交流戦ボードに空き時間を登録します (20:00〜25:00)',
  options: [
    {
      type: 3, // STRING
      name: '時間',
      description: '例: 21-24 / 21:30-24:30 / なし (クリア)',
      required: true,
    },
    {
      type: 4, // INTEGER
      name: '日',
      description: '0=今日, 1=明日, ... 13 (省略時は今日)',
      required: false,
      min_value: 0,
      max_value: 13,
    },
  ],
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${botToken}`,
  },
  body: JSON.stringify(command),
})

if (res.ok) {
  const data = await res.json()
  console.log(`✅ コマンド「/${data.name}」を登録しました (${guildId ? 'ギルド限定・即時反映' : 'グローバル・最大1時間で反映'})`)
} else {
  console.error(`❌ 登録失敗 (HTTP ${res.status}):`, await res.text())
  process.exit(1)
}
