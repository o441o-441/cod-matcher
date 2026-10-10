-- ============================================================
-- 大会実績 (優勝・準優勝) の永続化
--
-- 大会が completed になった瞬間 (どのRPC経由でも) にトリガーで
-- tournament_achievements へ記録する。
--   placement 1 = 優勝 (winner_info.entry_id)
--   placement 2 = 準優勝 (優勝エントリーが最後に勝った試合の敗者。
--                 ブラケット試合が無いリーグ戦は league_standings の2位)
-- メンバー展開は _tournament_entry_user_ids (チーム=スナップショット、
-- 個人=自動編成チームの全員) を使用。
-- あわせて winner_info に 'name' を補完する (大会一覧のCHAMPION表示用)。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tournament_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  entry_id uuid,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  placement integer NOT NULL CHECK (placement BETWEEN 1 AND 8),
  team_label text,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id, placement)
);

CREATE INDEX IF NOT EXISTS idx_tournament_achievements_user ON public.tournament_achievements (user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_achievements_team ON public.tournament_achievements (team_id) WHERE team_id IS NOT NULL;

ALTER TABLE public.tournament_achievements ENABLE ROW LEVEL SECURITY;

-- 実績は公開情報 (プロフィール/チームページで誰でも閲覧可)。書き込みはトリガーのみ。
DROP POLICY IF EXISTS tournament_achievements_select_all ON public.tournament_achievements;
CREATE POLICY tournament_achievements_select_all ON public.tournament_achievements
  FOR SELECT USING (true);

-- ------------------------------------------------------------
-- 記録ヘルパー: 1エントリー分の実績を全メンバーに記録
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_record_achievement(
  p_tournament_id uuid,
  p_entry_id uuid,
  p_placement integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_entry record;
  v_label text;
BEGIN
  IF p_entry_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_entry FROM tournament_entries WHERE id = p_entry_id;
  IF v_entry IS NULL THEN RETURN; END IF;
  v_label := _tournament_entry_label(p_entry_id);

  INSERT INTO tournament_achievements (tournament_id, entry_id, user_id, team_id, placement, team_label)
  SELECT p_tournament_id, p_entry_id, u, v_entry.team_id, p_placement, v_label
  FROM unnest(_tournament_entry_user_ids(p_entry_id)) AS u
  WHERE u IS NOT NULL
  ON CONFLICT (tournament_id, user_id, placement) DO NOTHING;
END;
$$;

-- ------------------------------------------------------------
-- 完了トリガー: 優勝・準優勝を記録 + winner_info.name を補完
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_record_tournament_achievements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_champion uuid;
  v_runner uuid;
  v_label text;
BEGIN
  -- completed への遷移時のみ (winner_info.name 補完の再UPDATEでは再発火しない)
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  v_champion := (NEW.winner_info->>'entry_id')::uuid;
  IF v_champion IS NULL THEN RETURN NEW; END IF;

  BEGIN
    -- 準優勝: 優勝エントリーが最後に勝った試合の敗者
    SELECT loser_entry_id INTO v_runner
    FROM tournament_matches
    WHERE tournament_id = NEW.id AND winner_entry_id = v_champion AND status = 'completed'
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1;

    -- ブラケット試合が無い場合 (リーグ戦のみ) は league_standings の2位
    IF v_runner IS NULL THEN
      SELECT entry_id INTO v_runner
      FROM league_standings
      WHERE tournament_id = NEW.id AND entry_id <> v_champion
      ORDER BY points DESC, (rounds_won - rounds_lost) DESC
      LIMIT 1;
    END IF;

    PERFORM _tournament_record_achievement(NEW.id, v_champion, 1);
    IF v_runner IS NOT NULL AND v_runner <> v_champion THEN
      PERFORM _tournament_record_achievement(NEW.id, v_runner, 2);
    END IF;

    -- 大会一覧の CHAMPION バッジ用に優勝者名を補完
    IF NEW.winner_info->>'name' IS NULL THEN
      v_label := _tournament_entry_label(v_champion);
      UPDATE tournaments SET winner_info = NEW.winner_info || jsonb_build_object('name', v_label)
      WHERE id = NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- 実績記録の失敗で大会完了を妨げない
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_tournament_achievements ON public.tournaments;
CREATE TRIGGER trg_record_tournament_achievements
  AFTER UPDATE ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_record_tournament_achievements();
