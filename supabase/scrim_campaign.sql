-- ============================================================
-- 交流戦キャンペーンの集計・抽選 (2026-11-02)
--
-- 「期間中、毎週N回以上交流戦をしたチームから抽選でM チームに賞品」
-- 型のキャンペーン用。初回: 11/6〜11/27・週2回以上・5チーム・2万円。
--
-- 週の区切り: 開始日から7日ごと。端数日は最終週に含める
--   (11/6〜11/27 = 22日 → 11/6-12 / 11/13-19 / 11/20-27 の3週)。
-- 対象試合: scrim_matches.status='confirmed' (キャンセル除外) で
--   チーム枠 (host_team_id / guest_team_id) として参加したもの。
--   混成ルーム側の参加はチームではないため対象外。
-- 対象チーム: 全週でN回以上 かつ 解散していないチーム。
--
-- 抽選結果は campaign_draws に保存 (履歴が残る。再抽選しても上書き
-- されず追記される = 監査可能)。RPCはすべて管理者のみ。
-- UI: /admin/campaign
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaign_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  weekly_required int NOT NULL,
  winners_count int NOT NULL,
  eligible jsonb NOT NULL DEFAULT '[]'::jsonb,
  winners jsonb NOT NULL DEFAULT '[]'::jsonb,
  drawn_by uuid,
  drawn_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_draws ENABLE ROW LEVEL SECURITY;
-- ポリシーなし = RPC (SECURITY DEFINER) 経由でのみ読み書き

-- ------------------------------------------------------------
-- 内部: 管理者チェック
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._campaign_require_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION '管理者のみ実行できます';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 内部: 週別集計 (weeks: 期間の週区切り / teams: チームごとの週別回数)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._scrim_campaign_stats(p_start date, p_end date, p_weekly int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days int := p_end - p_start + 1;
  v_weeks int;
  v_week_ranges jsonb;
  v_teams jsonb;
BEGIN
  IF p_end < p_start THEN RAISE EXCEPTION '期間が不正です'; END IF;
  v_weeks := greatest(1, v_days / 7); -- 端数日は最終週へ

  SELECT jsonb_agg(jsonb_build_object(
    'start', (p_start + w * 7)::text,
    'end', (CASE WHEN w = v_weeks - 1 THEN p_end ELSE p_start + w * 7 + 6 END)::text
  ) ORDER BY w)
  INTO v_week_ranges
  FROM generate_series(0, v_weeks - 1) AS w;

  WITH participation AS (
    SELECT side.team_id,
           least((m.date - p_start) / 7, v_weeks - 1) AS w
    FROM scrim_matches m
    CROSS JOIN LATERAL (VALUES (m.host_team_id), (m.guest_team_id)) AS side(team_id)
    WHERE m.status = 'confirmed'
      AND m.date BETWEEN p_start AND p_end
      AND side.team_id IS NOT NULL
  ),
  counts AS (
    SELECT team_id, w, count(*)::int AS c FROM participation GROUP BY team_id, w
  ),
  per_team AS (
    SELECT t.team_id,
           array_agg(coalesce(c.c, 0) ORDER BY gs.w) AS weekly,
           sum(coalesce(c.c, 0))::int AS total,
           bool_and(coalesce(c.c, 0) >= p_weekly) AS meets_weekly
    FROM (SELECT DISTINCT team_id FROM participation) t
    CROSS JOIN generate_series(0, v_weeks - 1) AS gs(w)
    LEFT JOIN counts c ON c.team_id = t.team_id AND c.w = gs.w
    GROUP BY t.team_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'team_id', pt.team_id,
    'name', coalesce(tm.name, '(削除済み)'),
    'roster_mode', coalesce(tm.roster_mode, 'members'),
    'disbanded', coalesce(tm.is_disbanded, true),
    'weekly', to_jsonb(pt.weekly),
    'total', pt.total,
    'eligible', pt.meets_weekly AND NOT coalesce(tm.is_disbanded, true)
  ) ORDER BY (pt.meets_weekly AND NOT coalesce(tm.is_disbanded, true)) DESC, pt.total DESC, tm.name)
  INTO v_teams
  FROM per_team pt
  LEFT JOIN teams tm ON tm.id = pt.team_id;

  RETURN jsonb_build_object(
    'start', p_start::text,
    'end', p_end::text,
    'weekly_required', p_weekly,
    'weeks', coalesce(v_week_ranges, '[]'::jsonb),
    'teams', coalesce(v_teams, '[]'::jsonb)
  );
END;
$$;

-- ------------------------------------------------------------
-- 集計 (管理者のみ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_campaign_stats(p_start date, p_end date, p_weekly int DEFAULT 2)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM _campaign_require_admin();
  RETURN _scrim_campaign_stats(p_start, p_end, p_weekly);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_scrim_campaign_stats(date, date, int) TO authenticated;

-- ------------------------------------------------------------
-- 抽選 (管理者のみ)。対象チームから無作為に p_winners チームを選び、
-- 結果を campaign_draws に保存して返す
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_campaign_draw(
  p_campaign text,
  p_start date,
  p_end date,
  p_weekly int DEFAULT 2,
  p_winners int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stats jsonb;
  v_eligible jsonb;
  v_winners jsonb;
  v_id uuid;
BEGIN
  PERFORM _campaign_require_admin();
  IF p_winners < 1 THEN RAISE EXCEPTION '当選チーム数が不正です'; END IF;

  v_stats := _scrim_campaign_stats(p_start, p_end, p_weekly);

  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_eligible
  FROM jsonb_array_elements(v_stats->'teams') AS t
  WHERE (t->>'eligible')::boolean;

  IF jsonb_array_length(v_eligible) = 0 THEN
    RAISE EXCEPTION '条件を満たすチームがありません';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('team_id', t->>'team_id', 'name', t->>'name')), '[]'::jsonb)
  INTO v_winners
  FROM (
    SELECT t FROM jsonb_array_elements(v_eligible) AS t
    ORDER BY random()
    LIMIT p_winners
  ) s;

  INSERT INTO campaign_draws (campaign, period_start, period_end, weekly_required, winners_count, eligible, winners, drawn_by)
  VALUES (p_campaign, p_start, p_end, p_weekly, p_winners, v_eligible, v_winners, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'draw_id', v_id,
    'eligible_count', jsonb_array_length(v_eligible),
    'winners', v_winners
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_scrim_campaign_draw(text, date, date, int, int) TO authenticated;

-- ------------------------------------------------------------
-- 抽選履歴 (管理者のみ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_scrim_campaign_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM _campaign_require_admin();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'campaign', d.campaign,
    'period_start', d.period_start::text,
    'period_end', d.period_end::text,
    'weekly_required', d.weekly_required,
    'winners_count', d.winners_count,
    'eligible_count', jsonb_array_length(d.eligible),
    'winners', d.winners,
    'drawn_at', d.drawn_at,
    'drawn_by_name', (SELECT display_name FROM profiles WHERE id = d.drawn_by)
  ) ORDER BY d.drawn_at DESC), '[]'::jsonb)
  INTO v
  FROM campaign_draws d;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_scrim_campaign_history() TO authenticated;
