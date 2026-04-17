CREATE OR REPLACE FUNCTION public.rpc_get_games_played_ranking(
  p_season_id uuid DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  games_played bigint,
  wins bigint,
  losses bigint,
  win_rate numeric,
  current_rating integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    mtm.user_id,
    p.display_name,
    count(*) AS games_played,
    count(*) FILTER (WHERE m.winner_match_team_id = mtm.match_team_id) AS wins,
    count(*) FILTER (WHERE m.loser_match_team_id = mtm.match_team_id) AS losses,
    ROUND(
      CASE WHEN count(*) > 0
        THEN count(*) FILTER (WHERE m.winner_match_team_id = mtm.match_team_id) * 100.0 / count(*)
        ELSE 0
      END, 1
    ) AS win_rate,
    p.current_rating
  FROM match_team_members mtm
  JOIN match_teams mt ON mt.id = mtm.match_team_id
  JOIN matches m ON m.id = mt.match_id AND m.status = 'completed'
  JOIN profiles p ON p.id = mtm.user_id
  LEFT JOIN seasons s ON p_season_id IS NOT NULL
    AND s.id = p_season_id
  WHERE p.is_banned = false
    AND (p_season_id IS NULL
      OR (m.completed_at >= s.start_date::timestamptz
          AND m.completed_at < (s.end_date::date + 1)::timestamptz))
  GROUP BY mtm.user_id, p.display_name, p.current_rating
  ORDER BY games_played DESC, wins DESC
  LIMIT 100;
$$;
