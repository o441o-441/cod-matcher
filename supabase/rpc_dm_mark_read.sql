-- ============================================================
-- DM既読化RPC
--
-- バグ修正: direct_messages には UPDATE の RLS ポリシーが無く、
-- DMページの is_read 更新が 0行更新で静かに失敗していた
-- (未読バッジが消えない)。
-- 受信者に行UPDATE権限を与えると受信メッセージの本文改ざんが
-- 可能になるため、既読化だけを行う専用RPCで対応する。
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_dm_mark_read(p_partner_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  UPDATE direct_messages
  SET is_read = true
  WHERE sender_user_id = p_partner_id
    AND receiver_user_id = v_uid
    AND is_read = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'marked', v_count);
END;
$$;
