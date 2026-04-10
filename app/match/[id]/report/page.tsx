"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type MatchRow = {
  id: string;
  status: string;
  approval_status: string;
  winner_match_team_id: string | null;
  loser_match_team_id: string | null;
  completed_at: string | null;
  disputed: boolean | null;
};

type MatchTeamRow = {
  id: string;
  match_id: string;
  side: "alpha" | "bravo";
  display_name: string | null;
  party_composition: string | null;
  effective_avg_rating: number;
};

type MatchTeamMemberRow = {
  id: string;
  match_team_id: string;
  user_id: string;
  profiles?: {
    id: string;
    display_name: string;
  } | null;
};

type MatchReportRow = {
  id: string;
  match_id: string;
  submitted_by_user_id: string;
  submitted_by_match_team_id: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  winner_match_team_id: string | null;
  score_summary: string | null;
  notes: string | null;
  submitted_at: string;
  decided_at: string | null;
  deadline_at: string | null;
};

type MatchReportGameRow = {
  id: string;
  report_id: string;
  game_number: number;
  mode: string;
  map_name: string | null;
  winner_match_team_id: string | null;
  was_played: boolean;
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

type ReportFormGame = {
  game_number: number;
  mode: string;
  map_name: string;
  winner_match_team_id: string;
  was_played: boolean;
};

const MODE_OPTIONS = ["hp", "snd", "control", "overload"];
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

const MESSAGE_JA: Record<string, string> = {
  "banpick completed": "バンピックが完了しました。ホストを決定してください。",
  "banpick timeout: action side lost": "バンピック制限時間を超過したため、操作側の敗北として処理されました。",
  "match report submitted": "試合結果を申請しました。",
  "match report approved": "試合結果を承認しました。レートが更新されました。",
  "match report rejected": "試合結果申請を却下しました。再申請してください。",
  "auto-confirmed as dispute (2nd reject)": "却下が連続したため申請通りの結果で自動確定しました。",
  "report auto-approved after timeout": "承認期限を超過したため自動承認されました。レートが更新されました。",
};

function translateBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return MESSAGE_JA[normalized] ?? MESSAGE_JA[body] ?? body;
}

function teamLabel(team: MatchTeamRow | null) {
  if (!team) return "-";
  return `${team.side.toUpperCase()}${team.display_name ? ` (${team.display_name})` : ""}`;
}

export default function ReportPage() {
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
  const [report, setReport] = useState<MatchReportRow | null>(null);
  const [reportGames, setReportGames] = useState<MatchReportGameRow[]>([]);
  const [messages, setMessages] = useState<MatchMessageRow[]>([]);
  const [priorRejectCount, setPriorRejectCount] = useState(0);

  const [winnerMatchTeamId, setWinnerMatchTeamId] = useState("");
  const [scoreSummary, setScoreSummary] = useState("2-0");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [chatInput, setChatInput] = useState("");

  const [games, setGames] = useState<ReportFormGame[]>([
    { game_number: 1, mode: "hp", map_name: "", winner_match_team_id: "", was_played: true },
    { game_number: 2, mode: "snd", map_name: "", winner_match_team_id: "", was_played: true },
    { game_number: 3, mode: "control", map_name: "", winner_match_team_id: "", was_played: true },
  ]);

  const [reportRemainingSec, setReportRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    if (!report?.deadline_at || report.status !== "pending") {
      setReportRemainingSec(null);
      return;
    }
    const deadline = new Date(report.deadline_at).getTime();
    const tick = () => {
      setReportRemainingSec(Math.floor((deadline - Date.now()) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [report?.deadline_at, report?.status]);

  useEffect(() => {
    if (reportRemainingSec === null) return;
    if (reportRemainingSec > 0) return;
    if (!matchId) return;
    if (report?.status !== "pending") return;
    void (async () => {
      try {
        await supabase.rpc("rpc_resolve_report_timeout", { p_match_id: matchId });
        await loadAll({ silent: true });
      } catch (e) {
        console.error("resolve report timeout error:", e);
      }
    })();
  }, [reportRemainingSec, matchId, report?.status]);

  const alphaTeam = useMemo(() => teams.find((t) => t.side === "alpha") ?? null, [teams]);
  const bravoTeam = useMemo(() => teams.find((t) => t.side === "bravo") ?? null, [teams]);

  const myMember = useMemo(
    () => members.find((m) => m.user_id === myUserId) ?? null,
    [members, myUserId]
  );

  const myMatchTeamId = myMember?.match_team_id ?? null;

  const isMyOwnReport = !!report && report.submitted_by_match_team_id === myMatchTeamId;
  const canApproveOrReject =
    !!report &&
    report.status === "pending" &&
    !!myMatchTeamId &&
    report.submitted_by_match_team_id !== myMatchTeamId;

  const completedWinnerTeam = useMemo(() => {
    if (!match?.winner_match_team_id) return null;
    return teams.find((t) => t.id === match.winner_match_team_id) ?? null;
  }, [match?.winner_match_team_id, teams]);

  const groupedMembers = useMemo(() => {
    return {
      alpha: members.filter((m) => m.match_team_id === alphaTeam?.id),
      bravo: members.filter((m) => m.match_team_id === bravoTeam?.id),
    };
  }, [members, alphaTeam?.id, bravoTeam?.id]);

  const clearMessages = () => {
    setErrorText(null);
    setInfoText(null);
  };

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

      const [
        { data: matchData, error: matchError },
        { data: teamsData, error: teamsError },
        { data: membersData, error: membersError },
        { data: reportData, error: reportError },
        { count: rejectCountValue, error: rejectCountError },
        { data: messagesData, error: messagesError },
      ] = await Promise.all([
          supabase
            .from("matches")
            .select("id,status,approval_status,winner_match_team_id,loser_match_team_id,completed_at,disputed")
            .eq("id", matchId)
            .maybeSingle<MatchRow>(),
          supabase
            .from("match_teams")
            .select("id,match_id,side,display_name,party_composition,effective_avg_rating")
            .eq("match_id", matchId)
            .returns<MatchTeamRow[]>(),
          supabase
            .from("match_team_members")
            .select("id,match_team_id,user_id,profiles!match_team_members_user_id_fkey(id,display_name)")
            .in(
              "match_team_id",
              (
                (await supabase.from("match_teams").select("id").eq("match_id", matchId)) as {
                  data: { id: string }[] | null;
                }
              ).data?.map((t) => t.id) ?? ["00000000-0000-0000-0000-000000000000"]
            )
            .returns<MatchTeamMemberRow[]>(),
          supabase
            .from("match_reports")
            .select("id,match_id,submitted_by_user_id,submitted_by_match_team_id,status,winner_match_team_id,score_summary,notes,submitted_at,decided_at,deadline_at")
            .eq("match_id", matchId)
            .in("status", ["pending", "approved"])
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle<MatchReportRow>(),
          supabase
            .from("match_reports")
            .select("id", { count: "exact", head: true })
            .eq("match_id", matchId)
            .eq("status", "rejected"),
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
      if (reportError) throw reportError;
      if (rejectCountError) throw rejectCountError;
      if (messagesError) throw messagesError;

      setMatch(matchData ?? null);
      setTeams(teamsData ?? []);
      setMembers(membersData ?? []);
      setReport(reportData ?? null);
      setPriorRejectCount(rejectCountValue ?? 0);
      setMessages(messagesData ?? []);

      if (reportData?.id) {
        const { data: reportGamesData, error: reportGamesError } = await supabase
          .from("match_report_games")
          .select("id,report_id,game_number,mode,map_name,winner_match_team_id,was_played")
          .eq("report_id", reportData.id)
          .order("game_number", { ascending: true })
          .returns<MatchReportGameRow[]>();

        if (reportGamesError) throw reportGamesError;
        setReportGames(reportGamesData ?? []);
      } else {
        setReportGames([]);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "読み込みに失敗しました。";
      setErrorText(message);
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }, [matchId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!matchId) return;

    const channel = supabase
      .channel(`report-room-${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => {
          console.log("report realtime:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_reports", filter: `match_id=eq.${matchId}` },
        (payload) => {
          console.log("report realtime:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          console.log("report realtime:", payload.table, payload.eventType);
          void loadAll({ silent: true });
        }
      )
      .subscribe((status) => {
        console.log("report realtime status:", status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const interval = setInterval(() => void loadAll({ silent: true }), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const handleGameChange = <K extends keyof ReportFormGame>(
    index: number,
    key: K,
    value: ReportFormGame[K]
  ) => {
    setGames((prev) =>
      prev.map((g, i) => (i === index ? { ...g, [key]: value } : g))
    );
  };

  const handleSubmitReportWith = async (winnerId: string) => {
    if (!matchId) return;
    clearMessages();

    if (!winnerId) {
      setErrorText("勝者チームを選択してください。");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_submit_match_report", {
        p_match_id: matchId,
        p_winner_match_team_id: winnerId,
        p_score_summary: "勝敗のみ報告",
        p_notes: null,
        p_games_json: [],
      });

      if (error) throw error;

      setWinnerMatchTeamId(winnerId);
      setInfoText("試合結果を申請しました。相手の承認を待っています。");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "結果申請に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveReport = async () => {
    if (!report?.id) return;
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_approve_match_report", {
        p_report_id: report.id,
      });

      if (error) throw error;

      setInfoText("試合結果を承認しました。レートを更新しました。");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "承認に失敗しました。";
      setErrorText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleRejectReport = async () => {
    if (!report?.id) return;
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_reject_match_report", {
        p_report_id: report.id,
        p_reason: rejectReason || null,
      });

      if (error) throw error;

      setInfoText("試合結果を却下しました。");
      setRejectReason("");
      await loadAll();
    } catch (e) {
      const message = e instanceof Error ? e.message : "却下に失敗しました。";
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
      await loadAll({ silent: true });
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
            <h1 className="text-2xl font-bold">ASCENT 試合結果報告</h1>
            <p className="mt-1 text-sm text-white/60">Match ID: {matchId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push("/menu")}
              className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              メニューへ戻る
            </button>
            <button
              type="button"
              onClick={() => router.push(`/match/${matchId}/banpick`)}
              className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              バンピック画面へ
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

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">試合状態</div>
                  <div className="mt-1 text-sm font-medium">{match?.status ?? "-"}</div>
                </div>

                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">承認状態</div>
                  <div className="mt-1 text-sm font-medium">{match?.approval_status ?? "-"}</div>
                </div>

                <div className="rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">あなたのチーム</div>
                  <div className="mt-1 text-sm font-medium">
                    {myMatchTeamId === alphaTeam?.id
                      ? teamLabel(alphaTeam)
                      : myMatchTeamId === bravoTeam?.id
                      ? teamLabel(bravoTeam)
                      : "-"}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">チーム一覧</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">ALPHA</div>
                    <div className="text-xs text-white/60">{alphaTeam?.party_composition ?? "-"}</div>
                  </div>
                  <div className="mb-3 text-xs text-white/60">実効レート: {alphaTeam?.effective_avg_rating ?? "-"}</div>

                  <div className="space-y-2">
                    {groupedMembers.alpha.map((m) => (
                      <div key={m.id} className="rounded bg-white/5 px-3 py-2 text-sm">
                        {m.profiles?.display_name ?? m.user_id}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">BRAVO</div>
                    <div className="text-xs text-white/60">{bravoTeam?.party_composition ?? "-"}</div>
                  </div>
                  <div className="mb-3 text-xs text-white/60">実効レート: {bravoTeam?.effective_avg_rating ?? "-"}</div>

                  <div className="space-y-2">
                    {groupedMembers.bravo.map((m) => (
                      <div key={m.id} className="rounded bg-white/5 px-3 py-2 text-sm">
                        {m.profiles?.display_name ?? m.user_id}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {!report && match?.status !== "completed" && (
              <section className="rounded border border-white/10 bg-white/5 p-4">
                <h2 className="mb-3 text-lg font-semibold">勝者を選択</h2>
                <p className="mb-4 text-sm text-white/60">
                  勝利したチームのボタンを押して申請してください。相手チームの承認でレートと戦績が反映されます。
                </p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <button
                    onClick={() => alphaTeam && void handleSubmitReportWith(alphaTeam.id)}
                    disabled={busy || !alphaTeam}
                    className="rounded border border-cyan-400 bg-cyan-500/20 px-6 py-6 text-lg font-bold text-white hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    {teamLabel(alphaTeam)} 勝利
                  </button>

                  <button
                    onClick={() => bravoTeam && void handleSubmitReportWith(bravoTeam.id)}
                    disabled={busy || !bravoTeam}
                    className="rounded border border-fuchsia-400 bg-fuchsia-500/20 px-6 py-6 text-lg font-bold text-white hover:bg-fuchsia-500/30 disabled:opacity-50"
                  >
                    {teamLabel(bravoTeam)} 勝利
                  </button>
                </div>
              </section>
            )}

            {report && (
              <section className="rounded border border-white/10 bg-white/5 p-4">
                <h2 className="mb-3 text-lg font-semibold">提出済みレポート</h2>

                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">状態</div>
                    <div className="mt-1 text-sm font-medium">{report.status}</div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">勝者</div>
                    <div className="mt-1 text-sm font-medium">
                      {teamLabel(teams.find((t) => t.id === report.winner_match_team_id) ?? null)}
                    </div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">スコア</div>
                    <div className="mt-1 text-sm font-medium">{report.score_summary ?? "-"}</div>
                  </div>
                </div>

                <div className="mb-4 rounded bg-black/20 p-3">
                  <div className="text-xs text-white/50">備考</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{report.notes || "-"}</div>
                </div>

                <div className="space-y-2">
                  {reportGames.length === 0 ? (
                    <div className="text-sm text-white/50">ゲーム別情報はありません。</div>
                  ) : (
                    reportGames.map((game) => {
                      const winnerTeam = teams.find((t) => t.id === game.winner_match_team_id) ?? null;
                      return (
                        <div key={game.id} className="rounded bg-black/20 px-3 py-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">Game {game.game_number}</div>
                            <div className="text-xs text-white/50">
                              {game.was_played ? "played" : "not played"}
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                            <div>モード: {game.mode}</div>
                            <div>マップ: {game.map_name ?? "-"}</div>
                            <div>勝者: {teamLabel(winnerTeam)}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {canApproveOrReject && (
                  <div className="mt-4 rounded border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold">相手チームの申請を確認</div>
                      {reportRemainingSec !== null && (
                        <div className={`text-lg font-bold ${reportRemainingSec <= 60 ? "text-red-400" : "text-white"}`}>
                          {reportRemainingSec > 0
                            ? `${Math.floor(reportRemainingSec / 60)}:${String(reportRemainingSec % 60).padStart(2, "0")}`
                            : "0:00"}
                        </div>
                      )}
                    </div>

                    {priorRejectCount >= 1 && (
                      <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                        ⚠ 既に1回却下されています。次の却下で<strong>申請通りの結果で自動確定</strong>され、相手プレイヤーへの通報が必要になります。
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleApproveReport}
                        disabled={busy}
                        className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        承認する
                      </button>

                      <button
                        onClick={handleRejectReport}
                        disabled={busy}
                        className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {priorRejectCount >= 1 ? "却下する（自動確定 + dispute）" : "却下する"}
                      </button>
                    </div>
                  </div>
                )}

                {isMyOwnReport && report.status === "pending" && (
                  <div className="mt-4 rounded border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                    <div>相手チームの承認待ちです。</div>
                    {reportRemainingSec !== null && (
                      <div className="mt-2">
                        承認期限まで残り:{" "}
                        <span className={`font-bold ${reportRemainingSec <= 60 ? "text-red-400" : ""}`}>
                          {reportRemainingSec > 0
                            ? `${Math.floor(reportRemainingSec / 60)}:${String(reportRemainingSec % 60).padStart(2, "0")}`
                            : "0:00（自動承認処理中...）"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {match?.status === "completed" && (
              <section
                className={`rounded border p-4 ${
                  match.disputed
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-emerald-500/20 bg-emerald-500/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">試合確定済み</h2>
                  {match.disputed && (
                    <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">
                      DISPUTED
                    </span>
                  )}
                </div>
                <div className="mt-2 text-sm">
                  勝者: <span className="font-semibold">{teamLabel(completedWinnerTeam)}</span>
                </div>
                {match.completed_at && (
                  <div className="mt-1 text-xs text-white/60">
                    確定日時: {new Date(match.completed_at).toLocaleString()}
                  </div>
                )}

                {match.disputed && (
                  <div className="mt-4 rounded border border-amber-500/30 bg-black/20 p-3">
                    <div className="mb-2 text-sm font-semibold text-amber-200">
                      この試合は dispute 状態で確定しました
                    </div>
                    <p className="mb-3 text-xs text-white/70">
                      却下が連続したため申請通りの結果で自動確定しています。結果に異議がある場合は、相手プレイヤーを通報してください。運営が確認します。
                    </p>
                    <div className="space-y-2">
                      {members
                        .filter((m) => m.match_team_id !== myMatchTeamId)
                        .map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() =>
                              router.push(
                                `/reports/new?reported=${m.user_id}&match=${matchId}`
                              )
                            }
                            className="block w-full rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm hover:bg-amber-500/20"
                          >
                            {m.profiles?.display_name ?? m.user_id} を通報する
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="space-y-4">
            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">試合チャット</h2>

              <div className="mb-3 h-[420px] overflow-y-auto rounded border border-white/10 bg-black/20 p-3">
                <div className="space-y-2">
                  {messages.length === 0 ? (
                    <div className="text-sm text-white/50">まだメッセージはありません。</div>
                  ) : (
                    messages.map((msg) => {
                      const senderName = msg.profiles?.display_name ?? null;
                      return (
                        <div
                          key={msg.id}
                          className={`rounded px-3 py-2 text-sm ${
                            msg.message_type === "system"
                              ? "bg-white/5 text-white/70"
                              : "bg-white/10 text-white"
                          }`}
                        >
                          <div className="mb-1 text-[11px] text-white/50">
                            {new Date(msg.created_at).toLocaleString()}
                          </div>
                          <div className="whitespace-pre-wrap break-words">
                            {senderName && (
                              <span className="font-semibold text-cyan-300">{senderName}: </span>
                            )}
                            {translateBody(msg.body)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="メッセージを入力"
                  rows={3}
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

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">使い方</h2>
              <div className="space-y-2 text-sm text-white/80">
                <div>1. 勝者チームのボタンを押します。</div>
                <div>2. 相手チームが承認するとレートと戦績が更新されます。</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}