# 交流戦ボード（Scrim Board）実装仕様

ASCENT に追加する、チームの空き時間入力と交流戦マッチングの機能。
このドキュメントは設計の確定事項と未決事項をまとめたもの。実装前に「未決事項」を確認すること。

> **✅ v1 実装済み (2026-08-06)** — `/custom/board`。本文からの主な変更点:
> - **1週間分**の入力・表示に対応（v1「当日のみ」から拡張。日付タブで切替）
> - **複合モード**を追加: ハーポ/サーチ/オバロのマップ数を組み合わせて1件で成立
> - 所要時間の確定値: **ハーポ15分・サーチ20分・オバロ15分/マップ**（ハーポ回し=6マップ=3枠)。
>   scrim_formats テーブルは作らず RPC 内の定数（変更時は rpc_scrimboard_confirm を更新）
> - スキーマ実体: `member_availability` / `scrim_slot_counts`(view) / `scrim_matches`(hp_maps/snd_maps/ovl_maps 列) /
>   `scrim_team_prefs`（日単位でなく**チーム単位**の受付宣言） / RPC 3本 + 通知関数
> - 通知は Edge Function ではなく **pg_net** で DB から直接送信（Webhook URL は team_settings、メンバーのみ閲覧可）
> - 未決事項の確定: 空き入力=メンバー全員 / 成立・キャンセル=メンバー全員可 / 別時間帯の複数成立=許可 /
>   斜線セルのスナップ=実装済み
>
> **✅ v1.1 実装済み (2026-08-06)**:
> - **曜日テンプレのDB化+毎週自動反映**: `scrim_templates` + pg_cron 日次ジョブ (04:05 JST)。
>   手動入力済みの日は上書きしない (`scrim_template_applied` マーカー)
> - **リーダー代理入力**: `rpc_scrimboard_set_availability_for` (オーナーのみ)。STEP1 に入力対象セレクタ
> - **Discord bot (8章-2) は見送り**: サイトへの導線を優先する方針のため実装しない。
>   入力コスト対策は曜日テンプレ自動反映+リーダー代理入力でカバーする
> - **レート表示 (6章)**: `scrim_slot_counts` に avg/min/max を追加。チーム固定レートは使わず
>   「その日空いているメンバー」基準のティア帯+幅を表示。受付範囲 (誰でも/同格±1) は表示のみで
>   ハードフィルタにしない (spec どおり)
> - **所要時間のテーブル化 (5.2)**: `scrim_formats` (hp15/snd20/ovl15分)。SQL で変更すれば再デプロイ不要
> - **成立マッチチャット (7章の拡張)**: 個人の Discord ID は露出させない方針。成立ごとに
>   試合ページ `/custom/board/{matchId}` (両チームメンバーのみ閲覧可のチャット+ロビーコード送信) を用意し、
>   Discord 通知は「試合ページへのリンク」を案内する。チームは任意で公開連絡先
>   (`scrim_team_prefs.public_contact`、サーバー招待リンク等) を設定できる

---

## 1. 目的とスコープ

### 解決したい課題
日本の CoD シーンでは交流戦の相手探しが Discord での告知任せになっており、
「今日20時から4人空いてます」を流して運で当たるのを待つ状態。これを在庫マッチングに変える。

### v1 のスコープ
- メンバー個人の空き時間入力（20:00–25:00、30分刻み、10スロット）
- チーム単位の集計（4人以上揃った枠のみ募集として公開）
- 全チームの空き枠を一覧するボード UI
- モード選択（ハーポ回し / サーチ / オバロ）と所要時間の枠数換算（→ 5.2）
- 相手チームの開始可能セルをクリックして対戦を成立させる
- 成立時に両チームの Discord へ通知

### v1 に**含めない**もの（意図的に外す）
- レート表示・受付レンジ（→ 6章。参加チームが20〜30を超えてから）
- レート変動（この機能は完全に unrated。既存の rated マッチとは独立）
- 当日以外の日付（v1は当日のみ。曜日テンプレは v1.1）
- 試合結果の記録

**v1 で検証したいのは「そもそもユーザーが予定を入力し続けるか」の一点。**
ここが失敗すれば他の設計は全部無駄になるので、機能を増やさず最短で出す。

---

## 2. ドメインモデル

```
member_availability  … 個人が入れる空き（入力の一次データ）
      ↓ 集計（4人以上）
team_open_slots      … チームの募集枠（view）
      ↓ 連続枠を結合
run                  … 「21:00–23:00 空き」という連続した募集単位
      ↓ 相手が選択
scrim_matches        … 成立した対戦
```

### 用語
- **スロット (slot)**: 30分の最小単位。`slot_index` 0〜9 が 20:00〜24:30（開始時刻）に対応。終端は 25:00
- **活動日 (date)**: 「その晩」の単位。24:00〜25:00 の枠もカレンダー上は翌日だが前日の date に属する。
  時刻表記は UI 全体で 30時間制（24:00 / 24:30）に統一し、「0:00」とは書かない
- **ラン (run)**: 4人以上が連続しているスロットの連なり。募集の表示単位
- **成立 (match)**: 2チーム間で確定した対戦

---

## 3. スキーマ

```sql
-- 個人の空き入力
create table member_availability (
  user_id     uuid not null references auth.users(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  date        date not null,
  slot_index  smallint not null check (slot_index between 0 and 9),
  created_at  timestamptz not null default now(),
  primary key (user_id, team_id, date, slot_index)
);

create index on member_availability (team_id, date);

-- 成立した対戦
create table scrim_matches (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  slot_start     smallint not null check (slot_start between 0 and 9),
  slot_end       smallint not null check (slot_end between 0 and 10), -- 排他的上限
  host_team_id   uuid not null references teams(id),
  guest_team_id  uuid not null references teams(id),
  format         text not null
                 check (format in ('hardpoint_rotation','search_destroy','overload')),
  map_count      smallint,  -- サーチ / オバロのみ。ハーポ回しは null
  status         text not null default 'confirmed'
                 check (status in ('confirmed','completed','cancelled','no_show')),
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  check (host_team_id <> guest_team_id),
  check (slot_end > slot_start)
);

-- その日に受けられるモード（ホスト側の宣言。行がなければ全部OK扱い）
create table scrim_day_prefs (
  team_id           uuid not null references teams(id) on delete cascade,
  date              date not null,
  accept_hardpoint  boolean not null default true,
  accept_snd        boolean not null default true,
  accept_overload   boolean not null default true,
  primary key (team_id, date)
);

-- モードごとの所要時間設定（運用しながら実測で調整するため外出し）
create table scrim_formats (
  format          text primary key,
  minutes_per_map smallint,        -- ハーポ回しは null（固定枠数を使う）
  fixed_slots     smallint         -- ハーポ回し = 3
);
```

### 集計 view

```sql
create view team_open_slots as
select
  team_id,
  date,
  slot_index,
  count(*) as available
from member_availability
group by team_id, date, slot_index
having count(*) >= 4;
```

チーム数が増えて重くなったら materialized view + トリガ更新に切り替える。
v1 の規模（数十チーム）では通常の view で十分。

---

## 4. 競合制御（重要）

同じ枠に2チームが同時に「対戦する」を押すケースは必ず起きる。
DB のユニーク制約で弾く。**アプリ側のチェックだけでは防げない。**

```sql
-- 1チーム1スロットにつき有効な対戦は1件まで
create unique index scrim_slot_lock_host on scrim_matches (host_team_id, date, slot_start)
  where status = 'confirmed';
create unique index scrim_slot_lock_guest on scrim_matches (guest_team_id, date, slot_start)
  where status = 'confirmed';
```

複数スロットにまたがる成立は、スロットごとに1行ずつではなく1行で持つ設計にしているため、
上の制約は `slot_start` しか見ていない。**重なりの完全な排他には exclusion constraint が必要:**

```sql
create extension if not exists btree_gist;

alter table scrim_matches add constraint scrim_no_overlap_host
  exclude using gist (
    host_team_id with =,
    date with =,
    int4range(slot_start, slot_end) with &&
  ) where (status = 'confirmed');
-- guest_team_id 側にも同じものを張る
```

成立処理は RPC（Postgres function）にまとめてトランザクション内で実行する。
クライアントから2回 insert する構成にはしない。

```
create_scrim_match(p_host_team, p_guest_team, p_date, p_slot_start, p_format, p_map_count)
  1. p_format と p_map_count から所要枠数を算出し slot_end を決定
     （slot_end はクライアントから受け取らない。長さの偽装を防ぐ）
  2. ホストの scrim_day_prefs が p_format を受け付けているか検証
  3. 両チームが当該レンジ全枠で4人以上いるか再検証（クライアントの値を信用しない）
  4. insert scrim_matches
  5. 制約違反(23505 / 23P01)なら 'slot_taken' を返す
```

UI 側は `slot_taken` を受けたら「他チームが先に成立しました」を表示してボードを再取得。

---

## 5. UI 仕様

プロトタイプ: `ascent-scrim-board.html`（**8枠・24:00終端の旧版**。モードフィルタも未実装。
空き表示・ラン結合・競合時の挙動の確認用として参照し、枠数・終端・ダイアログはこの章を正とする）

### 5.1 表示スタイル（確定）

「空き時間を全部表示」と「スタート可能時間を表示」は二者択一にしない。
**基底レイヤーは空き表示。モードフィルタを選ぶと、そのモードで開始できるセルに
マーカーが乗る2層構造**とする。

- 純粋なスタート可能時間表示は不採用。モードが3つある以上「どのモードの開始時刻か」を
  決めないとグリッドが描けず、モード未選択のデフォルト表示が成立しない。
  また開始時刻だけでは「何時まで空いているか」が消え、モード変更や延長の交渉材料が失われる
- 純粋な空き表示のみも不採用。所要時間が入りきらない尻のセルをクリックして
  「時間が足りません」で行き止まりになる操作が構造的に発生する

**デフォルトのフィルタは「ハーポ回し」**（「すべて」ではない）。基本形式なので、
開いた瞬間に最頻用途で押せる状態にする。「すべて」は俯瞰用として残す。

### 5.2 モードと所要時間

30分スロットを最小単位とし、全モードを枠数に換算する。DB・競合制御への影響はない。

| モード | 時間 | 枠数 |
|---|---|---|
| ハーポ回し | 90分 固定 | 3 |
| サーチ | 約30分 × マップ数（仮置き） | マップ数 2/3/4 → 2/3/4 |
| オバロ | 約25分 × マップ数（仮置き） | ceil(25×maps/30) → 2/3/4 |

per-map の分数は仮の値。`scrim_formats` テーブルに外出しし、運用実測で
コード変更なしに調整できるようにする。サーチ / オバロ選択時はフィルタ直下に
マップ数チップを表示（デフォルト 3）。

### 5.3 セルの状態（デザイナー向け・確定）

情報は2軸で直交させる。**人数の厚みは塗りとボーダー、開始可否はマーカーとハッチ**で
表現し、互いに混ぜない。

| 軸 | 状態 | 表現 |
|---|---|---|
| 厚み | 人数不足（<4） | 沈んだ背景、操作不可 |
| 厚み | 4人ちょうど | 破線ボーダー（1人抜けたら崩れることを示す） |
| 厚み | 5人以上 | 実線ボーダー、明るい |
| 開始可否 | 開始可 | ▶ マーカー。クリックで成立フローへ |
| 開始可否 | 空きはあるが入りきらない | 斜線ハッチ。クリックで直前の開始可能セルにスナップ（v1では非活性でも可） |
| — | 成立済み | アンバー塗り、操作不可 |

開始可の判定: セル位置 s から所要 n 枠が同一ラン内に収まり、かつ終了が 25:00 を
超えないこと。ランは「4人以上が連続する区間」なので、ラン内に収まれば全枠で人数条件は
自動的に満たされる。ハーポ回し（3枠）の最終開始は 23:30。

「空きはあるが一戦もできない」チーム（例: 2枠しか空きがなく90分が入らない）は
消さずに全セル斜線で残す。「30分ずれれば入る」という調整余地を可視化するため。

補足: 枠ごとの4人は同一メンバーである必要はない（途中交代を許容）。
スロット単位で4人以上いれば成立とみなす。交代前提の運用が実態に合っている。

### 5.4 ホスト側のモード希望

応募側がモードを一方的に決めると「サーチは受けたくないのに成立した」が起きる。
承認ステップを挟むと即時成立の良さが消えるため、**ホストが日単位で受けられるモードを
チェックボックスで宣言**する（`scrim_day_prefs`、デフォルト全部ON、未設定=全部OK）。

受け付けないモードのフィルタ選択中は、そのチームの行を暗転させる。
消さない（レートの受付レンジと同じ「暗くするが消さない」ルール）。

### 5.5 ダイアログ

▶ セルをクリックした時点でモード・マップ数・開始時刻・所要枠数がすべて確定しているため、
ダイアログは確認に徹する: 相手情報（帯・実績）・時間レンジ・成立ボタンのみ。
旧プロトタイプの「長さを選ぶ」チップは廃止（モードフィルタに吸収）。

### 5.6 その他の画面要素
- **自分の空き入力**: 10個のトグルチップ。押した瞬間にローカル state を更新し、debounce して upsert。
  スマホでは 5列 × 2行に折り返す
- **ボードの横幅**: 10列になるためスマホでは横スクロール前提。チーム名列を sticky にして
  スクロール中も行の識別を保つ
- **ラン強調**: セルにホバーすると、連続した募集枠が一括でハイライトされる
- **現在時刻ライン**: グリッド上を縦断する縦線
- 自チーム行は左端にアクセントバー

### 実装上の注意
- プロトタイプはグリッド全体を毎回再描画しているが、**本実装では Supabase Realtime で
  `scrim_matches` の INSERT のみ購読し、該当セルだけ差分更新する**。
  全チームの availability を毎回引き直すとチーム数に比例して重くなる
- `member_availability` は自チーム分だけリアルタイム購読すれば足りる
- 他チームの availability はポーリング（30〜60秒）で十分

---

## 6. レート表示（v2、v1では実装しない）

参加チームが20〜30を超えた段階で追加する。設計方針だけ残しておく。

- **チーム固定のレートは持たない。** その枠に空いているメンバーのレートを集計する。
  セルは既に誰が空いているかを知っているので追加テーブル不要
- **生の数値ではなくティア帯で表示する。** 数値を出すと unrated のはずのボードが
  事実上のラダーになる。既存 rated のランク帯をそのまま流用し、レート語彙を2つ作らない
- **平均に加えて「幅」を出す。** 4v4 では1人の極端な格下が平均以上に試合を壊すため。
  ただし個人名は出さない（晒しになる）
- **ハードフィルタは使わない。** 枠を出す側が受付条件を選び、範囲外でも申請自体は送れる。
  日本の CoD 人口規模で全体ルールを入れるとマッチが消える
- **未計測チームの扱いを最初から入れる。** 実績ゼロのチームが弾かれると新規が入れず成長が止まる。
  受付条件のデフォルトは「誰でも歓迎 / 未計測OK」にする

```sql
create table scrim_slot_prefs (
  team_id        uuid not null references teams(id) on delete cascade,
  date           date not null,
  slot_index     smallint not null,
  accept_range   text not null default 'any' check (accept_range in ('any','similar')),
  accept_unrated boolean not null default true,
  primary key (team_id, date, slot_index)
);
```

---

## 7. 通知

Discord 一択。すでに Discord OAuth が動いているので provider_id は取得済みのはず。

- **DM ではなく webhook。** DM を閉じているユーザーが多く到達率が低い
- チーム登録時（または設定画面）に通知先チャンネルの webhook URL を登録してもらう
- 送信は Edge Function 経由。webhook URL をクライアントに露出させない
- 送信失敗時もマッチ成立自体は成功扱いにする（通知はベストエフォート）

通知内容: 相手チーム名 / 日時レンジ / ASCENT の該当ページへのリンク

---

## 8. 入力コスト対策（v1.1 で必ず入れる）

**この機能の最大のリスクは「誰も予定を入力しなくなること」。**
毎日8スロット×人数を手入力する運用は続かず、3日で空のボードになる。

優先度順:
1. **曜日テンプレ** — 「毎週火・木は21:00–24:00」を一度設定して自動反映
2. **Discord bot** — `/空き 21-24` の一行で入力完了。ASCENT に来なくても済むようにする
3. **リーダー代理入力** — メンバー分をまとめて入力。初期は現実的にこれが主流になる

---

## 9. ノーショー対策

成立後のドタキャンは必ず起きる。v1 では機能として作らなくてよいが、
**テーブルの status に `no_show` / `cancelled` を最初から入れておく**（3章で対応済み）。

v1.1 以降で、チームの無断キャンセル回数を相手から見える形で表示する。
rated レートへの連動は当面しない。

---

## 10. 未決事項（実装前に確認）

- [ ] ASCENT の既存 `teams` / `team_members` テーブルの構造。上記 DDL は `teams(id)` を仮定している
- [ ] 空き入力の権限。メンバー全員が自分の分を入れられるか、リーダーのみか
- [ ] 対戦成立を押せるのは誰か（リーダーのみ / メンバー全員）。誤爆を考えるとリーダー限定が無難
- [ ] 成立後のキャンセル手段。v1 では手動対応でもよいが UI に導線が要るか
- [ ] 1チームが同時間帯に複数の対戦を持てないのは確定。**別時間帯の複数成立は許可する**想定でよいか
- [x] ~~タイムゾーン・日跨ぎ~~ → **解決。** `date` は活動日（その晩）を表し、24時以降の枠も
      前日の date に属する。JST 固定。実時刻への変換は `date 20:00 JST + 30分 × slot_index`
- [x] ~~ボードの終端~~ → **25:00 に決定。** 10枠（slot_index 0〜9）。
      ハーポ回しの最終開始は 23:30 となり、入口は10枠中8枠。時刻表記は 30時間制で統一
- [ ] サーチ / オバロの per-map 所要分数の実測値（現状は 30分 / 25分 の仮置き）
- [ ] 斜線セルのスナップ挙動（クリックで直前の開始可能セルへ）を v1 に入れるか、非活性で済ますか

---

## 11. 実装順序（推奨）

1. `member_availability` テーブルと RLS ポリシー
2. 空き入力 UI（自チームのみ、ボードなし）
3. `team_open_slots` view とボードの読み取り専用表示
4. `create_scrim_match` RPC と競合制約
5. 対戦成立 UI とダイアログ
6. Discord 通知（Edge Function）
7. Realtime 購読による差分更新

3 までできた時点で一度クローズドで使ってもらい、入力が続くかを見る。
