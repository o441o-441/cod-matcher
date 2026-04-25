CREATE OR REPLACE FUNCTION public.rpc_increment_view_count(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE posts
  SET view_count = view_count + 1
  WHERE id = p_post_id;
END;
$$;
