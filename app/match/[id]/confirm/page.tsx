"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { playChatReceive } from "@/lib/sounds";
import { LoadingSkeleton } from "@/components/UIState";

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
  profiles?: { id: string; display_name: string } | null;
};

type BanpickSessionRow = {
  id: string;
  match_id: string;
  status: string;
  phase: string;
  selected_maps: Json;
};

type MatchMessageRow = {
  id: string;
  match_id: string;
  sender_user_id: string | null;
  message_type: "text" | "lobby_code" | "system";
  body: string;
  created_at: string;
  profiles?: { id: string; display_name: string } | null;
};

type PhaseState = { bans: string[]; map: string | null; side: string | null };

function parsePhaseState(selected: Json, phase: "hp" | "snd" | "ovl"): PhaseState {
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    return { bans: [], map: null, side: null };
  }
  const node = (selected as Record<string, Json>)[phase];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { bans: [], map: null, side: null };
  }
  const obj = node as Record<string, Json>;
  const bansRaw = obj.bans;
  const bans = Array.isArray(bansRaw) ? bansRaw.filter((x): x is string => typeof x === "string") : [];
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
  return MESSAGE_JA[body] ?? body;
}

function messageTypeLabel(type: string): string {
  if (type === "system") return "システム";
  if (type === "lobby_code") return "ロビーコード";
  return "チャット";
}

export default function MatchConfirmPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = typeof params.id === "string" ? params.id : null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [teams, setTeams] = useState<MatchTeamRow[]>([]);
  const [members, setMembers] = useState<MatchTeamMemberRow[]>([]);
  const [session, setSession] = useState<BanpickSessionRow | null>(null);
  const [messages, setMessages] = useState<MatchMessageRow[]>([]);

  const [chatInput, setChatInput] = useState("");
  const [showHostPopup, setShowHostPopup] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const loadBusyRef = useRef(false);
  const cachedUidRef = useRef<string | null>(null);
  const hostPopupShownRef = useRef(false);

  const clearMessages = () => setErrorText(null);

  const loadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!matchId) return;
      if (opts?.silent && loadBusyRef.current) return;
      loadBusyRef.current = true;
      if (!opts?.silent) setLoading(true);
      setErrorText(null);

      try {
        let uid = cachedUidRef.current;
        if (!uid) {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          uid = authSession?.user?.id ?? null;
          cachedUidRef.current = uid;
        }
        setMyUserId(uid);

        const teamIdsRes = await supabase.from("match_teams").select("id").eq("match_id", matchId);
        const teamIds = (teamIdsRes.data ?? []).map((t: { id: string }) => t.id);

        const [
          { data: matchData, error: matchError },
          { data: teamsData, error: teamsError },
          { data: membersData, error: membersError },
          { data: sessionData, error: sessionError },
          { data: messagesData, error: messagesError },
        ] = await Promise.all([
          supabase
            .from("matches")
            .select("id,status,host_user_id,host_match_team_id,host_selected_at,lobby_code,lobby_code_set_by_user_id,lobby_code_set_at")
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
            .select("id,match_id,status,phase,selected_maps")
            .eq("match_id", matchId)
            .maybeSingle<BanpickSessionRow>(),
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
        if (messagesError) throw messagesError;

        setMatch(matchData ?? null);
        setTeams(teamsData ?? []);
        setMembers(membersData ?? []);
        setSession(sessionData ?? null);

        const newMessages = messagesData ?? [];
        if (newMessages.length > prevMsgCountRef.current && prevMsgCountRef.current > 0) {
          playChatReceive();
        }
        prevMsgCountRef.current = newMessages.length;
        setMessages(newMessages);
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : "読み込みに失敗しました。");
      } finally {
        loadBusyRef.current = false;
        if (!opts?.silent) setLoading(false);
      }
    },
    [matchId]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase
      .channel(`confirm-room-${matchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, () => void loadAll({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "match_teams", filter: `match_id=eq.${matchId}` }, () => void loadAll({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "match_messages", filter: `match_id=eq.${matchId}` }, () => void loadAll({ silent: true }))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [matchId, loadAll]);

  useEffect(() => {
    const interval = setInterval(() => void loadAll({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [loadAll]);

  useEffect(() => {
    const el = chatBottomRef.current?.parentElement;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const alphaTeam = useMemo(() => teams.find((t) => t.side === "alpha") ?? null, [teams]);
  const bravoTeam = useMemo(() => teams.find((t) => t.side === "bravo") ?? null, [teams]);

  const groupedMembers = useMemo(() => {
    const alpha = members.filter((m) => m.match_team_id === alphaTeam?.id);
    const bravo = members.filter((m) => m.match_team_id === bravoTeam?.id);
    return { alpha, bravo };
  }, [members, alphaTeam, bravoTeam]);

  const hostDisplayName = useMemo(() => {
    if (!match?.host_user_id) return null;
    const m = members.find((x) => x.user_id === match.host_user_id);
    return m?.profiles?.display_name ?? match.host_user_id;
  }, [match, members]);

  const isHost = !!match?.host_user_id && match.host_user_id === myUserId;

  useEffect(() => {
    if (!isHost) return;
    if (hostPopupShownRef.current) return;
    hostPopupShownRef.current = true;
    setShowHostPopup(true);
  }, [isHost]);

  const [lobbyCodeInput, setLobbyCodeInput] = useState("");

  const handleSendLobbyCode = async () => {
    if (!matchId) return;
    clearMessages();
    const code = lobbyCodeInput.trim();
    if (!code) { setErrorText("ロビーコードを入力してください。"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_send_lobby_code", { p_match_id: matchId, p_lobby_code: code });
      if (error) throw error;
      setLobbyCodeInput("");
      await loadAll({ silent: true });
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "ロビーコード送信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

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

  const handleSendChat = async () => {
    if (!matchId) return;
    clearMessages();
    const body = chatInput.trim();
    if (!body) { setErrorText("メッセージを入力してください。"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_send_match_message", { p_match_id: matchId, p_body: body });
      if (error) throw error;
      setChatInput("");
      await loadAll({ silent: true });
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "メッセージ送信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  if (!matchId) return <main><p className="danger">match id が見つかりません。</p></main>;
  if (loading) return <main><LoadingSkeleton cards={3} /></main>;

  return (
    <main>
      {/* Host popup modal */}
      {showHostPopup && (
        <div className="modal-root" onClick={() => setShowHostPopup(false)}>
          <div className="modal-scrim" />
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-body" style={{ textAlign: "center", padding: "32px 24px" }}>
              <h2 style={{ marginTop: 0 }}>あなたがホストに選ばれました。</h2>
              <p>プライベートマッチロビーを作成してください。</p>
              <p className="muted">
                やり方がわからない場合はロビー作成方法ボタンを押してください。
              </p>
            </div>
            <div className="modal-foot" style={{ justifyContent: "center" }}>
              <button
                className="btn-primary"
                onClick={() => setShowHostPopup(false)}
              >
                OK
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setShowHostPopup(false);
                  router.push("/rules#lobby-guide");
                }}
              >
                ロビー作成方法
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <div className="eyebrow">MATCH CONFIRM</div>
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', marginTop: 6 }}>
          <em>試合条件最終確認</em>
        </h1>
        <p className="muted">
          メンバーが揃い次第、以下の内容でプライベートマッチを開始してください。
        </p>
      </div>

      {/* Action buttons */}
      <div className="section row">
        <button
          className="btn-primary"
          onClick={() => router.push(`/match/${matchId}/report`)}
        >
          試合結果を報告する
        </button>
        <button
          className="btn-ghost"
          onClick={() => router.push("/rules")}
        >
          ルール一覧
        </button>
        <button
          className="btn-ghost"
          onClick={() => void loadAll()}
          disabled={busy}
        >
          再読み込み
        </button>
      </div>

      {errorText && (
        <div className="section card" style={{ borderColor: "rgba(255, 77, 109, 0.3)", background: "var(--danger-soft)" }}>
          <p className="danger">{errorText}</p>
        </div>
      )}

      <div className="section grid-2">
        {/* Left column */}
        <div className="stack">
          {/* Host & Lobby Code */}
          <div className="card-strong">
            <h2 style={{ marginTop: 0 }}>ホスト / ロビーコード</h2>
            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="card">
                <div className="stat-label">ホスト</div>
                <div className="stat-val" style={{ fontSize: 16, marginTop: 4 }}>{hostDisplayName ?? "未決定"}</div>
              </div>
              <div className="card">
                <div className="stat-label">ロビーコード</div>
                <div className="stat-val mono" style={{ fontSize: 16, marginTop: 4, wordBreak: "break-all" }}>{match?.lobby_code ?? "未設定"}</div>
                {match?.lobby_code_set_at && (
                  <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                    更新: {new Date(match.lobby_code_set_at).toLocaleString("ja-JP")}
                  </div>
                )}
              </div>
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <div className="stat-label" style={{ marginBottom: 8 }}>ロビーコード送信</div>
              <input
                value={lobbyCodeInput}
                onChange={(e) => setLobbyCodeInput(e.target.value)}
                placeholder={isHost ? "例: ABCDE" : "ホストのみ送信可能"}
                disabled={busy || !isHost}
              />
              <button
                className="btn-primary btn-block"
                style={{ marginTop: 8 }}
                onClick={handleSendLobbyCode}
                disabled={busy || !isHost}
              >
                ロビーコード送信
              </button>
            </div>
          </div>

          {/* Trophy Users */}
          <div className="card-strong">
            <h2 style={{ marginTop: 0 }}>トロフィー使用者</h2>
            {(["alpha", "bravo"] as const).map((side) => {
              const team = side === "alpha" ? alphaTeam : bravoTeam;
              const teamMembers = groupedMembers[side];
              const trophyList: string[] = Array.isArray(team?.trophy_users) ? team.trophy_users : [];
              return (
                <div key={side} className="card" style={{ marginTop: 12 }}>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span className={`side-chip ${side}`}>{side.toUpperCase()}</span>
                  </div>
                  <div className="stack-sm">
                    {teamMembers.map((m) => {
                      const isTrophy = trophyList.includes(m.user_id);
                      return (
                        <div key={m.id} className="row" style={{ justifyContent: "space-between", padding: "6px 10px", borderRadius: "var(--r-sm)", background: "rgba(255,255,255,0.03)" }}>
                          <span style={{ fontSize: 14 }}>
                            {m.profiles?.display_name ?? m.user_id}
                          </span>
                          {isTrophy && (
                            <span className="badge" style={{ fontSize: 9 }}>トロフィー</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>選択済み: {trophyList.length} / 2</p>
                </div>
              );
            })}
          </div>

          {/* Banpick Results */}
          <div className="card-strong">
            <h2 style={{ marginTop: 0 }}>バンピック結果</h2>
            <div className="stack" style={{ marginTop: 12 }}>
              {(["hp", "snd", "ovl"] as const).map((phaseKey) => {
                const state = phaseStates[phaseKey];
                return (
                  <div key={phaseKey} className="card">
                    <div className="stat-label" style={{ marginBottom: 6 }}>
                      {phaseKey === "hp" && "HARDPOINT"}
                      {phaseKey === "snd" && "SEARCH & DESTROY"}
                      {phaseKey === "ovl" && "OVERLOAD"}
                    </div>
                    <div className="row" style={{ gap: 16 }}>
                      <div>
                        <span className="muted">マップ: </span>
                        <span className="success" style={{ fontWeight: 600 }}>{state.map ?? "-"}</span>
                      </div>
                      {state.side ? (() => {
                        const pickerIsTeamA = phaseKey === "snd" || phaseKey === "ovl";
                        const teamAIsAlpha = teamAssignment.teamA === alphaTeam?.id;
                        const pickerIsAlpha = pickerIsTeamA ? teamAIsAlpha : !teamAIsAlpha;
                        const alphaSide = pickerIsAlpha ? state.side : (state.side === "JSOC" ? "ギルド" : "JSOC");
                        const bravoSide = alphaSide === "JSOC" ? "ギルド" : "JSOC";
                        return (
                          <div>
                            <span className="muted">サイド: </span>
                            <span style={{ color: "var(--cyan)", fontWeight: 600 }}>Alpha: {alphaSide} / Bravo: {bravoSide}</span>
                          </div>
                        );
                      })() : (
                        <div>
                          <span className="muted">サイド: </span>
                          <span style={{ color: "var(--cyan)", fontWeight: 600 }}>-</span>
                        </div>
                      )}
                    </div>
                    {state.bans.length > 0 && (
                      <p className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                        BAN: {state.bans.join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right column — Chat */}
        <div>
          <div className="card-strong" style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ marginTop: 0 }}>試合チャット</h2>
            <div style={{ height: 520, overflowY: "auto", borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "rgba(0,0,0,0.2)", padding: 12, marginTop: 12 }}>
              <div className="stack-sm">
                {messages.length === 0 ? (
                  <p className="dim" style={{ fontSize: 14 }}>まだメッセージはありません。</p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="card"
                      style={{
                        padding: "8px 12px",
                        background:
                          msg.message_type === "system"
                            ? "rgba(255,255,255,0.03)"
                            : msg.message_type === "lobby_code"
                            ? "var(--success-soft)"
                            : "rgba(255,255,255,0.05)",
                        borderColor:
                          msg.message_type === "lobby_code"
                            ? "rgba(0, 245, 160, 0.3)"
                            : "var(--line)",
                      }}
                    >
                      <div className="row" style={{ justifyContent: "space-between", fontSize: 11, opacity: 0.7 }}>
                        <span>
                          [{messageTypeLabel(msg.message_type)}]{" "}
                          {msg.profiles?.display_name ?? (msg.sender_user_id ? msg.sender_user_id : "system")}
                        </span>
                        <span className="mono">{new Date(msg.created_at).toLocaleString("ja-JP")}</span>
                      </div>
                      <div style={{ marginTop: 4, wordBreak: "break-word", whiteSpace: "pre-wrap", fontSize: 14 }}>
                        {translateBody(msg.body)}
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatBottomRef} />
              </div>
            </div>
            <div className="stack-sm" style={{ marginTop: 12 }}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="メッセージを入力"
                rows={4}
                maxLength={300}
                disabled={busy}
              />
              <button
                className="btn-block"
                onClick={handleSendChat}
                disabled={busy}
              >
                メッセージ送信
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lobby tutorial image */}
      <div className="section card-strong">
        <h2 style={{ marginTop: 0 }}>ロビー画面の見方</h2>
        <img
          src="/tutorial.png"
          alt="プライベートマッチロビーの見方 - ロビーコード、JSOC（チーム1）、ギルド（チーム2）の位置"
          style={{ width: "100%", borderRadius: "var(--r-md)", border: "1px solid var(--line)", marginTop: 12 }}
        />
      </div>
    </main>
  );
}
