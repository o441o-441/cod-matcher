"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { useParams, useRouter } from "next/navigation";

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

type BanpickSessionRow = {
  id: string;
  match_id: string;
  status: "pending" | "in_progress" | "completed" | "timeout" | "cancelled";
  phase:
    | "mode1_ban"
    | "mode1_pick"
    | "mode2_ban"
    | "mode2_pick"
    | "mode3_ban"
    | "mode3_pick"
    | "completed";
  current_turn_match_team_id: string | null;
  current_action_type: "ban" | "pick" | "side_pick" | null;
  turn_number: number;
  selected_maps: Json;
  banned_maps: Json;
  side_choices: Json;
};

type BanpickActionRow = {
  id: string;
  banpick_session_id: string;
  match_id: string;
  actor_user_id: string;
  actor_match_team_id: string;
  turn_number: number;
  phase: string;
  action_type: "ban" | "pick" | "side_pick" | "auto_timeout";
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

const MAP_OPTIONS = [
  "Hacienda",
  "Exposure",
  "Vault",
  "Protocol",
  "Skyline",
  "Rewind",
  "Derelict",
  "Red Card",
];

const SIDE_OPTIONS = ["JSOC", "ギルド"];

function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Supabase env is missing");
  }

  return createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

function asStringArray(v: Json): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function phaseLabel(phase: BanpickSessionRow["phase"] | string) {
  switch (phase) {
    case "mode1_ban":
      return "モード1 BAN";
    case "mode1_pick":
      return "モード1 PICK";
    case "mode2_ban":
      return "モード2 BAN";
    case "mode2_pick":
      return "モード2 PICK";
    case "mode3_ban":
      return "モード3 BAN";
    case "mode3_pick":
      return "モード3 PICK";
    case "completed":
      return "完了";
    default:
      return phase;
  }
}

function actionTypeLabel(actionType: string | null) {
  switch (actionType) {
    case "ban":
      return "BAN";
    case "pick":
      return "PICK";
    case "side_pick":
      return "サイド選択";
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

  const [supabase] = useState(() => getSupabaseClient());

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

  const [banpickTarget, setBanpickTarget] = useState("");
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

  const selectedMaps = useMemo(() => asStringArray(session?.selected_maps ?? []), [session]);
  const bannedMaps = useMemo(() => asStringArray(session?.banned_maps ?? []), [session]);
  const sideChoices = useMemo(() => asStringArray(session?.side_choices ?? []), [session]);

  const actionOptions = useMemo(() => {
    if (session?.current_action_type === "side_pick") {
      return SIDE_OPTIONS;
    }
    return MAP_OPTIONS;
  }, [session?.current_action_type]);

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

  const loadAll = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
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
            .select("id,match_id,status,phase,current_turn_match_team_id,current_action_type,turn_number,selected_maps,banned_maps,side_choices")
            .eq("match_id", matchId)
            .maybeSingle<BanpickSessionRow>(),
          supabase
            .from("banpick_actions")
            .select("id,banpick_session_id,match_id,actor_user_id,actor_match_team_id,turn_number,phase,action_type,target,created_at,profiles!banpick_actions_actor_user_id_fkey(id,display_name)")
            .eq("match_id", matchId)
            .order("created_at", { ascending: true })
            .returns<BanpickActionRow[]>(),
          supabase
            .from("match_messages")
            .select("id,match_id,sender_user_id,message_type,body,created_at,profiles!match_messages_sender_user_id_fkey(id,display_name)")
            .eq("match_id", matchId)
            .order("created_at", { ascending: true })
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
      setLoading(false);
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
        () => void loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banpick_sessions", filter: `match_id=eq.${matchId}` },
        () => void loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banpick_actions", filter: `match_id=eq.${matchId}` },
        () => void loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_messages", filter: `match_id=eq.${matchId}` },
        () => void loadAll()
      )
      .subscribe((status) => {
        console.log("banpick realtime status:", status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, loadAll, supabase]);

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

  const handleSubmitBanpickAction = async () => {
    if (!matchId || !session) return;
    clearMessages();

    const target = banpickTarget.trim();
    if (!target) {
      setErrorText("対象を入力または選択してください。");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_submit_banpick_action", {
        p_match_id: matchId,
        p_action_type: session.current_action_type,
        p_target: target,
      });

      if (error) throw error;

      setBanpickTarget("");
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
              <h2 className="mb-3 text-lg font-semibold">バンピック操作</h2>

              {!session ? (
                <div className="text-sm text-white/60">まだバンピックは開始されていません。</div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded bg-black/20 p-3 text-sm">
                    <div>フェーズ: {phaseLabel(session.phase)}</div>
                    <div className="mt-1">操作: {actionTypeLabel(session.current_action_type)}</div>
                    <div className="mt-1">
                      手番:{" "}
                      {currentTurnTeam
                        ? `${currentTurnTeam.side.toUpperCase()} (${currentTurnTeam.display_name ?? currentTurnTeam.side})`
                        : "-"}
                    </div>
                    <div className="mt-1">
                      あなたの状態: {isMyTurn ? "あなたのチームの手番です" : "相手チームの手番です"}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded bg-black/20 p-3">
                      <div className="mb-2 text-sm font-semibold">BAN済み</div>
                      <div className="space-y-1 text-sm text-white/80">
                        {bannedMaps.length === 0 ? <div className="text-white/40">なし</div> : bannedMaps.map((x, i) => <div key={`${x}-${i}`}>{x}</div>)}
                      </div>
                    </div>

                    <div className="rounded bg-black/20 p-3">
                      <div className="mb-2 text-sm font-semibold">PICK済み</div>
                      <div className="space-y-1 text-sm text-white/80">
                        {selectedMaps.length === 0 ? <div className="text-white/40">なし</div> : selectedMaps.map((x, i) => <div key={`${x}-${i}`}>{x}</div>)}
                      </div>
                    </div>

                    <div className="rounded bg-black/20 p-3">
                      <div className="mb-2 text-sm font-semibold">サイド選択</div>
                      <div className="space-y-1 text-sm text-white/80">
                        {sideChoices.length === 0 ? <div className="text-white/40">なし</div> : sideChoices.map((x, i) => <div key={`${x}-${i}`}>{x}</div>)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 text-sm font-semibold">
                      {session.status === "completed" ? "バンピック完了" : "現在の操作を送信"}
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      {actionOptions.map((option) => {
                        const active = banpickTarget === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setBanpickTarget(option)}
                            className={`rounded px-3 py-2 text-sm ${
                              active ? "bg-white text-black" : "border border-white/20 bg-transparent text-white"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mb-3">
                      <input
                        value={banpickTarget}
                        onChange={(e) => setBanpickTarget(e.target.value)}
                        placeholder="対象を直接入力してもOK"
                        className="w-full rounded border border-white/15 bg-neutral-900 px-3 py-2 text-sm outline-none"
                        disabled={busy || !isMyTurn || session.status !== "in_progress"}
                      />
                    </div>

                    <button
                      onClick={handleSubmitBanpickAction}
                      disabled={busy || !isMyTurn || session.status !== "in_progress"}
                      className="rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      {session.current_action_type ? `${actionTypeLabel(session.current_action_type)} を送信` : "送信"}
                    </button>
                  </div>
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
                        <div className="break-words whitespace-pre-wrap">{msg.body}</div>
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