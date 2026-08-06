# 交流戦ボード Discord bot (/空き コマンド)

Discord から一行で空き時間を登録する機能。ASCENT を開かずに入力できる。

```
/空き 時間:21-24            → 今日の 21:00〜24:00 を登録
/空き 時間:21:30-24:30 日:1 → 明日の 21:30〜24:30 を登録
/空き 時間:なし             → 今日の空きをクリア
```

- 応答は本人にだけ見える (ephemeral)
- Discord アカウントは ASCENT のログイン (Discord OAuth) と自動で紐づく
- チーム未所属・ASCENT 未ログインの場合は案内メッセージを返す

## 仕組み

- Supabase Edge Function `discord-interactions` (デプロイ済み) が Discord の
  Interactions Endpoint として動作する
- 認証は Discord の **Ed25519 署名検証** (`DISCORD_PUBLIC_KEY`)。Supabase JWT は使わない
- 書き込みは service role で `member_availability` を直接置き換え
  (`rpc_scrimboard_set_availability` と同じセマンティクス)

エンドポイント URL:

```
https://pudejxolslrlxnmmmsps.supabase.co/functions/v1/discord-interactions
```

## セットアップ手順 (初回のみ・約10分)

1. **Discord アプリを作成**
   https://discord.com/developers/applications → New Application
   (既存の ASCENT OAuth アプリをそのまま使ってもよい)

2. **公開鍵を Supabase に設定**
   アプリの General Information → `PUBLIC KEY` をコピーし、
   ```
   supabase secrets set DISCORD_PUBLIC_KEY=<公開鍵> --project-ref pudejxolslrlxnmmmsps
   ```
   (またはダッシュボード → Edge Functions → Secrets から設定)

3. **Interactions Endpoint URL を設定**
   アプリの General Information → `INTERACTIONS ENDPOINT URL` に上記エンドポイント URL を入力して Save。
   Discord が PING を送って検証する (2 の公開鍵設定が先に必要)

4. **スラッシュコマンドを登録**
   アプリの Bot タブでトークンを発行し、
   ```
   DISCORD_APP_ID=<アプリID> DISCORD_BOT_TOKEN=<トークン> DISCORD_GUILD_ID=<サーバーID> node scripts/register-discord-command.mjs
   ```
   `DISCORD_GUILD_ID` を付けるとそのサーバーに即時反映。付けなければグローバル登録 (最大1時間)

5. **アプリをサーバーに追加**
   OAuth2 → URL Generator → scope `applications.commands` を選び、生成された URL でサーバーに追加

## トラブルシューティング

| 症状 | 原因 |
|---|---|
| Endpoint 検証が失敗する | `DISCORD_PUBLIC_KEY` 未設定 or 値が違う |
| 「ASCENT アカウントが見つかりません」 | その Discord アカウントで ASCENT に未ログイン (`users.discord_user_id` 未紐づけ) |
| 「チームに所属していないため…」 | ASCENT でチーム未参加 |
| コマンドが出てこない | グローバル登録は反映に最大1時間。ギルド登録で回避 |
