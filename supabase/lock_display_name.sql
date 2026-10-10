-- ============================================================
-- 表示名の変更禁止
--
-- 登録完了 (is_onboarded) 後は profiles.display_name を変更不可にする。
-- 名前の付け替えで別人になりすます/誰だか分からなくなるのを防ぐ。
-- 例外: 管理者 (profiles.is_admin) と、auth.uid() が無いサーバー側
-- 処理 (運用スクリプト・service role) は変更可能。
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_lock_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name AND OLD.is_onboarded THEN
    -- サーバー側処理 (service role / 運用SQL) は許可
    IF v_uid IS NULL THEN RETURN NEW; END IF;
    -- 管理者は許可 (なりすまし対応等の運用のため)
    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin) THEN RETURN NEW; END IF;
    RAISE EXCEPTION '表示名は登録後に変更できません';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_display_name ON public.profiles;
CREATE TRIGGER trg_lock_display_name
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_lock_display_name();
