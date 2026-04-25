"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { playBanpickAction, playChatReceive, playHostNotify } from "@/lib/sounds";

function useSoundOnChange<T>(value: T, soundFn: () => void) {
  const prevRef = useRef<T>(value);
  const initialRef = useRef(true);
  useEffect(() => {
    if (initialRef.current) {
      initialRef.current = false;
      prevRef.current = value;
      return;
    }
    if (value !== prevRef.current) {
      soundFn();
      prevRef.current = value;
    }
  }, [value, soundFn]);
}
import { Tutorial } from "@/components/Tutorial";
import { LoadingSkeleton } from "@/components/UIState";
import TimerRing from "@/components/TimerRing";
import MapThumb from "@/components/MapThumb";

const BANPICK_TUTORIAL = [
  { title: "バンピックとは", body: "試合で使うマップとサイドを交互に選ぶフェーズです。3つのモード（HP / SND / OVL）それぞれでBAN → PICK → サイド選択を行います。" },
  { title: "BAN", body: "マップを1つ選んで除外します。BANされたマップには取り消し線が付き、PICKできなくなります。" },
  { title: "PICK", body: "残りのマップから試合で使うマップを選びます。選ばれたマップはハイライト表示されます。" },
  { title: "サイド選択", body: "マップが決まったら、JSOC / ギルド のどちらのサイドでプレイするか選びます。" },
  { title: "制限時間", body: "各ステップには5分の制限時間があります。時間切れの場合、操作すべきだった側の敗北になります。" },
  { title: "ホスト決定", body: "バンピック完了後、自動でパーティリーダーの中からランダムにホストが決定されます。何らかの理由でホストを持てない場合は、チャット欄で他のプレイヤーと相談してホストを決めてください。" },
  { title: "トロフィー選択", body: "ホストが決定したら3分以内にトロフィー使用者を選択してください。制限時間に達した場合、選択していない方の敗北となります。どちらも選択していない場合は無効試合となり、レートが-10されます。" },
];

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
  trophy_users: string[];
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
  hp: ["酒", "コロッサス", "デン", "スカー", "グリッドロック"],
  snd: ["プラザ", "デン", "グリッドロック", "レイド", "スカー", "フリンジ"],
  ovl: ["デン", "エクスポージャー", "スカー"],
};

const PHASE_LABEL: Record<BanpickPhase, string> = {
  hp: "Phase 1 ハードポイント",
  snd: "Phase 2 サーチ&デストロイ",
  ovl: "Phase 3 オーバーロード",
  completed: "バンピック完了",
};

const PHASE_SHORT: Record<"hp" | "snd" | "ovl", string> = {
  hp: "HP",
  snd: "SND",
  ovl: "OVL",
};

const PHASE_NAME: Record<"hp" | "snd" | "ovl", string> = {
  hp: "ハードポイント",
  snd: "サーチ&デストロイ",
  ovl: "オーバーロード",
};

const SIDE_OPTIONS = ["JSOC", "ギルド"];

const MAP_META: Record<string, { id: string; en: string }> = {
  "酒": { id: "sake", en: "Sake" },
  "コロッサス": { id: "colossus", en: "Colossus" },
  "デン": { id: "den", en: "Den" },

  "スカー": { id: "scar", en: "Scar" },
  "グリッドロック": { id: "gridlock", en: "Gridlock" },
  "プラザ": { id: "plaza", en: "Plaza" },
  "レイド": { id: "raid", en: "Raid" },
  "フリンジ": { id: "fringe", en: "Fringe" },
  "エクスポージャー": { id: "exposure", en: "Exposure" },
};

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
  "match created": "マッチが成立しました。バンピックを開始してください。",
  "all players on report page, deadline shortened to 5 min": "全員が結果報告画面を開きました。承認期限が5分に短縮されました。",
  "match voided after 2 rejections": "却下が連続したため無効試合になりました。レート変動はありません。",
};

function translateBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return MESSAGE_JA[normalized] ?? MESSAGE_JA[body] ?? body;
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

/* ---- SVG icons (inline to avoid extra deps) ---- */
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
);
const IconChat = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
);
const IconUsers = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
);

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
  const [showTrophyPopup, setShowTrophyPopup] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // State 変化で音を鳴らす（realtime でもポーリングでも動作）
  useSoundOnChange(session?.turn_number ?? 0, playBanpickAction);
  useSoundOnChange(messages.length, playChatReceive);
  useSoundOnChange(match?.host_user_id ?? null, playHostNotify);
  useSoundOnChange(match?.lobby_code ?? null, playHostNotify);

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

  const alphaTrophyDone = useMemo(() => {
    const list = Array.isArray(alphaTeam?.trophy_users) ? alphaTeam.trophy_users : [];
    const memberCount = groupedMembers.alpha.length;
    return memberCount <= 2 ? list.length === memberCount : list.length === 2;
  }, [alphaTeam, groupedMembers.alpha]);

  const bravoTrophyDone = useMemo(() => {
    const list = Array.isArray(bravoTeam?.trophy_users) ? bravoTeam.trophy_users : [];
    const memberCount = groupedMembers.bravo.length;
    return memberCount <= 2 ? list.length === memberCount : list.length === 2;
  }, [bravoTeam, groupedMembers.bravo]);

  const allTrophyDone = alphaTrophyDone && bravoTrophyDone;

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!matchId) return;
    if (!opts?.silent) {
      setLoading(true);
    }
    setErrorText(null);

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      setMyUserId(authSession?.user?.id ?? null);

      const { data: teamsForIds } = await supabase
        .from("match_teams")
        .select("id")
        .eq("match_id", matchId);
      const teamIds = (teamsForIds ?? []).map((t: { id: string }) => t.id);

      const [{ data: matchData, error: matchError }, { data: teamsData, error: teamsError }, { data: membersData, error: membersError }, { data: sessionData, error: sessionError }, { data: actionsData, error: actionsError }, { data: messagesData, error: messagesError }] =
        await Promise.all([
          supabase
            .from("matches")
            .select("id,status,host_user_id,host_match_team_id,host_selected_at,lobby_code,lobby_code_set_by_user_id,lobby_code_set_at,winner_match_team_id,loser_match_team_id")
            .eq("id", matchId)
            .maybeSingle<MatchRow>(),
          supabase
            .from("match_teams")
            .select("id,match_id,side,display_name,captain_user_id,party_composition,base_avg_rating,synergy_bonus,effective_avg_rating,is_full_party,trophy_users")
            .eq("match_id", matchId)
            .returns<MatchTeamRow[]>(),
          supabase
            .from("match_team_members")
            .select("id,match_team_id,user_id,is_party_leader,joined_as_party_size,rating_before,profiles!match_team_members_user_id_fkey(id,display_name)")
            .in("match_team_id", teamIds.length > 0 ? teamIds : ["00000000-0000-0000-0000-000000000000"])
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

  // chat auto-scroll disabled

  useEffect(() => {
    if (!matchId) return;

    const channel = supabase
      .channel(`banpick-room-${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => void loadAll({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banpick_sessions", filter: `match_id=eq.${matchId}` },
        () => void loadAll({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banpick_actions", filter: `match_id=eq.${matchId}` },
        () => void loadAll({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_messages", filter: `match_id=eq.${matchId}` },
        () => void loadAll({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_teams", filter: `match_id=eq.${matchId}` },
        () => void loadAll({ silent: true })
      )
      .subscribe((status) => {
        console.log("banpick realtime status:", status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Auto-select host when banpick completes
  const autoHostTriggeredRef = useRef(false);
  useEffect(() => {
    if (!isBanpickCompleted) return;
    if (match?.host_user_id) return;
    if (autoHostTriggeredRef.current) return;
    if (!myMatchTeamId) return;
    // Only the alpha captain triggers auto-host to avoid duplicate calls
    const alphaCaptain = alphaTeam?.captain_user_id;
    if (myUserId !== alphaCaptain) return;
    autoHostTriggeredRef.current = true;
    void (async () => {
      try {
        await supabase.rpc("rpc_select_match_host", { p_match_id: matchId });
        await loadAll({ silent: true });
      } catch (e) {
        console.error("auto host select error:", e);
      }
    })();
  }, [isBanpickCompleted, match?.host_user_id, myUserId, alphaTeam?.captain_user_id, myMatchTeamId, matchId, loadAll]);

  // Show trophy popup when banpick completes
  const trophyPopupShownRef = useRef(false);
  useEffect(() => {
    if (!isBanpickCompleted) return;
    if (allTrophyDone) return;
    if (trophyPopupShownRef.current) return;
    trophyPopupShownRef.current = true;
    setShowTrophyPopup(true);
  }, [isBanpickCompleted, allTrophyDone]);

  // Auto-navigate to confirm page when all trophies are set
  const autoNavTriggeredRef = useRef(false);
  useEffect(() => {
    if (!isBanpickCompleted) return;
    if (!allTrophyDone) return;
    if (autoNavTriggeredRef.current) return;
    autoNavTriggeredRef.current = true;
    router.push(`/match/${matchId}/confirm`);
  }, [isBanpickCompleted, allTrophyDone, matchId, router]);

  // Trophy selection timer (3 min from host selection)
  const [trophyRemainingSec, setTrophyRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    if (!isBanpickCompleted || !match?.host_selected_at || allTrophyDone) {
      setTrophyRemainingSec(null);
      return;
    }
    const deadline = new Date(match.host_selected_at).getTime() + 3 * 60 * 1000;
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
      setTrophyRemainingSec(remaining);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isBanpickCompleted, match?.host_selected_at, allTrophyDone]);

  // Trophy timeout enforcement - any player can trigger, RPC is idempotent
  const trophyTimeoutTriggeredRef = useRef(false);
  useEffect(() => {
    if (trophyRemainingSec !== 0) return;
    if (allTrophyDone) return;
    if (trophyTimeoutTriggeredRef.current) return;
    if (!myUserId) return;
    trophyTimeoutTriggeredRef.current = true;
    void (async () => {
      try {
        await supabase.rpc("rpc_check_trophy_timeout", { p_match_id: matchId });
        await loadAll({ silent: true });
      } catch (e) {
        console.error("trophy timeout check error:", e);
      }
    })();
  }, [trophyRemainingSec, allTrophyDone, myUserId, matchId, loadAll]);

  // Auto-navigate to report page when match is completed by trophy timeout
  const trophyNavRef = useRef(false);
  useEffect(() => {
    if (!match) return;
    if (match.status !== "completed") return;
    if (!isBanpickCompleted) return;
    if (trophyNavRef.current) return;
    // Only navigate if trophy timeout caused the completion (no winner or voided)
    if (autoNavTriggeredRef.current) return; // already navigating to confirm
    trophyNavRef.current = true;
    router.push(`/match/${matchId}/report`);
  }, [match, isBanpickCompleted, matchId, router]);

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

  const handleToggleTrophy = async (userId: string) => {
    if (!matchId) return;
    clearMessages();
    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_toggle_trophy_user", {
        p_match_id: matchId,
        p_user_id: userId,
      });
      if (error) throw error;
      await loadAll({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "トロフィー設定に失敗しました。";
      if (msg.includes("trophy users limit")) {
        setErrorText("トロフィー使用者は各チーム2人までです。");
      } else {
        setErrorText(msg);
      }
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

  /* ---- helpers for phase bar ---- */
  const phaseKeys = ["hp", "snd", "ovl"] as const;
  const currentPhaseIndex = session
    ? session.phase === "completed"
      ? 3
      : phaseKeys.indexOf(session.phase as "hp" | "snd" | "ovl")
    : -1;

  function phaseStatus(pk: "hp" | "snd" | "ovl") {
    const idx = phaseKeys.indexOf(pk);
    if (!session) return "pending" as const;
    if (session.phase === "completed" || idx < currentPhaseIndex) return "done" as const;
    if (idx === currentPhaseIndex) return "active" as const;
    return "pending" as const;
  }

  function phaseStepText(pk: "hp" | "snd" | "ovl") {
    const st = phaseStatus(pk);
    if (st === "done") {
      const ps = phaseStates[pk];
      return `${ps.map ?? "-"} / ${ps.side ?? "-"}`;
    }
    if (st === "active") {
      const turnInPhase = session ? session.turn_number : 0;
      return `STEP ${turnInPhase}/4`;
    }
    return "未着手";
  }

  /* ---- turn card helpers ---- */
  const currentPhase: "hp" | "snd" | "ovl" | null =
    session && session.phase !== "completed" ? (session.phase as "hp" | "snd" | "ovl") : null;
  const currentState = currentPhase ? phaseStates[currentPhase] : null;
  const currentPool = currentPhase ? PHASE_POOLS[currentPhase] : [];
  const allowInteraction =
    !!currentPhase &&
    isMyTurn &&
    session?.status === "in_progress" &&
    session?.current_action_type !== null;

  const turnActionText = (() => {
    if (!session?.current_action_type) return "";
    switch (session.current_action_type) {
      case "ban": return "マップを BAN";
      case "pick_map": return "マップを PICK";
      case "pick_side": return "サイドを選択";
      default: return "";
    }
  })();

  /* ---- side selection helpers ---- */
  function getSideForPhase(pk: "hp" | "snd" | "ovl") {
    const ps = phaseStates[pk];
    if (!ps.side) return null;
    const pickerIsTeamA = pk === "snd" || pk === "ovl";
    const teamAIsAlpha = teamAssignment.teamA === alphaTeam?.id;
    const pickerIsAlpha = pickerIsTeamA ? teamAIsAlpha : !teamAIsAlpha;
    const alphaSide = pickerIsAlpha ? ps.side : (ps.side === "JSOC" ? "ギルド" : "JSOC");
    return alphaSide;
  }

  /* ---- completion count for progress ---- */
  const completedPhases = phaseKeys.filter((pk) => phaseStatus(pk) === "done").length;

  if (!matchId) {
    return (
      <main>
        <div className="card-strong" style={{ padding: 24, color: "var(--danger)" }}>
          match id が見つかりません。
        </div>
      </main>
    );
  }

  if (loading) {
    return <main><LoadingSkeleton cards={3} /></main>;
  }

  return (
    <main>
      {/* ---- TROPHY POPUP ---- */}
      {showTrophyPopup && (
        <div className="modal-root" onClick={() => setShowTrophyPopup(false)}>
          <div className="modal-scrim" />
          <div
            className="card-strong"
            style={{ position: "relative", maxWidth: 420, width: "90%", textAlign: "center", padding: "32px 40px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.25rem", margin: "0 0 12px" }}>
              トロフィー使用者の選択をしてください。
            </h3>
            <p className="muted" style={{ marginBottom: 24 }}>
              ※各チーム2人まで
            </p>
            {trophyRemainingSec !== null && !allTrophyDone && (
              <div style={{ marginBottom: 16 }}>
                <span className="badge amber">
                  残り {Math.floor(trophyRemainingSec / 60)}:{String(trophyRemainingSec % 60).padStart(2, "0")}
                </span>
              </div>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowTrophyPopup(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* ---- HEADER ---- */}
      <div className="rowx mb-l">
        <div>
          <div className="eyebrow">MATCH / BAN &amp; PICK</div>
          <h1 className="display" style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", marginTop: 6 }}>
            マップ&サイド<em>選択。</em>
          </h1>
        </div>
        <div className="row">
          {session?.status === "in_progress" && (
            <span className="badge magenta"><span className="badge-dot" />IN SESSION</span>
          )}
          {!session && (
            <button onClick={handleCreateBanpickSession} disabled={busy} className="btn-primary btn-sm">
              バンピック開始
            </button>
          )}
          {isBanpickCompleted && allTrophyDone && (
            <button onClick={() => router.push(`/match/${matchId}/confirm`)} className="btn-primary btn-sm">
              試合条件最終確認へ
            </button>
          )}
          <Tutorial pageKey="banpick" steps={BANPICK_TUTORIAL} />
        </div>
      </div>

      {/* ---- ERRORS / INFO ---- */}
      {errorText && (
        <div className="card" style={{ borderColor: "var(--danger)", background: "var(--danger-soft)", marginBottom: 16, padding: "12px 16px", fontSize: 13, color: "var(--danger)" }}>
          {errorText}
        </div>
      )}
      {infoText && (
        <div className="card" style={{ borderColor: "rgba(0,245,160,0.3)", background: "var(--success-soft)", marginBottom: 16, padding: "12px 16px", fontSize: 13, color: "var(--success)" }}>
          {infoText}
        </div>
      )}

      {/* ---- PHASE BAR ---- */}
      {session && (
        <div className="card-strong" style={{ padding: "18px 20px", marginBottom: 20 }}>
          <div className="grid-3">
            {phaseKeys.map((pk) => {
              const st = phaseStatus(pk);
              const borderColor = st === "active"
                ? "var(--cyan)"
                : st === "done"
                ? "var(--success)"
                : "var(--line)";
              return (
                <div
                  key={pk}
                  className="card"
                  style={{ borderColor, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}
                >
                  <div
                    style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: st === "active" ? "var(--cyan-soft)" : st === "done" ? "var(--success-soft)" : "rgba(255,255,255,0.04)",
                      display: "grid", placeItems: "center",
                      fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
                      color: st === "active" ? "var(--cyan)" : st === "done" ? "var(--success)" : "var(--text-dim)",
                    }}
                  >
                    {PHASE_SHORT[pk]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 700, color: "var(--text-strong)" }}>
                      {PHASE_NAME[pk]}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 2 }}>
                      {phaseStepText(pk)}
                    </div>
                  </div>
                  {st === "done" && (
                    <span style={{ color: "var(--success)" }}><IconCheck /></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- MAIN 2-COLUMN LAYOUT ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>

        {/* ---- LEFT COLUMN ---- */}
        <div className="stack">

          {/* Turn card or Complete card */}
          {!isBanpickCompleted && session && currentPhase ? (
            <div className="card-strong">
              {/* header */}
              <div className="rowx" style={{ marginBottom: 16 }}>
                <div className="row">
                  {currentTurnTeam && (
                    <span className={`side-chip ${currentTurnTeam.side}`}>
                      {currentTurnTeam.side.toUpperCase()}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)" }}>
                    {turnActionText}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {PHASE_NAME[currentPhase]}
                  </span>
                </div>
                {remainingSec !== null && session.status === "in_progress" && (
                  <TimerRing seconds={remainingSec > 0 ? remainingSec : 0} max={300} size={60} />
                )}
              </div>

              {/* Ban / Pick map grid */}
              {(session.current_action_type === "ban" || session.current_action_type === "pick_map") && (
                isMyTurn ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    {currentPool.map((mapName) => {
                      const banned = currentState?.bans.includes(mapName) ?? false;
                      const picked = currentState?.map === mapName;
                      const canClick = allowInteraction && !banned && !currentState?.map;
                      const meta = MAP_META[mapName];
                      const thumbState: "available" | "banned" | "picked" = picked
                        ? "picked"
                        : banned
                        ? "banned"
                        : "available";

                      return (
                        <button
                          key={mapName}
                          type="button"
                          disabled={busy || !canClick}
                          onClick={() => {
                            if (!canClick) return;
                            void handleSubmitBanpickActionWith(mapName);
                          }}
                          style={{
                            background: "none", border: "none", padding: 0,
                            cursor: canClick ? "pointer" : "default",
                            transition: "transform 0.15s",
                          }}
                          onMouseEnter={(e) => { if (canClick) (e.currentTarget.style.transform = "translateY(-2px)"); }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
                        >
                          <MapThumb
                            mapId={meta?.id ?? mapName}
                            mapName={mapName}
                            mapNameEn={meta?.en}
                            state={thumbState}
                            small
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted" style={{ fontStyle: "italic", textAlign: "center", padding: "24px 0" }}>
                    相手の手番を待っています...
                  </p>
                )
              )}

              {/* Side selection */}
              {session.current_action_type === "pick_side" && (
                isMyTurn ? (
                  <div className="grid-2" style={{ gap: 12 }}>
                    {SIDE_OPTIONS.map((s, i) => {
                      const isAlphaSide = i === 0;
                      const borderC = isAlphaSide ? "var(--cyan)" : "var(--magenta)";
                      const bgC = isAlphaSide ? "var(--cyan-dim)" : "var(--magenta-soft)";
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={busy}
                          onClick={() => { void handleSubmitBanpickActionWith(s); }}
                          className="card"
                          style={{
                            borderColor: borderC, background: bgC,
                            textAlign: "center", padding: "20px 16px", cursor: "pointer",
                          }}
                        >
                          <div style={{
                            fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800,
                            color: isAlphaSide ? "var(--cyan)" : "var(--magenta)",
                            lineHeight: 1.1,
                          }}>
                            {isAlphaSide ? "ALPHA" : "BRAVO"}
                          </div>
                          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{s}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted" style={{ fontStyle: "italic", textAlign: "center", padding: "24px 0" }}>
                    相手の手番を待っています...
                  </p>
                )
              )}
            </div>
          ) : isBanpickCompleted ? (
            <div className="card-strong enter">
              <span className="badge success" style={{ marginBottom: 12 }}>
                <span className="badge-dot" />COMPLETE
              </span>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 800, lineHeight: 1.1 }}>
                バンピック<span style={{ color: "var(--cyan)" }}>完了。</span>
              </div>
            </div>
          ) : !session ? (
            <div className="card-strong">
              <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
                まだバンピックは開始されていません。
              </p>
            </div>
          ) : null}

          {/* ---- Selected maps summary ---- */}
          <div className="card-strong">
            <div className="sec-title">確定マップ</div>
            <div className="grid-3">
              {phaseKeys.map((pk) => {
                const ps = phaseStates[pk];
                const meta = ps.map ? MAP_META[ps.map] : null;
                const sideLabel = getSideForPhase(pk);
                return (
                  <div key={pk} style={{ textAlign: "center" }}>
                    {ps.map && meta ? (
                      <MapThumb
                        mapId={meta.id}
                        mapName={ps.map}
                        mapNameEn={meta.en}
                        state="picked"
                        small
                      />
                    ) : (
                      <div
                        style={{
                          height: 80, borderRadius: "var(--r-md)",
                          border: "1px dashed var(--line-strong)",
                          display: "grid", placeItems: "center",
                          color: "var(--text-dim)", fontSize: 11,
                        }}
                      >
                        {PHASE_SHORT[pk]}
                      </div>
                    )}
                    {sideLabel && (
                      <div style={{ marginTop: 6 }}>
                        <span className={`side-chip ${sideLabel === "JSOC" ? "alpha" : "bravo"}`}>
                          {sideLabel}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- Host display ---- */}
          {isBanpickCompleted && match?.host_user_id && (
            <div className="card-strong">
              <div className="sec-title">ホスト</div>
              <div className="row" style={{ marginBottom: 12 }}>
                <div className="avatar">{(hostDisplayName ?? "?")[0]}</div>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)" }}>
                  {hostDisplayName ?? "決定中..."}
                </span>
              </div>
              {isHost && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={lobbyCodeInput}
                    onChange={(e) => setLobbyCodeInput(e.target.value)}
                    placeholder="ロビーコード"
                    style={{ fontFamily: "var(--font-mono)", flex: 1 }}
                    disabled={busy}
                  />
                  <button onClick={handleSendLobbyCode} disabled={busy} className="btn-primary btn-sm">
                    送信
                  </button>
                </div>
              )}
              {match.lobby_code && (
                <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--cyan)", letterSpacing: "0.1em" }}>
                  {match.lobby_code}
                </div>
              )}
            </div>
          )}

          {/* ---- Trophy selection (inline, only when banpick complete and not all done) ---- */}
          {isBanpickCompleted && !allTrophyDone && (
            <div className="card-strong">
              <div className="rowx" style={{ marginBottom: 14 }}>
                <div className="sec-title" style={{ margin: 0 }}>トロフィー選択</div>
                {trophyRemainingSec !== null && (
                  <span className={`badge ${trophyRemainingSec <= 30 ? "danger" : "amber"}`}>
                    残り {Math.floor(trophyRemainingSec / 60)}:{String(trophyRemainingSec % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                各チームからトロフィー使用者を選択してください。3分以内に選択しないと強制敗北になります。
              </p>
              {(["alpha", "bravo"] as const).map((side) => {
                const team = side === "alpha" ? alphaTeam : bravoTeam;
                const teamMembers = groupedMembers[side];
                const trophyList: string[] = Array.isArray(team?.trophy_users) ? team.trophy_users : [];
                const isMyTeam = !!myMatchTeamId && team?.id === myMatchTeamId;

                return (
                  <div key={side} style={{ marginBottom: 12 }}>
                    <div className={`side-chip ${side}`} style={{ marginBottom: 8 }}>{side.toUpperCase()}</div>
                    <div className="stack-sm">
                      {teamMembers.map((m) => {
                        const isTrophy = trophyList.includes(m.user_id);
                        return (
                          <div key={m.id} className="card" style={{ padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13 }}>
                              {m.profiles?.display_name ?? m.user_id}
                              {isTrophy && (
                                <span style={{ marginLeft: 8, color: "var(--cyan)", fontSize: 11 }}>
                                  [トロフィー]
                                </span>
                              )}
                            </span>
                            {isMyTeam && (
                              <button
                                type="button"
                                onClick={() => handleToggleTrophy(m.user_id)}
                                disabled={busy}
                                className={isTrophy ? "btn-danger btn-sm" : "btn-sm"}
                                style={{ padding: "4px 10px", fontSize: 11 }}
                              >
                                {isTrophy ? "解除" : "選択"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                      選択済み: {trophyList.length} / 2
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- RIGHT COLUMN ---- */}
        <div className="stack">

          {/* Action log */}
          <div className="card-strong">
            <div className="sec-title"><IconChat /> アクションログ</div>
            <div style={{ maxHeight: 400, overflowY: "auto" }} className="stack-sm">
              {actions.length === 0 ? (
                <div className="muted" style={{ fontSize: 12, padding: "12px 0", textAlign: "center" }}>まだ履歴はありません。</div>
              ) : (
                actions.map((action) => (
                  <div key={action.id} className="card" style={{ padding: "8px 12px", fontSize: 12 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge" style={{ fontSize: 9, padding: "2px 6px" }}>
                        {action.phase.toUpperCase()}
                      </span>
                      <span style={{ color: "var(--text-soft)" }}>
                        {action.profiles?.display_name ?? action.actor_user_id} が{" "}
                        <span style={{ fontWeight: 700, color: "var(--text-strong)" }}>
                          {actionTypeLabel(action.action_type)}
                        </span>{" "}
                        : {action.target}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Teams */}
          <div className="card-strong">
            <div className="sec-title"><IconUsers /> チーム</div>
            <div className="stack-sm">
              {([alphaTeam, bravoTeam] as const).map((team) => {
                if (!team) return null;
                return (
                  <div key={team.id} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center" }}>
                      <span className={`side-chip ${team.side}`}>{team.side.toUpperCase()}</span>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>
                        {team.display_name ?? team.side}
                      </span>
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        SR {team.effective_avg_rating}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(team.side === "alpha" ? groupedMembers.alpha : groupedMembers.bravo).map((m) => (
                        <span key={m.id} style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: team.side === "alpha" ? "var(--alpha-soft)" : "var(--bravo-soft)",
                          color: team.side === "alpha" ? "var(--alpha)" : "var(--bravo)",
                          fontWeight: 600,
                        }}>
                          {m.profiles?.display_name ?? m.user_id.slice(0, 6)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress */}
          <div className="card">
            <div className="stat-label">フェーズ進捗</div>
            <div className="rowx" style={{ marginTop: 8 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-strong)" }}>
                {completedPhases}/3
              </span>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${(completedPhases / 3) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Chat */}
          <div className="card-strong">
            <div className="sec-title"><IconChat /> チャット</div>
            <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 10 }} className="stack-sm">
              {messages.length === 0 ? (
                <div className="muted" style={{ fontSize: 12, padding: "12px 0", textAlign: "center" }}>まだメッセージはありません。</div>
              ) : (
                messages.map((msg) => {
                  const isSystem = msg.message_type === "system";
                  const isMine = msg.sender_user_id === myUserId;
                  const bg = isSystem
                    ? "rgba(255,176,32,0.08)"
                    : isMine
                    ? "rgba(0,229,255,0.06)"
                    : "rgba(255,255,255,0.03)";
                  return (
                    <div
                      key={msg.id}
                      style={{
                        background: bg,
                        borderRadius: "var(--r-md)",
                        padding: "8px 12px",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                        <span>
                          {msg.profiles?.display_name ?? (msg.sender_user_id ? msg.sender_user_id : "system")}
                        </span>
                        <span>{new Date(msg.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {translateBody(msg.body)}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="メッセージを入力"
                maxLength={300}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
                style={{ flex: 1 }}
              />
              <button onClick={handleSendChat} disabled={busy} className="btn-sm">
                送信
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Responsive override for mobile ---- */}
      <style>{`
        @media (max-width: 900px) {
          main > div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
