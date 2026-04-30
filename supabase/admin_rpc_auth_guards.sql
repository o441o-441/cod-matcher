-- ============================================================
-- Admin RPC Authorization Guards
-- Apply this migration to add is_admin checks to all admin RPCs.
-- Run via Supabase Dashboard → SQL Editor.
-- ============================================================

-- Helper: reusable admin check block (copy into each function)
-- IF NOT EXISTS (
--   SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
-- ) THEN
--   RAISE EXCEPTION 'unauthorized: admin access required';
-- END IF;

-- ============================================================
-- rpc_admin_ban_user
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_ban_user(
  p_user_id uuid,
  p_reason text DEFAULT '',
  p_duration_days int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  INSERT INTO public.suspensions (user_id, reason, suspended_until, created_by)
  VALUES (
    p_user_id,
    p_reason,
    CASE WHEN p_duration_days IS NOT NULL
      THEN now() + (p_duration_days || ' days')::interval
      ELSE NULL  -- permanent
    END,
    auth.uid()
  );
end;
$$;

-- ============================================================
-- rpc_admin_set_user_role
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_set_user_role(
  p_user_id uuid,
  p_is_admin boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  UPDATE public.profiles SET is_admin = p_is_admin WHERE id = p_user_id;
end;
$$;

-- ============================================================
-- rpc_admin_lift_suspension
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_lift_suspension(
  p_suspension_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  DELETE FROM public.suspensions WHERE id = p_suspension_id;
end;
$$;

-- ============================================================
-- rpc_admin_list_reports
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_list_reports(
  p_status text DEFAULT 'pending',
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS SETOF public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  RETURN QUERY
    SELECT * FROM public.reports
    WHERE (p_status IS NULL OR status = p_status)
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset;
end;
$$;

-- ============================================================
-- rpc_admin_update_report
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_update_report(
  p_report_id uuid,
  p_status text,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  UPDATE public.reports
  SET status = p_status,
      admin_note = COALESCE(p_admin_note, admin_note),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_report_id;
end;
$$;

-- ============================================================
-- rpc_admin_ban_by_report
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_ban_by_report(
  p_report_id uuid,
  p_duration_days int DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_id uuid;
  v_reason text;
begin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: admin access required';
  END IF;

  SELECT reported_user_id, reason INTO v_target_id, v_reason
  FROM public.reports WHERE id = p_report_id;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  INSERT INTO public.suspensions (user_id, reason, suspended_until, created_by)
  VALUES (
    v_target_id,
    v_reason,
    CASE WHEN p_duration_days IS NOT NULL
      THEN now() + (p_duration_days || ' days')::interval
      ELSE NULL
    END,
    auth.uid()
  );

  UPDATE public.reports SET status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;

  RETURN json_build_object('banned_user_id', v_target_id);
end;
$$;
