"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { playReportNotify, playChatReceive } from "@/lib/sounds";

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
import RatingDelta from "@/components/RatingDelta";
import { triggerWinStreak } from "@/components/WinStreakCelebration";

const REPORT_TUTORIAL = [
  { title: "試合結果報告", body: "試合が終わったら、勝者チームのボタンを押して結果を報告します。" },
  { title: "承認と却下", body: "相手チームがあなたの報告を確認します。正しければ「承認」、間違いなら「却下」を押します。" },
  { title: "自動承認", body: "報告から1時間以内（全員がこの画面を見ている場合は5分以内）に相手が操作しない場合、自動で承認されます。" },
  { title: "無効試合", body: "2回連続で却下されると無効試合となり、レート変動はありません。虚偽の報告や不当な却下をするプレイヤーは通報してください。" },
];

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
  rating_before: number | null;
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
  "match voided after 2 rejections": "却下が連続したため無効試合になりました。レート変動はありません。",
  "report auto-approved after timeout": "承認期限を超過したため自動承認されました。レートが更新されました。",
  "match created": "マッチが成立しました。バンピックを開始してください。",
  "all players on report page, deadline shortened to 5 min": "全員が結果報告画面を開きました。承認期限が5分に短縮されました。",
  "trophy timeout: both teams failed, match voided, -10 rating": "トロフィー選択の制限時間に達しました。両チームとも未選択のため無効試合となり、全プレイヤーのレートが-10されました。",
  "trophy timeout: team forfeited for not selecting": "トロフィー選択の制限時間に達しました。未選択のチームの敗北として処理されました。",
};

function translateBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return MESSAGE_JA[normalized] ?? MESSAGE_JA[body] ?? body;
}

function teamLabel(team: MatchTeamRow | null) {
  if (!team) return "-";
  return `${team.side.toUpperCase()}${team.display_name ? ` (${team.display_name})` : ""}`;
}

function formatTimer(sec: number): string {
  if (sec <= 0) return "0:00";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
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
  const [visitInfo, setVisitInfo] = useState<{ all_visited: boolean; total: number; visited: number } | null>(null);

  const [winnerMatchTeamId, setWinnerMatchTeamId] = useState("");
  const [scoreSummary, setScoreSummary] = useState("2-0");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [oldRating, setOldRating] = useState<number | null>(null);
  const [newRating, setNewRating] = useState<number | null>(null);

  useSoundOnChange(report?.id ?? null, playReportNotify);
  useSoundOnChange(report?.status ?? null, playReportNotify);
  useSoundOnChange(messages.length, playChatReceive);

  const [games, setGames] = useState<ReportFormGame[]>([
    { game_number: 1, mode: "", map_name: "", winner_match_team_id: "", was_played: true },
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

  const trophyTimeoutType = useMemo(() => {
    const msgs = messages.map((m) => m.body);
    if (msgs.some((b) => b.includes('trophy timeout: both teams failed'))) return 'voided';
    if (msgs.some((b) => b.includes('trophy timeout: team forfeited'))) return 'forfeited';
    return null;
  }, [messages]);

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
      const { data: { session: authSession } } = await supabase.auth.getSession();
      setMyUserId(authSession?.user?.id ?? null);

      const { data: teamsForIds } = await supabase
        .from("match_teams")
        .select("id")
        .eq("match_id", matchId);
      const teamIds = (teamsForIds ?? []).map((t: { id: string }) => t.id);

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
            .select("id,match_team_id,user_id,rating_before,profiles!match_team_members_user_id_fkey(id,display_name)")
            .in("match_team_id", teamIds.length > 0 ? teamIds : ["00000000-0000-0000-0000-000000000000"])
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
    void (async () => {
      try {
        const { data } = await supabase.rpc("rpc_mark_report_visited", { p_match_id: matchId });
        if (data) setVisitInfo(data as { all_visited: boolean; total: number; visited: number });
      } catch (e) {
        console.error("mark visit error:", e);
      }
    })();
  }, [matchId]);

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
        () => void loadAll({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_messages", filter: `match_id=eq.${matchId}` },
        () => void loadAll({ silent: true })
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
    const interval = setInterval(() => {
      void loadAll({ silent: true });
      void supabase.rpc("rpc_mark_report_visited", { p_match_id: matchId }).then(({ data }) => {
        if (data) setVisitInfo(data as { all_visited: boolean; total: number; visited: number });
      });
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Fetch rating delta when match completes
  useEffect(() => {
    if (match?.status !== "completed" || match.approval_status === "voided") return;
    if (!myUserId || !myMember) return;

    const ratingBefore = myMember.rating_before;
    if (ratingBefore == null) return;

    setOldRating(ratingBefore);

    void (async () => {
      try {
        const { data } = await supabase
          .from("rating_history")
          .select("rating_after")
          .eq("user_id", myUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<{ rating_after: number }>();

        if (data?.rating_after != null) {
          setNewRating(data.rating_after);
        }
      } catch (e) {
        console.error("rating fetch error:", e);
      }
    })();
  }, [match?.status, match?.approval_status, myUserId, myMember]);

  // Fire win streak celebration when match completes with a win
  const winStreakFiredRef = useRef(false);
  useEffect(() => {
    if (winStreakFiredRef.current) return;
    if (match?.status !== "completed" || match.approval_status === "voided") return;
    if (!myUserId || !myMatchTeamId) return;
    // Only fire for winners
    if (match.winner_match_team_id !== myMatchTeamId) return;

    winStreakFiredRef.current = true;
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("win_streak")
          .eq("id", myUserId)
          .maybeSingle<{ win_streak: number }>();

        const streak = data?.win_streak ?? 0;
        if (streak >= 3) {
          triggerWinStreak(streak);
        }
      } catch (e) {
        console.error("win streak fetch error:", e);
      }
    })();
  }, [match?.status, match?.approval_status, match?.winner_match_team_id, myUserId, myMatchTeamId]);

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
    return (
      <main className="container page-pad">
        <p className="muted">match id が見つかりません。</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="container page-pad">
        <LoadingSkeleton cards={3} />
      </main>
    );
  }

  const reportWinnerTeam = report ? (teams.find((t) => t.id === report.winner_match_team_id) ?? null) : null;
  const isCompleted = match?.status === "completed" && match.approval_status !== "voided";
  const isVoided = match?.status === "completed" && match.approval_status === "voided";
  const hasReport = !!report;
  const showSubmitForm = !report && match?.status !== "completed";

  /* Status badge for header */
  const statusBadge = (() => {
    if (isCompleted) return <span className="badge success">COMPLETED</span>;
    if (isVoided) return <span className="badge danger">VOIDED</span>;
    if (report?.status === "pending") return <span className="badge amber"><span className="badge-dot" />PENDING</span>;
    if (report?.status === "approved") return <span className="badge success">APPROVED</span>;
    return <span className="badge">{match?.status?.toUpperCase() ?? "---"}</span>;
  })();

  return (
    <main className="container page-pad" style={{ maxWidth: 1100 }}>
      {/* ── HEADER ── */}
      <div className="rowx mb-l">
        <div>
          <div className="eyebrow">MATCH · REPORT</div>
          <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', marginTop: 6 }}>
            試合結果<em>報告。</em>
          </h1>
        </div>
        <div className="row">
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => router.push(`/match/${matchId}/confirm`)}>
            試合条件確認に戻る
          </button>
          {statusBadge}
          <Tutorial pageKey="report" steps={REPORT_TUTORIAL} />
        </div>
      </div>

      {/* ── ERRORS / INFO ── */}
      {errorText && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', marginBottom: 16 }}>
          <p style={{ color: 'var(--danger)', fontSize: 13 }}>{errorText}</p>
        </div>
      )}
      {infoText && match?.status !== 'completed' && (
        <div className="card" style={{ borderColor: 'rgba(0,245,160,0.3)', background: 'rgba(0,245,160,0.06)', marginBottom: 16 }}>
          <p style={{ color: 'var(--success)', fontSize: 13 }}>{infoText}</p>
        </div>
      )}

      {trophyTimeoutType === 'voided' && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', marginBottom: 16 }}>
          <p style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>無効試合 — トロフィー選択タイムアウト</p>
          <p className="muted" style={{ marginTop: 6 }}>両チームともトロフィー使用者を制限時間内に選択しなかったため、無効試合となりました。全プレイヤーのレートが-10されています。</p>
        </div>
      )}
      {trophyTimeoutType === 'forfeited' && (
        <div className="card" style={{ borderColor: 'rgba(255,176,32,0.4)', background: 'var(--amber-soft)', marginBottom: 16 }}>
          <p style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 13 }}>敗北 — トロフィー選択タイムアウト</p>
          <p className="muted" style={{ marginTop: 6 }}>トロフィー使用者を制限時間内に選択しなかったチームの敗北として処理されました。</p>
        </div>
      )}

      {/* ── MAIN 2-COLUMN LAYOUT ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

        {/* ═══ LEFT COLUMN ═══ */}
        <div className="stack">

          {/* ── SUBMIT FORM (no report yet) ── */}
          {showSubmitForm && (
            <div className="card-strong">
              <div className="sec-title">勝者を選択</div>
              <p className="muted" style={{ marginBottom: 16 }}>
                勝利したチームのボタンを押して申請してください。相手チームの承認でレートと戦績が反映されます。
              </p>

              <div className="g2">
                <button
                  className="btn btn-lg glow-hover"
                  onClick={() => alphaTeam && void handleSubmitReportWith(alphaTeam.id)}
                  disabled={busy || !alphaTeam}
                  style={{
                    border: '1px solid var(--alpha)',
                    background: 'var(--alpha-soft)',
                    color: '#fff',
                    padding: '24px 16px',
                    fontFamily: 'var(--font-display)',
                    fontSize: 16,
                    fontWeight: 700,
                    borderRadius: 'var(--r-lg)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <span className="side-chip alpha" style={{ marginRight: 8 }}>ALPHA</span>
                  {alphaTeam?.display_name ?? "ALPHA"} 勝利
                </button>

                <button
                  className="btn btn-lg glow-hover"
                  onClick={() => bravoTeam && void handleSubmitReportWith(bravoTeam.id)}
                  disabled={busy || !bravoTeam}
                  style={{
                    border: '1px solid var(--bravo)',
                    background: 'var(--bravo-soft)',
                    color: '#fff',
                    padding: '24px 16px',
                    fontFamily: 'var(--font-display)',
                    fontSize: 16,
                    fontWeight: 700,
                    borderRadius: 'var(--r-lg)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <span className="side-chip bravo" style={{ marginRight: 8 }}>BRAVO</span>
                  {bravoTeam?.display_name ?? "BRAVO"} 勝利
                </button>
              </div>
            </div>
          )}

          {/* ── REPORT STATUS (submitted, pending/approved) ── */}
          {hasReport && !isCompleted && !isVoided && (
            <div className="card-strong">
              <div className="rowx" style={{ marginBottom: 16 }}>
                <div className="sec-title" style={{ margin: 0 }}>提出済みレポート</div>
                {report.status === "pending" ? (
                  <span className="badge amber"><span className="badge-dot" />AWAITING APPROVAL</span>
                ) : (
                  <span className="badge success">APPROVED</span>
                )}
              </div>

              {/* Winner display */}
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="stat-label">勝者</div>
                <div className="row" style={{ marginTop: 6 }}>
                  {reportWinnerTeam && (
                    <span className={`side-chip ${reportWinnerTeam.side}`}>
                      {reportWinnerTeam.side.toUpperCase()}
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
                    {teamLabel(reportWinnerTeam)}
                  </span>
                </div>
              </div>

              {/* Score summary */}
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="stat-label">スコア</div>
                <div className="mono tabular" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                  {report.score_summary ?? "-"}
                </div>
              </div>

              {/* Report games */}
              {reportGames.length > 0 && (
                <div className="stack-sm" style={{ marginBottom: 16 }}>
                  {reportGames.map((game) => {
                    const winnerTeam = teams.find((t) => t.id === game.winner_match_team_id) ?? null;
                    return (
                      <div key={game.id} className="card" style={{ padding: '10px 14px' }}>
                        <div className="rowx">
                          <div className="row" style={{ gap: 8 }}>
                            <span className="badge" style={{ padding: '2px 8px', fontSize: 11 }}>
                              {game.mode.toUpperCase()}
                            </span>
                            <span className="muted" style={{ fontSize: 12 }}>Game {game.game_number}</span>
                            {game.map_name && <span className="dim" style={{ fontSize: 12 }}>{game.map_name}</span>}
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {winnerTeam ? (
                              <span style={{ color: winnerTeam.side === 'alpha' ? 'var(--alpha)' : 'var(--bravo)', fontWeight: 600 }}>
                                {winnerTeam.side.toUpperCase()} WIN
                              </span>
                            ) : (
                              <span className="dim">{game.was_played ? "-" : "未実施"}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Notes */}
              {report.notes && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="stat-label">備考</div>
                  <p style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>{report.notes}</p>
                </div>
              )}

              {/* Approve / Reject controls */}
              {canApproveOrReject && (
                <div style={{ marginTop: 16 }}>
                  {priorRejectCount >= 1 && (
                    <div className="card" style={{ borderColor: 'rgba(255,176,32,0.4)', background: 'var(--amber-soft)', marginBottom: 12 }}>
                      <p style={{ color: 'var(--amber)', fontSize: 13 }}>
                        既に1回却下されています。次の却下で<strong>無効試合</strong>となり、レート変動はありません。
                      </p>
                    </div>
                  )}

                  <div className="row" style={{ gap: 10 }}>
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={handleApproveReport}
                      disabled={busy}
                    >
                      承認する
                    </button>
                    <button
                      className="btn btn-danger btn-lg"
                      onClick={handleRejectReport}
                      disabled={busy}
                    >
                      {priorRejectCount >= 1 ? "却下する（無効試合になります）" : "却下する"}
                    </button>
                  </div>
                </div>
              )}

              {/* Own report waiting info */}
              {isMyOwnReport && report.status === "pending" && (
                <div className="card" style={{ borderColor: 'rgba(255,176,32,0.3)', background: 'var(--amber-soft)', marginTop: 16 }}>
                  <p style={{ color: 'var(--amber)', fontSize: 13 }}>相手チームの承認待ちです。</p>
                  {visitInfo && (
                    <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      {visitInfo.all_visited
                        ? `全員がこの画面を開いています（${visitInfo.visited}/${visitInfo.total}人）— 制限時間5分`
                        : `まだ全員が画面を開いていません（${visitInfo.visited}/${visitInfo.total}人）— 制限時間1時間`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── COMPLETED CARD ── */}
          {isCompleted && (
            <div className="card-strong enter" style={{ textAlign: 'center', padding: 40 }}>
              <span className="badge success">COMPLETED</span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 44,
                fontWeight: 800,
                marginTop: 16,
                lineHeight: 1,
              }}>
                試合終了。
              </div>

              {completedWinnerTeam && (
                <div className="row" style={{ justifyContent: 'center', marginTop: 20, gap: 10 }}>
                  <span className={`side-chip ${completedWinnerTeam.side}`}>
                    {completedWinnerTeam.side.toUpperCase()}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    fontWeight: 700,
                    color: completedWinnerTeam.side === 'alpha' ? 'var(--alpha)' : 'var(--bravo)',
                    textShadow: completedWinnerTeam.side === 'alpha'
                      ? '0 0 16px rgba(0,229,255,0.5)'
                      : '0 0 16px rgba(255,43,214,0.5)',
                  }}>
                    {teamLabel(completedWinnerTeam)} WIN
                  </span>
                </div>
              )}

              {match.completed_at && (
                <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
                  確定日時: {new Date(match.completed_at).toLocaleString()}
                </p>
              )}

              {oldRating != null && newRating != null && (
                <div style={{ marginTop: 20 }}>
                  <RatingDelta
                    oldRating={oldRating}
                    newRating={newRating}
                    show={true}
                  />
                </div>
              )}

              <div className="row" style={{ justifyContent: 'center', marginTop: 24, gap: 10 }}>
                <button className="btn btn-ghost" onClick={() => router.push("/menu")}>メニューへ</button>
                <button className="btn btn-primary" onClick={() => router.push(`/users/${myUserId}`)}>戦績を見る</button>
              </div>
            </div>
          )}

          {/* ── VOIDED CARD ── */}
          {isVoided && (
            <div className="card-strong">
              <span className="badge danger">VOIDED</span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 32,
                fontWeight: 800,
                marginTop: 16,
              }}>
                無効試合
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                却下が連続したため無効試合となりました。レート変動はありません。
              </p>
              {match.completed_at && (
                <p className="dim" style={{ marginTop: 4, fontSize: 12 }}>
                  確定日時: {new Date(match.completed_at).toLocaleString()}
                </p>
              )}

              <div className="stack-sm" style={{ marginTop: 16 }}>
                <p className="muted" style={{ fontSize: 12 }}>虚偽の報告や不当な却下があった場合は通報してください。</p>
                {members
                  .filter((m) => m.match_team_id !== myMatchTeamId)
                  .map((m) => (
                    <button
                      key={m.id}
                      className="btn btn-danger"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() =>
                        router.push(`/reports/new?reported=${m.user_id}&match=${matchId}`)
                      }
                    >
                      {m.profiles?.display_name ?? m.user_id} を通報する
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══ RIGHT COLUMN ═══ */}
        <div className="stack">

          {/* ── MATCH INFO ── */}
          <div className="card-strong">
            <div className="sec-title">マッチ情報</div>

            {/* Alpha team */}
            <div className="card" style={{ marginBottom: 10 }}>
              <div className="rowx" style={{ marginBottom: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="side-chip alpha">ALPHA</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>
                    {alphaTeam?.display_name ?? "ALPHA"}
                  </span>
                </div>
                <span className="mono tabular dim" style={{ fontSize: 12 }}>
                  SR {alphaTeam?.effective_avg_rating ?? "-"}
                </span>
              </div>
              <div className="stack-sm">
                {groupedMembers.alpha.map((m) => (
                  <div
                    key={m.id}
                    className="row"
                    onClick={() => router.push(`/users/${m.user_id}`)}
                    style={{ gap: 8, cursor: 'pointer' }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--alpha-soft)',
                        border: '1px solid rgba(0,229,255,0.3)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--alpha)',
                        flexShrink: 0,
                      }}
                    >
                      {(m.profiles?.display_name ?? "?")[0]}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.profiles?.display_name ?? m.user_id.slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bravo team */}
            <div className="card">
              <div className="rowx" style={{ marginBottom: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="side-chip bravo">BRAVO</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>
                    {bravoTeam?.display_name ?? "BRAVO"}
                  </span>
                </div>
                <span className="mono tabular dim" style={{ fontSize: 12 }}>
                  SR {bravoTeam?.effective_avg_rating ?? "-"}
                </span>
              </div>
              <div className="stack-sm">
                {groupedMembers.bravo.map((m) => (
                  <div
                    key={m.id}
                    className="row"
                    onClick={() => router.push(`/users/${m.user_id}`)}
                    style={{ gap: 8, cursor: 'pointer' }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--bravo-soft)',
                        border: '1px solid rgba(255,43,214,0.3)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--bravo)',
                        flexShrink: 0,
                      }}
                    >
                      {(m.profiles?.display_name ?? "?")[0]}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.profiles?.display_name ?? m.user_id.slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── TIMER ── */}
          {report?.status === "pending" && reportRemainingSec !== null && (
            <div className="card">
              <div className="stat-label">承認期限</div>
              <div className="mono tabular" style={{
                fontSize: 32,
                fontWeight: 700,
                marginTop: 6,
                color: reportRemainingSec <= 60 ? 'var(--danger)' : 'var(--text)',
              }}>
                {reportRemainingSec > 0 ? formatTimer(reportRemainingSec) : "0:00"}
              </div>
              {reportRemainingSec <= 0 && (
                <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>自動承認処理中...</p>
              )}
              {visitInfo && (
                <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  {visitInfo.all_visited
                    ? `全員閲覧中（${visitInfo.visited}/${visitInfo.total}人）— 5分`
                    : `${visitInfo.visited}/${visitInfo.total}人が閲覧中 — 1時間`}
                </p>
              )}
            </div>
          )}

          {/* ── CHAT ── */}
          <div className="card-strong">
            <div className="sec-title">チャット</div>

            <div style={{
              height: 360,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 12,
            }}>
              {messages.length === 0 ? (
                <p className="muted" style={{ padding: 16, textAlign: 'center' }}>メッセージはありません</p>
              ) : (
                messages.map((msg) => {
                  const senderName = msg.profiles?.display_name ?? null;
                  const isSystem = msg.message_type === "system";
                  const senderMember = members.find((m) => m.user_id === msg.sender_user_id);
                  const senderSide = senderMember
                    ? teams.find((t) => t.id === senderMember.match_team_id)?.side
                    : null;

                  return (
                    <div
                      key={msg.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        fontSize: 13,
                        background: isSystem
                          ? 'rgba(255,255,255,0.03)'
                          : senderSide === 'alpha'
                            ? 'var(--alpha-soft)'
                            : senderSide === 'bravo'
                              ? 'var(--bravo-soft)'
                              : 'rgba(255,255,255,0.05)',
                        border: isSystem ? '1px solid var(--line)' : 'none',
                      }}
                    >
                      <div className="dim" style={{ fontSize: 10, marginBottom: 2 }}>
                        {new Date(msg.created_at).toLocaleString()}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {senderName && (
                          <span style={{
                            fontWeight: 600,
                            color: senderSide === 'alpha' ? 'var(--alpha)' : senderSide === 'bravo' ? 'var(--bravo)' : 'var(--text-soft)',
                            marginRight: 6,
                          }}>
                            {senderName}:
                          </span>
                        )}
                        {isSystem ? (
                          <span className="muted">{translateBody(msg.body)}</span>
                        ) : (
                          translateBody(msg.body)
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="メッセージを入力..."
                rows={2}
                maxLength={300}
                disabled={busy}
                style={{ flex: 1, minHeight: 'unset' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
              />
              <button
                className="btn btn-primary"
                onClick={handleSendChat}
                disabled={busy}
                style={{ alignSelf: 'stretch' }}
              >
                送信
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
