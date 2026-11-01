-- ============================================================
-- ゲームモード改名: オーバーロード (OVL) → ハイジャック (2026-11-01)
--
-- タイトルアップデートで OVL が廃止されハイジャックに置き換わったため、
-- ユーザー向け表示をすべて「ハイジャック」に変更する。
-- 内部キーは互換性のため 'ovl' のまま (DB列: ovl_maps / accept_ovl、
-- scrim_formats.format='ovl'、tournament の selected_mode='ovl' 等)。
--
-- 同時変更 (フロント):
--   - 大会/ランクマのバンピックのマッププールを全モード5マップに統一
--     (シルクウォーム・ミューニション・リアクター・ルーフトップ・ロータス)
--   - 各所の「オバロ/オーバーロード/OVERLOAD」表示 → ハイジャック
--   - scoreboard-parse (EdgeFn) のモード判定プロンプト
--
-- 本ファイルは以下を上書きする:
--   - _scrimboard_format_label (旧: 本番DBのみ。'オバロ' 表記だった)
--   - rpc_scrimboard_confirm のエラー文言は team_roster_modes.sql 側を
--     修正して再適用済み ('オバロ' → 'ハイジャック')
-- ============================================================

CREATE OR REPLACE FUNCTION public._scrimboard_format_label(p_hp integer, p_snd integer, p_ovl integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  select case
    when p_hp = 6 and p_snd = 0 and p_ovl = 0 then 'ハーポ回し'
    else array_to_string(array_remove(array[
      case when p_hp  > 0 then 'ハーポ' || p_hp end,
      case when p_snd > 0 then 'サーチ' || p_snd end,
      case when p_ovl > 0 then 'ハイジャック' || p_ovl end
    ], null), ' + ')
  end
$$;
