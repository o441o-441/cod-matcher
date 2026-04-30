-- =============================================================
-- Anti-Smurf / Sub-Account Detection
-- =============================================================

-- 1. profiles に Discord アカウント作成日カラムを追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discord_account_created_at timestamptz;

-- 2. IP ログテーブル
CREATE TABLE IF NOT EXISTS public.user_ip_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id),
  ip_address inet NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_user_ip_log_ip ON public.user_ip_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_user_ip_log_user ON public.user_ip_log(user_id);

ALTER TABLE public.user_ip_log ENABLE ROW LEVEL SECURITY;
-- クライアントから直接アクセス不可（SECURITY DEFINER RPC 経由のみ）

-- 3. フィンガープリントテーブル
CREATE TABLE IF NOT EXISTS public.user_fingerprints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id),
  fingerprint_hash text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_fingerprints_hash ON public.user_fingerprints(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_user_fingerprints_user ON public.user_fingerprints(user_id);

ALTER TABLE public.user_fingerprints ENABLE ROW LEVEL SECURITY;

-- 4. セキュリティフラグテーブル
CREATE TABLE IF NOT EXISTS public.security_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  flag_type       text NOT NULL,      -- 'young_discord', 'activision_reuse', 'ip_match', 'fingerprint_match'
  severity        text NOT NULL DEFAULT 'warning',  -- 'warning', 'block'
  detail          text,
  matched_user_id uuid,               -- BAN 済ユーザーの ID
  resolved        boolean NOT NULL DEFAULT false,
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, flag_type, matched_user_id)
);

CREATE INDEX IF NOT EXISTS idx_security_flags_user ON public.security_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_security_flags_unresolved ON public.security_flags(resolved) WHERE resolved = false;

ALTER TABLE public.security_flags ENABLE ROW LEVEL SECURITY;

-- 管理者のみ SELECT 可
CREATE POLICY security_flags_select_admin ON public.security_flags
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- =============================================================
-- RPC: rpc_log_security_event
-- ログイン時に IP / フィンガープリント / Discord 年齢を記録し、BAN 済ユーザーと照合
-- =============================================================
CREATE OR REPLACE FUNCTION public.rpc_log_security_event(
  p_ip_address    inet,
  p_fingerprint_hash text DEFAULT NULL,
  p_discord_created_at timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_min_age_days int := 30;
  v_banned_match record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- 1. IP を記録
  INSERT INTO public.user_ip_log (user_id, ip_address)
  VALUES (v_user_id, p_ip_address)
  ON CONFLICT (user_id, ip_address) DO NOTHING;

  -- 2. IP を BAN 済ユーザーと照合
  FOR v_banned_match IN
    SELECT DISTINCT uil.user_id AS banned_user_id, p2.display_name
    FROM public.user_ip_log uil
    JOIN public.profiles p2 ON p2.id = uil.user_id
    WHERE uil.ip_address = p_ip_address
      AND uil.user_id != v_user_id
      AND p2.is_banned = true
  LOOP
    INSERT INTO public.security_flags (user_id, flag_type, severity, detail, matched_user_id)
    VALUES (v_user_id, 'ip_match', 'warning',
      'IP一致: ' || p_ip_address::text || ' (BAN済: ' || COALESCE(v_banned_match.display_name, '不明') || ')',
      v_banned_match.banned_user_id)
    ON CONFLICT (user_id, flag_type, matched_user_id) DO NOTHING;
  END LOOP;

  -- 3. フィンガープリントを記録 & 照合
  IF p_fingerprint_hash IS NOT NULL AND p_fingerprint_hash != '' THEN
    INSERT INTO public.user_fingerprints (user_id, fingerprint_hash)
    VALUES (v_user_id, p_fingerprint_hash)
    ON CONFLICT (user_id, fingerprint_hash) DO NOTHING;

    FOR v_banned_match IN
      SELECT DISTINCT uf.user_id AS banned_user_id, p2.display_name
      FROM public.user_fingerprints uf
      JOIN public.profiles p2 ON p2.id = uf.user_id
      WHERE uf.fingerprint_hash = p_fingerprint_hash
        AND uf.user_id != v_user_id
        AND p2.is_banned = true
    LOOP
      INSERT INTO public.security_flags (user_id, flag_type, severity, detail, matched_user_id)
      VALUES (v_user_id, 'fingerprint_match', 'warning',
        'ブラウザフィンガープリント一致 (BAN済: ' || COALESCE(v_banned_match.display_name, '不明') || ')',
        v_banned_match.banned_user_id)
      ON CONFLICT (user_id, flag_type, matched_user_id) DO NOTHING;
    END LOOP;
  END IF;

  -- 4. Discord アカウント年齢チェック
  IF p_discord_created_at IS NOT NULL THEN
    UPDATE public.profiles
    SET discord_account_created_at = p_discord_created_at
    WHERE id = v_user_id;

    IF p_discord_created_at > (now() - (v_min_age_days || ' days')::interval) THEN
      INSERT INTO public.security_flags (user_id, flag_type, severity, detail)
      VALUES (v_user_id, 'young_discord', 'warning',
        'Discordアカウント作成日: ' || p_discord_created_at::date::text || ' (' || v_min_age_days || '日未満)')
      ON CONFLICT (user_id, flag_type, matched_user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

-- =============================================================
-- RPC: rpc_check_activision_reuse
-- Activision ID が BAN 済ユーザーと一致するかチェック
-- =============================================================
CREATE OR REPLACE FUNCTION public.rpc_check_activision_reuse(
  p_activision_id text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_banned record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_activision_id IS NULL OR p_activision_id = '' THEN
    RETURN json_build_object('blocked', false);
  END IF;

  FOR v_banned IN
    SELECT u.auth_user_id, p.display_name
    FROM public.users u
    JOIN public.profiles p ON p.id = u.auth_user_id
    WHERE LOWER(u.activision_id) = LOWER(p_activision_id)
      AND u.auth_user_id != v_user_id
      AND p.is_banned = true
  LOOP
    INSERT INTO public.security_flags (user_id, flag_type, severity, detail, matched_user_id)
    VALUES (v_user_id, 'activision_reuse', 'block',
      'BAN済ユーザーと同一のActivision ID: ' || p_activision_id,
      v_banned.auth_user_id)
    ON CONFLICT (user_id, flag_type, matched_user_id) DO NOTHING;

    RETURN json_build_object('blocked', true, 'reason', 'このActivision IDは使用できません');
  END LOOP;

  RETURN json_build_object('blocked', false);
END;
$$;

-- =============================================================
-- RPC: rpc_admin_resolve_flag
-- 管理者がセキュリティフラグを解決済みにする
-- =============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_flag(
  p_flag_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  UPDATE public.security_flags
  SET resolved = true, resolved_by = auth.uid(), resolved_at = now()
  WHERE id = p_flag_id;
END;
$$;
