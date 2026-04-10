"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

type MatchRow = {
  id: string;
  status: string;
  host_user_id: string | null;
  host_match_team_id: string | null;
  host_selected_at: string | null;
  lobby_code: string | null;
  lobby_code_set_by_user_id: string | null;
  lobby_code_set_at: string | null;
  winner_match_team_id: string | null;
  loser_match_team_id: string | null;
};

type MatchTeamRow = {
  id: string;
  match_id: string;
  side: "alpha" | "bravo";
  display_name: string | null;
  captain_user_id: string | null;
  party_composition: string | null;
  base_avg_rating: number;
  synergy_bonus: number;
  effective_avg_rating: number;
  is_full_party: boolean;
};

type MatchTeamMemberRow = {
  id: string;
  match_team_id: string;
  user_id: string;
  is_party_leader: boolean;
  joined_as_party_size: number | null;
  rating_before: number;
  profiles?: {
    id: string;
    display_name: string;
  } | null;
};

type BanpickPhase = "hp" | "snd" | "ovl" | "completed";
type BanpickActionType = "ban" | "pick_map" | "pick_side";

type PhaseState = {
  bans: string[];
  map: string | null;
  side: string | null;
};

type BanpickSessionRow = {
  id: string;
  match_id: string;
  status: "pending" | "in_progress" | "completed" | "timeout" | "cancelled";
  phase: BanpickPhase;
  current_turn_match_team_id: string | null;
  current_action_type: BanpickActionType | null;
  turn_number: number;
  selected_maps: Json;
  deadline_at: string | null;
};

type BanpickActionRow = {
  id: string;
  banpick_session_id: string;
  match_id: string;
  actor_user_id: string;
  actor_match_team_id: string;
  turn_number: number;
  phase: string;
  action_type: "ban" | "pick_map" | "pick_side" | "auto_timeout";
  target: string;
  created_at: string;
  profiles?: {
    id: string;
    display_name: string;
  } | null;
};

type MatchMessageRow = {
  id: string;
  match_id: string;
  sender_user_id: string | null;
  message_type: "text" | "lobby_code" | "system";
  body: string;
  created_at: string;
  profiles?: {
    id: string;
    display_name: string;
  } | null;
};

const PHASE_POOLS: Record<"hp" | "snd" | "ovl", string[]> = {
  hp: ["ブラックハート", "コロッサス", "デン", "エクスポージャー", "スカー"],
  snd: ["コロッサス", "デン", "エクスポージャー", "レイド", "スカー"],
  ovl: ["デン", "エクスポージャー", "スカー"],
};

const PHASE_LABEL: Record<BanpickPhase, string> = {
  hp: "Phase 1 ハードポイント",
  snd: "Phase 2 サーチ&デストロイ",
  ovl: "Phase 3 オーバーロード",
  completed: "バンピック完了",
};

const SIDE_OPTIONS = ["JSOC", "ギルド"];

function parsePhaseState(
  selected: Json,
  phase: "hp" | "snd" | "ovl"
): PhaseState {
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    return { bans: [], map: null, side: null };
  }
  const node = (selected as Record<string, Json>)[phase];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { bans: [], map: null, side: null };
  }
  const obj = node as Record<string, Json>;
  const bansRaw = obj.bans;
  const bans = Array.isArray(bansRaw)
    ? bansRaw.filter((x): x is string => typeof x === "string")
    : [];
  const map = typeof obj.map === "string" ? obj.map : null;
  const side = typeof obj.side === "string" ? obj.side : null;
  return { bans, map, side };
}

function parseTeamAssignment(selected: Json): { teamA: string | null; teamB: string | null } {
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    return { teamA: null, teamB: null };
  }
  const obj = selected as Record<string, Json>;
  const teamA = typeof obj.team_a === "string" ? obj.team_a : null;
  const teamB = typeof obj.team_b === "string" ? obj.team_b : null;
  return { teamA, teamB };
}

function phaseLabel(phase: BanpickPhase | string) {
  if (phase === "hp" || phase === "snd" || phase === "ovl" || phase === "completed") {
    return PHASE_LABEL[phase];
  }
  return phase;
}

const MESSAGE_JA: Record<string, string> = {
  "banpick completed": "バンピックが完了しました。ホストを決定してください。",
  "banpick timeout: action side lost": "バンピック制限時間を超過したため、操作側の敗北として処理されました。",
  "match report submitted": "試合結果を申請しました。相手チームは確認して承認してください。",
  "match report approved": "試合結果を承認しました。レートが更新されました。",
  "match report rejected": "試合結果申請を却下しました。再申請してください。",
  "auto-confirmed as dispute (2nd reject)": "却下が連続したため申請通りの結果で自動確定しました。異議がある場合は相手を通報してください。",
  "report auto-approved after timeout": "承認期限を超過したため自動承認されました。レートが更新されました。",
};

function translateBody(body: string): string {
  return MESSAGE_JA[body] ?? body;
}

function actionTypeLabel(actionType: string | null) {
  switch (actionType) {
    case "ban":
      return "BAN";
    case "pick_map":
      return "マップ PICK";
    case "pick_side":
      return "サイド PICK";
    default:
      return "-";
  }
}

function messageTypeLabel(messageType: MatchMessageRow["message_type"]) {
  switch (messageType) {
    case "system":
      return "SYSTEM";
    case "lobby_code":
      return "LOBBY";
    default:
      return "CHAT";
  }
}

export default function BanpickPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const matchId = params?.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [infoText, setInfoText] = useState<string | null>(null);

  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [teams, setTeams] = useState<MatchTeamRow[]>([]);
  const [members, setMembers] = useState<MatchTeamMemberRow[]>([]);
  const [session, setSession] = useState<BanpickSessionRow | null>(null);
  const [actions, setActions] = useState<BanpickActionRow[]>([]);
  const [messages, setMessages] = useState<MatchMessageRow[]>([]);

  const [chatInput, setChatInput] = useState("");
  const [lobbyCodeInput, setLobbyCodeInput] = useState("");

  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const myMember = useMemo(
    () => members.find((m) => m.user_id === myUserId) ?? null,
    [members, myUserId]
  );

  const myMatchTeamId = myMember?.match_team_id ?? null;

  const alphaTeam = useMemo(() => teams.find((t) => t.side === "alpha") ?? null, [teams]);
  const bravoTeam = useMemo(() => teams.find((t) => t.side === "bravo") ?? null, [teams]);

  const currentTurnTeam = useMemo(() => {
    if (!session?.current_turn_match_team_id) return null;
    return teams.find((t) => t.id === session.current_turn_match_team_id) ?? null;
  }, [session, teams]);

  const isMyTurn = !!session?.current_turn_match_team_id && session.current_turn_match_team_id === myMatchTeamId;
  const isBanpickCompleted = session?.status === "completed" || match?.status === "ready" || match?.status === "report_pending" || match?.status === "completed";
  const isHost = !!match?.host_user_id && match.host_user_id === myUserId;

  const phaseStates = useMemo(() => {
    return {
      hp: parsePhaseState(session?.selected_maps ?? null, "hp"),
      snd: parsePhaseState(session?.selected_maps ?? null, "snd"),
      ovl: parsePhaseState(session?.selected_maps ?? null, "ovl"),
    };
  }, [session?.selected_maps]);

  const teamAssignment = useMemo(
    () => parseTeamAssignment(session?.selected_maps ?? null),
    [session?.selected_maps]
  );

  const myTeamLetter: "A" | "B" | null = useMemo(() => {
    if (!myMatchTeamId) return null;
    if (myMatchTeamId === teamAssignment.teamA) return "A";
    if (myMatchTeamId === teamAssignment.teamB) return "B";
    return null;
  }, [myMatchTeamId, teamAssignment]);

  const currentTeamLetter: "A" | "B" | null = useMemo(() => {
    if (!session?.current_turn_match_team_id) return null;
    if (session.current_turn_match_team_id === teamAssignment.teamA) return "A";
    if (session.current_turn_match_team_id === teamAssignment.teamB) return "B";
    return null;
  }, [session?.current_turn_match_team_id, teamAssignment]);

  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    if (!session?.deadline_at || session.status !== "in_progress") {
      setRemainingSec(null);
      return;
    }
    const deadline = new Date(session.deadline_at).getTime();
    const tick = () => {
      const diff = Math.floor((deadline - Date.now()) / 1000);
      setRemainingSec(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.deadline_at, session?.status]);

  useEffect(() => {
    if (remainingSec === null) return;
    if (remainingSec > 0) return;
    if (!matchId) return;
    if (session?.status !== "in_progress") return;
    void (async () => {
      try {
        await supabase.rpc("rpc_resolve_banpick_timeout", { p_match_id: matchId });
      } catch (e) {
        console.error("resolve timeout error:", e);
      }
    })();
  }, [remainingSec, matchId, session?.status, supabase]);

  const hostDisplayName = useMemo(() => {
    if (!match?.host_user_id) return null;
    return members.find((m) => m.user_id === match.host_user_id)?.profiles?.display_name ?? null;
  }, [match?.host_user_id, members]);

  const groupedMembers = useMemo(() => {
    return {
      alpha: members.filter((m) => m.match_team_id === alphaTeam?.id),
      bravo: members.filter((m) => m.match_team_id === bravoTeam?.id),
    };
  }, [members, alphaTeam?.id, bravoTeam?.id]);

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!matchId) return;
    if (!opts?.silent) {
      setLoading(true);
    }
    setErrorText(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      setMyUserId(user?.id ?? null);

      const [{ data: matchData, error: matchError }, { data: teamsData, error: teamsError }, { data: membersData, error: membersError }, { data: sessionData, error: sessionError }, { data: actionsData, error: actionsError }, { data: messagesData, error: messagesError }] =
        await Promise.all([
          supabase
            .from("matches")
            .select("id,status,host_user_id,host_match_team_id,host_selected_at,lobby_code,lobby_code_set_by_user_id,lobby_code_set_at,winner_match_team_id,loser_match_team_id")
            .eq("id", matchId)
            .maybeSingle<MatchRow>(),
          supabase
            .from("match_teams")
            .select("id,match_id,side,display_name,captain_user_id,party_composition,base_avg_rating,synergy_bonus,effective_avg_rating,is_full_party")
            .eq("match_id", matchId)
            .returns<MatchTeamRow[]>(),
          supabase
            .from("match_team_members")
            .select("id,match_team_id,user_id,is_party_leader,joined_as_party_size,rating_before,profiles!match_team_members_user_id_fkey(id,display_name)")
            .in(
              "match_team_id",
              (
                (await supabase
                  .from("match_teams")
                  .select("id")
                  .eq("match_id", matchId)) as { data: { id: string }[] | null }
              ).data?.map((t) => t.id) ?? ["00000000-0000-0000-0000-000000000000"]
            )
            .returns<MatchTeamMemberRow[]>(),
          supabase
            .from("banpick_sessions")
            .select("id,match_id,status,phase,current_turn_match_team_id,current_action_type,turn_number,selected_maps,deadline_at")
            .eq("match_id", matchId)
            .maybeSingle<BanpickSessionRow>(),
          supabase
            .from("banpick_actions")
            .select("id,banpick_session_id,match_id,actor_user_id,actor_match_team_id,turn_number,phase,action_type,target,created_at,profiles!banpick_actions_actor_user_id_fkey(id,display_name)")
            .eq("match_id", matchId)
            .order("created_at", { ascending: false })
            .returns<BanpickActionRow[]>(),
          supabase
            .from("match_messages")
            .select("id,match_id,sender_user_id,message_type,body,created_at,profiles!match_messages_sender_user_id_fkey(id,display_name)")
            .eq("match_id", matchId)
            .order("created_at", { ascending: false })
            .returns<MatchMessageRow[]>(),
        ]);

      if (matchError) throw matchError;
      if (teamsError) throw teamsError;
      if (membersError) throw membersError;
      if (sessionError) throw sessionError;
      if (actionsError) throw actionsError;
      if (messagesError) throw messagesError;

      setMatch(matchData ?? null);
      setTeams(teamsData ?? []);
      setMembers(membersData ?? []);
      setSession(sessionData ?? null);
      setActions(actionsData ?? []);
      setMessages(messagesData ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "読み込みに失敗しました。";
      setErrorText(message);
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }, [matchId, supabase]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!matchId) return;

    const channel = supabase
      .channel(`banpick-room-${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => {
          console.log("banpick realtime event:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banpick_sessions", filter: `match_id=eq.${matchId}` },
        (payload) => {
          console.log("banpick realtime event:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banpick_actions", filter: `match_id=eq.${matchId}` },
        (payload) => {
          console.log("banpick realtime event:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          console.log("banpick realtime event:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .subscribe((status) => {
        console.log("banpick realtime status:", status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);


  const clearMessages = () => {
    setErrorText(null);
    setInfoText(null);
  };

  const handleCreateBanpickSession = async () => {
    if (!matchId) return;
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_create_banpick_session", {
        p_match_id: matchId,
      });

      if (error) throw error;

      setInfoText("バンピックを開始しました。");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "バンピック開始に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitBanpickActionWith = async (target: string) => {
    if (!matchId || !session) return;
    clearMessages();

    const trimmed = target.trim();
    if (!trimmed) {
      setErrorText("対象を選択してください。");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_submit_banpick_action", {
        p_match_id: matchId,
        p_action_type: session.current_action_type,
        p_target: trimmed,
      });

      if (error) throw error;

      setInfoText("バンピックを更新しました。");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "バンピック送信に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSelectHost = async () => {
    if (!matchId) return;
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_select_match_host", {
        p_match_id: matchId,
      });

      if (error) throw error;

      setInfoText("ホストを決定しました。");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "ホスト決定に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendLobbyCode = async () => {
    if (!matchId) return;
    clearMessages();

    const code = lobbyCodeInput.trim();
    if (!code) {
      setErrorText("ロビーコードを入力してください。");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_send_lobby_code", {
        p_match_id: matchId,
        p_lobby_code: code,
      });

      if (error) throw error;

      setLobbyCodeInput("");
      setInfoText("ロビーコードを送信しました。");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "ロビーコード送信に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendChat = async () => {
    if (!matchId) return;
    clearMessages();

    const body = chatInput.trim();
    if (!body) {
      setErrorText("メッセージを入力してください。");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_send_match_message", {
        p_match_id: matchId,
        p_body: body,
      });

      if (error) throw error;

      setChatInput("");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "メッセージ送信に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  if (!matchId) {
    return <div className="p-6 text-sm text-red-400">match id が見つかりません。</div>;
  }

  if (loading) {
    return <div className="p-6 text-sm text-white">読み込み中です...</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">ASCENT バンピック</h1>
            <p className="mt-1 text-sm text-white/60">Match ID: {matchId}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push("/rules")}
              className="rounded border border-white/20 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            >
              ルール一覧
            </button>

            {!session && (
              <button
                onClick={handleCreateBanpickSession}
                disabled={busy}
                className="rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
              >
                バンピック開始
              </button>
            )}

            {isBanpickCompleted && !match?.host_user_id && (
              <button
                onClick={handleSelectHost}
                disabled={busy}
                className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                ホスト決定
              </button>
            )}

            {isBanpickCompleted && (
              <button
                onClick={() => router.push(`/match/${matchId}/report`)}
                className="rounded bg-cyan-500 px-4 py-2 text-sm font-semibold text-white"
              >
                試合結果を報告する
              </button>
            )}

            <button
              onClick={() => void loadAll()}
              disabled={busy}
              className="rounded border border-white/20 px-4 py-2 text-sm text-white/90 disabled:opacity-50"
            >
              再読み込み
            </button>
          </div>
        </div>

        {errorText && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {errorText}
          </div>
        )}

        {infoText && (
          <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {infoText}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">試合情報</h2>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">試合状態</div>
                  <div className="mt-1 text-sm font-medium">{match?.status ?? "-"}</div>
                </div>

                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">現在フェーズ</div>
                  <div className="mt-1 text-sm font-medium">{session ? phaseLabel(session.phase) : "-"}</div>
                </div>

                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">現在の操作</div>
                  <div className="mt-1 text-sm font-medium">
                    {session ? actionTypeLabel(session.current_action_type) : "-"}
                  </div>
                </div>

                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">現在の手番</div>
                  <div className="mt-1 text-sm font-medium">
                    {currentTurnTeam
                      ? `${currentTurnTeam.side.toUpperCase()} (${currentTurnTeam.display_name ?? currentTurnTeam.side})`
                      : "-"}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">チーム構成</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">ALPHA</div>
                    <div className="text-xs text-white/60">{alphaTeam?.party_composition ?? "-"}</div>
                  </div>

                  <div className="mb-3 text-xs text-white/60">
                    平均: {alphaTeam?.base_avg_rating ?? "-"} / 補正: +{alphaTeam?.synergy_bonus ?? 0} / 実効:{" "}
                    {alphaTeam?.effective_avg_rating ?? "-"}
                  </div>

                  <div className="space-y-2">
                    {groupedMembers.alpha.map((m) => (
                      <div key={m.id} className="rounded bg-white/5 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => router.push(`/users/${m.user_id}?match=${matchId}`)}
                            className="text-left text-cyan-300 underline decoration-dotted hover:text-white"
                          >
                            {m.profiles?.display_name ?? m.user_id}
                          </button>
                          <div className="flex gap-2 text-[11px] text-white/50">
                            {m.is_party_leader && <span>Leader</span>}
                            {match?.host_user_id === m.user_id && <span>Host</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">BRAVO</div>
                    <div className="text-xs text-white/60">{bravoTeam?.party_composition ?? "-"}</div>
                  </div>

                  <div className="mb-3 text-xs text-white/60">
                    平均: {bravoTeam?.base_avg_rating ?? "-"} / 補正: +{bravoTeam?.synergy_bonus ?? 0} / 実効:{" "}
                    {bravoTeam?.effective_avg_rating ?? "-"}
                  </div>

                  <div className="space-y-2">
                    {groupedMembers.bravo.map((m) => (
                      <div key={m.id} className="rounded bg-white/5 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => router.push(`/users/${m.user_id}?match=${matchId}`)}
                            className="text-left text-cyan-300 underline decoration-dotted hover:text-white"
                          >
                            {m.profiles?.display_name ?? m.user_id}
                          </button>
                          <div className="flex gap-2 text-[11px] text-white/50">
                            {m.is_party_leader && <span>Leader</span>}
                            {match?.host_user_id === m.user_id && <span>Host</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">バンピック</h2>

              {!session ? (
                <div className="text-sm text-white/60">まだバンピックは開始されていません。</div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded bg-black/20 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">{phaseLabel(session.phase)}</div>
                        <div className="mt-1 text-white/60">
                          手番:{" "}
                          {currentTeamLetter
                            ? `Team ${currentTeamLetter}`
                            : session.status === "completed" || session.status === "timeout"
                            ? "-"
                            : "?"}{" "}
                          / 操作: {actionTypeLabel(session.current_action_type)}
                        </div>
                        <div className="mt-1 text-white/60">
                          あなたの所属: {myTeamLetter ? `Team ${myTeamLetter}` : "観戦"}
                          {" / "}
                          {isMyTurn ? "あなたの操作待ち" : "相手の操作待ち"}
                        </div>
                      </div>
                      {remainingSec !== null && session.status === "in_progress" && (
                        <div className="text-right">
                          <div className="text-xs text-white/50">残り時間</div>
                          <div
                            className={`text-2xl font-bold ${
                              remainingSec <= 30 ? "text-red-400" : "text-white"
                            }`}
                          >
                            {remainingSec > 0
                              ? `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`
                              : "0:00"}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {(["hp", "snd", "ovl"] as const).map((phaseKey) => {
                    const state = phaseStates[phaseKey];
                    const pool = PHASE_POOLS[phaseKey];
                    const isCurrent = session.phase === phaseKey;
                    const allowInteraction =
                      isCurrent &&
                      isMyTurn &&
                      session.status === "in_progress" &&
                      session.current_action_type !== null;

                    return (
                      <div
                        key={phaseKey}
                        className={`rounded border p-4 ${
                          isCurrent ? "border-cyan-400/60 bg-cyan-500/5" : "border-white/10 bg-black/20"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="font-semibold">
                            {phaseKey === "hp" && "Phase 1 / HARDPOINT"}
                            {phaseKey === "snd" && "Phase 2 / SEARCH & DESTROY"}
                            {phaseKey === "ovl" && "Phase 3 / OVERLOAD"}
                          </div>
                          {isCurrent && (
                            <span className="rounded bg-cyan-500/30 px-2 py-0.5 text-xs text-cyan-100">
                              進行中
                            </span>
                          )}
                        </div>

                        <div className="mb-3 flex flex-wrap gap-2">
                          {pool.map((mapName) => {
                            const banned = state.bans.includes(mapName);
                            const picked = state.map === mapName;
                            const canClickAsMapAction =
                              allowInteraction &&
                              (session.current_action_type === "ban" ||
                                session.current_action_type === "pick_map") &&
                              !banned &&
                              state.map === null;

                            return (
                              <button
                                key={mapName}
                                type="button"
                                disabled={busy || !canClickAsMapAction}
                                onClick={() => {
                                  if (!canClickAsMapAction) return;
                                  void handleSubmitBanpickActionWith(mapName);
                                }}
                                className={`rounded px-3 py-2 text-sm transition ${
                                  picked
                                    ? "bg-emerald-500/30 text-emerald-100 border border-emerald-400"
                                    : banned
                                    ? "bg-red-500/10 text-red-300 line-through border border-red-500/30"
                                    : canClickAsMapAction
                                    ? "border border-white/30 bg-white/5 hover:bg-white/10"
                                    : "border border-white/10 bg-white/5 text-white/40"
                                }`}
                              >
                                {mapName}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
                          <div>
                            Map: <span className="text-white">{state.map ?? "-"}</span>
                          </div>
                          <div>
                            Side: <span className="text-white">{state.side ?? "-"}</span>
                          </div>
                        </div>

                        {isCurrent &&
                          session.current_action_type === "pick_side" &&
                          allowInteraction && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {SIDE_OPTIONS.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    void handleSubmitBanpickActionWith(s);
                                  }}
                                  className="rounded border border-white/30 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">バンピック履歴</h2>

              <div className="space-y-2">
                {actions.length === 0 ? (
                  <div className="text-sm text-white/50">まだ履歴はありません。</div>
                ) : (
                  actions.map((action) => (
                    <div key={action.id} className="rounded bg-black/20 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          Turn {action.turn_number} / {phaseLabel(action.phase)}
                        </div>
                        <div className="text-white/50">{new Date(action.created_at).toLocaleString()}</div>
                      </div>
                      <div className="mt-1">
                        {action.profiles?.display_name ?? action.actor_user_id} が{" "}
                        <span className="font-semibold">{actionTypeLabel(action.action_type)}</span> : {action.target}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">ホスト / ロビー</h2>

              <div className="space-y-3">
                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">現在のホスト</div>
                  <div className="mt-1 text-sm font-medium">{hostDisplayName ?? "未決定"}</div>
                </div>

                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">現在のロビーコード</div>
                  <div className="mt-1 break-all text-sm font-medium">{match?.lobby_code ?? "未設定"}</div>
                  {match?.lobby_code_set_at && (
                    <div className="mt-1 text-[11px] text-white/40">
                      更新: {new Date(match.lobby_code_set_at).toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 text-sm font-semibold">ロビーコード送信</div>
                  <input
                    value={lobbyCodeInput}
                    onChange={(e) => setLobbyCodeInput(e.target.value)}
                    placeholder={isHost ? "例: ABCD-1234" : "ホストのみ送信可能"}
                    className="mb-2 w-full rounded border border-white/15 bg-neutral-900 px-3 py-2 text-sm outline-none"
                    disabled={busy || !isHost}
                  />
                  <button
                    onClick={handleSendLobbyCode}
                    disabled={busy || !isHost}
                    className="w-full rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    ロビーコード送信
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">試合チャット</h2>

              <div className="mb-3 h-[420px] overflow-y-auto rounded border border-white/10 bg-black/20 p-3">
                <div className="space-y-2">
                  {messages.length === 0 ? (
                    <div className="text-sm text-white/50">まだメッセージはありません。</div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`rounded px-3 py-2 text-sm ${
                          msg.message_type === "system"
                            ? "bg-white/5 text-white/70"
                            : msg.message_type === "lobby_code"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "bg-white/10 text-white"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] opacity-70">
                          <span>
                            [{messageTypeLabel(msg.message_type)}]{" "}
                            {msg.profiles?.display_name ?? (msg.sender_user_id ? msg.sender_user_id : "system")}
                          </span>
                          <span>{new Date(msg.created_at).toLocaleString()}</span>
                        </div>
                        <div className="break-words whitespace-pre-wrap">{translateBody(msg.body)}</div>
                      </div>
                    ))
                  )}
                  <div ref={chatBottomRef} />
                </div>
              </div>

              <div className="space-y-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="メッセージを入力"
                  rows={4}
                  maxLength={300}
                  className="w-full rounded border border-white/15 bg-neutral-900 px-3 py-2 text-sm outline-none"
                  disabled={busy}
                />
                <button
                  onClick={handleSendChat}
                  disabled={busy}
                  className="w-full rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  メッセージ送信
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}