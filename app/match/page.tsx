"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Tutorial } from "@/components/Tutorial";
import { playMatchFound } from "@/lib/sounds";
import { usePageView } from "@/lib/usePageView";

const RULES_KEY = "rules_accepted_v1";

function RulesGate({ onAccept }: { onAccept: () => void }) {
  const router = useRouter();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 10000,
      }}
    >
      <div
        className="card-strong"
        style={{ width: "100%", maxWidth: 520, padding: 24 }}
      >
        <h2 style={{ marginTop: 0 }}>ルール確認</h2>
        <p style={{ lineHeight: 1.8 }}>
          ASCENT では GA（ジェントルマンズアグリーメント）に基づいたルールを採用しています。
          対戦に参加する前に、以下のルールを確認してください。
        </p>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="stack" style={{ fontSize: "0.9rem" }}>
            <p>・使用可能な武器 / アタッチメント / パーク / 装備に制限があります</p>
            <p>・グリッチ（スネーク / 階段等）の使用は禁止です</p>
            <p>・コンバーター / チートの使用は即時停止の対象です</p>
            <p>・試合結果は相手チームの承認で確定します</p>
            <p>・違反者は通報 → 運営対応または監視ユーザーによる即時停止となります</p>
          </div>
        </div>

        <div className="section row" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => router.push("/rules")}
            style={{ background: "rgba(255,255,255,0.08)", boxShadow: "none" }}
          >
            ルール詳細を見る
          </button>
          <button type="button" onClick={onAccept}>
            ルールを遵守して対戦します
          </button>
        </div>
      </div>
    </div>
  );
}

const MATCH_TUTORIAL = [
  { title: "マッチング画面", body: "ここで対戦相手を探します。パーティを作成してキューに参加すると、自動でマッチングが行われます。" },
  { title: "ソロ参加", body: "パーティを作成して「既存パーティで待機開始」を押すとキューに入ります。1人でもパーティを作れるので、チームメンバーがいなくてもOKです。" },
  { title: "パーティ参加", body: "チームメンバーやフレンドを招待してパーティを組むこともできます。パーティリーダーがキューに入れます。" },
  { title: "自動マッチング", body: "キューに入ると3秒ごとに自動でマッチングを試みます。マッチが成立するとバンピック画面に自動遷移します。" },
];

type ProfileRow = {
  id: string;
  display_name: string;
  current_rating: number;
  is_banned: boolean;
  is_onboarded: boolean;
};

type PartyRow = {
  id: string;
  leader_user_id: string;
  source_team_id: string | null;
  party_type: "solo" | "duo" | "trio" | "full";
  status: "open" | "queued" | "matched" | "cancelled" | "closed";
  created_at: string;
  updated_at: string;
};

type PartyMemberRow = {
  id: string;
  party_id: string;
  user_id: string;
  profiles?: {
    id: string;
    display_name: string;
  } | null;
};

type PartyInviteRow = {
  id: string;
  party_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  created_at: string;
  responded_at: string | null;
};

type PendingInviteListRow = {
  invite_id: string;
  party_id: string;
  inviter_user_id: string;
  inviter_display_name: string;
  invitee_user_id: string;
  created_at: string;
};

type QueueEntryRow = {
  id: string;
  party_id: string;
  queue_type: "ranked" | "casual" | "fullparty_only" | "mixed";
  status: "waiting" | "matched" | "cancelled" | "expired";
  party_size: number;
  avg_rating: number;
  min_rating: number | null;
  max_rating: number | null;
  party_size_bonus: number;
  wait_expand_level: number;
  created_at: string;
  matched_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
};

type MatchRow = {
  id: string;
  status: string;
  matched_at: string;
};

type RpcCreateMatchResult = {
  match_id: string;
  alpha_match_team_id: string;
  bravo_match_team_id: string;
  alpha_member_count: number;
  bravo_member_count: number;
};

function inferPartyLabel(size: number): "solo" | "duo" | "trio" | "full" | "invalid" {
  if (size === 1) return "solo";
  if (size === 2) return "duo";
  if (size === 3) return "trio";
  if (size === 4) return "full";
  return "invalid";
}

function isExpectedAutoMatchMiss(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized.includes("not enough compatible waiting players") ||
    normalized.includes("failed to split teams") ||
    normalized.includes("anchor waiting queue entry not found")
  );
}

function extractErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}

export default function MatchPage() {
  const router = useRouter();

  const [rulesAccepted, setRulesAccepted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);

  const [errorText, setErrorText] = useState<string | null>(null);
  const [infoText, setInfoText] = useState<string | null>(null);

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const queueType = "ranked" as const;

  type MyTeamMember = { auth_user_id: string; display_name: string | null };
  const [myTeam, setMyTeam] = useState<{ id: string; name: string; members: MyTeamMember[] } | null>(null);

  const [friends, setFriends] = useState<{ friend_user_id: string; friend_display_name: string | null }[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState("");

  const [myParty, setMyParty] = useState<PartyRow | null>(null);
  const [myPartyMembers, setMyPartyMembers] = useState<PartyMemberRow[]>([]);
  const [myPartyInvites, setMyPartyInvites] = useState<PartyInviteRow[]>([]);
  const [myPendingInvites, setMyPendingInvites] = useState<PendingInviteListRow[]>([]);
  const [myWaitingEntry, setMyWaitingEntry] = useState<QueueEntryRow | null>(null);

  const [, setMyMatchedEntryIds] = useState<string[]>([]);
  const [myActiveMatch, setMyActiveMatch] = useState<MatchRow | null>(null);

  const [waitingSeconds, setWaitingSeconds] = useState(0);

  usePageView('/match');

  const autoMatchBusyRef = useRef(false);
  const routePushedRef = useRef(false);
  const loadBusyRef = useRef(false);

  const clearMessages = () => {
    setErrorText(null);
    setInfoText(null);
  };

  const isWaiting = !!myWaitingEntry;
  const isMatched = !!myActiveMatch;
  const isPartyLeader = !!myParty && myParty.leader_user_id === myUserId;
  const myPartySize = myPartyMembers.length;
  const myPartyLabel = inferPartyLabel(myPartySize);

  const canCreateParty = useMemo(() => {
    if (!profile) return false;
    if (profile.is_banned) return false;
    if (busy) return false;
    if (myParty) return false;
    if (isMatched) return false;
    return true;
  }, [profile, busy, myParty, isMatched]);

  const canQueueExistingParty = useMemo(() => {
    if (!myParty) return false;
    if (!isPartyLeader) return false;
    if (busy) return false;
    if (isWaiting) return false;
    if (isMatched) return false;
    if (myPartySize < 1 || myPartySize > 4) return false;
    if (!["open", "cancelled", "matched"].includes(myParty.status)) return false;
    return true;
  }, [myParty, isPartyLeader, busy, isWaiting, isMatched, myPartySize]);

  const cachedUidRef = useRef<string | null>(null);

  const loadMyState = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent && loadBusyRef.current) return;
    loadBusyRef.current = true;
    if (!opts?.silent) {
      setLoading(true);
    }
    setErrorText(null);

    try {
      let uid = cachedUidRef.current;
      if (!uid) {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        uid = authSession?.user?.id ?? null;
        cachedUidRef.current = uid;
      }
      setMyUserId(uid);

      if (!uid) {
        setProfile(null);
        setMyParty(null);
        setMyPartyMembers([]);
        setMyPartyInvites([]);
        setMyPendingInvites([]);
        setMyWaitingEntry(null);
        setMyMatchedEntryIds([]);
        setMyActiveMatch(null);
        setMyTeam(null);
        if (!opts?.silent) setLoading(false);
        return;
      }

      // Phase 1: profile + party membership + pending invites + friends + team (parallel)
      const [profileRes, partyMemberRes, pendingInvitesRes, friendsRes, membershipRes] = await Promise.all([
        supabase.from("profiles").select("id,display_name,current_rating,is_banned,is_onboarded").eq("id", uid).maybeSingle<ProfileRow>(),
        supabase.from("party_members").select("id,party_id,user_id").eq("user_id", uid).returns<PartyMemberRow[]>(),
        supabase.rpc("rpc_list_my_pending_party_invites"),
        supabase.rpc("rpc_list_my_friends"),
        supabase.from("team_members").select("team_id").eq("user_id", uid).maybeSingle<{ team_id: string }>(),
      ]);

      if (profileRes.error) throw profileRes.error;

      let resolvedProfile = profileRes.data ?? null;
      if (!resolvedProfile || !resolvedProfile.is_onboarded) {
        const { data: legacyUser } = await supabase
          .from("users")
          .select("display_name,is_profile_complete")
          .eq("auth_user_id", uid)
          .maybeSingle<{ display_name: string | null; is_profile_complete: boolean | null }>();

        if (legacyUser?.is_profile_complete && legacyUser.display_name) {
          const { data: upserted, error: upsertError } = await supabase
            .from("profiles")
            .upsert({ id: uid, display_name: legacyUser.display_name, is_onboarded: true }, { onConflict: "id" })
            .select("id,display_name,current_rating,is_banned,is_onboarded")
            .maybeSingle<ProfileRow>();
          if (!upsertError && upserted) resolvedProfile = upserted;
        }
      }

      setProfile(resolvedProfile);

      if (!resolvedProfile || !resolvedProfile.is_onboarded) {
        setMyParty(null); setMyPartyMembers([]); setMyPartyInvites([]);
        setMyPendingInvites([]); setMyWaitingEntry(null); setMyMatchedEntryIds([]);
        setMyActiveMatch(null); setMyTeam(null);
        if (!opts?.silent) setLoading(false);
        return;
      }

      // Set pending invites & friends from parallel results
      if (!pendingInvitesRes.error) {
        setMyPendingInvites((pendingInvitesRes.data as PendingInviteListRow[] | null) ?? []);
      }
      if (!friendsRes.error) {
        setFriends((friendsRes.data as { friend_user_id: string; friend_display_name: string | null }[] | null) ?? []);
      }

      // Set team info from parallel result
      if (membershipRes.data?.team_id) {
        const [teamRes, memberRowsRes] = await Promise.all([
          supabase.from("teams").select("id, name").eq("id", membershipRes.data.team_id).maybeSingle<{ id: string; name: string }>(),
          supabase.from("team_members").select("user_id, profiles!inner(id, display_name)").eq("team_id", membershipRes.data.team_id),
        ]);

        type RawTeamMemberRow = {
          user_id: string;
          profiles: { id: string; display_name: string | null } | { id: string; display_name: string | null }[] | null;
        };

        const otherMembers: MyTeamMember[] = ((memberRowsRes.data ?? []) as RawTeamMemberRow[])
          .map((row) => {
            const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
            return { auth_user_id: row.user_id, display_name: p?.display_name ?? null };
          })
          .filter((m) => m.auth_user_id && m.auth_user_id !== uid);

        if (teamRes.data) {
          setMyTeam({ id: teamRes.data.id, name: teamRes.data.name, members: otherMembers });
        } else {
          setMyTeam(null);
        }
      } else {
        setMyTeam(null);
      }

      // Party data
      if (partyMemberRes.error) throw partyMemberRes.error;
      const partyIds = [...new Set((partyMemberRes.data ?? []).map((x) => x.party_id))];

      let partiesData: PartyRow[] = [];
      if (partyIds.length > 0) {
        const { data, error } = await supabase
          .from("parties")
          .select("id,leader_user_id,source_team_id,party_type,status,created_at,updated_at")
          .in("id", partyIds)
          .returns<PartyRow[]>();
        if (error) throw error;
        partiesData = data ?? [];
      }

      const activeParty =
        partiesData.find((p) => p.status === "queued") ||
        partiesData.find((p) => p.status === "matched") ||
        partiesData.find((p) => p.status === "open") ||
        partiesData.find((p) => p.status === "cancelled") ||
        null;

      setMyParty(activeParty);

      if (activeParty) {
        // Parallel: party members, invites, waiting entry, matched entries
        const [membersRes2, invitesRes, waitingRes, matchedRes] = await Promise.all([
          supabase.from("party_members").select("id,party_id,user_id,profiles!party_members_user_id_fkey(id,display_name)").eq("party_id", activeParty.id).returns<PartyMemberRow[]>(),
          supabase.from("party_invites").select("id,party_id,inviter_user_id,invitee_user_id,status,created_at,responded_at").eq("party_id", activeParty.id).order("created_at", { ascending: false }).returns<PartyInviteRow[]>(),
          supabase.from("queue_entries").select("id,party_id,queue_type,status,party_size,avg_rating,min_rating,max_rating,party_size_bonus,wait_expand_level,created_at,matched_at,cancelled_at,expired_at").eq("party_id", activeParty.id).eq("status", "waiting").order("created_at", { ascending: false }).limit(1).maybeSingle<QueueEntryRow>(),
          supabase.from("queue_entries").select("id,party_id,queue_type,status,party_size,avg_rating,min_rating,max_rating,party_size_bonus,wait_expand_level,created_at,matched_at,cancelled_at,expired_at").eq("party_id", activeParty.id).eq("status", "matched").returns<QueueEntryRow[]>(),
        ]);

        if (membersRes2.error) throw membersRes2.error;
        setMyPartyMembers(membersRes2.data ?? []);

        if (invitesRes.error) throw invitesRes.error;
        setMyPartyInvites(invitesRes.data ?? []);

        if (waitingRes.error) throw waitingRes.error;
        setMyWaitingEntry(waitingRes.data ?? null);

        if (matchedRes.error) throw matchedRes.error;
        const matchedIds = (matchedRes.data ?? []).map((x) => x.id);
        setMyMatchedEntryIds(matchedIds);

        if (matchedIds.length > 0) {
          const { data: mtmData, error: mtmError } = await supabase
            .from("match_team_members")
            .select("source_queue_entry_id,match_team_id")
            .in("source_queue_entry_id", matchedIds);
          if (mtmError) throw mtmError;

          const matchTeamIds = [...new Set(((mtmData ?? []) as Array<{ match_team_id: string | null }>).map((x) => x.match_team_id).filter((id): id is string => Boolean(id)))];

          if (matchTeamIds.length > 0) {
            const { data: matchTeamsData, error: matchTeamsError } = await supabase.from("match_teams").select("id,match_id").in("id", matchTeamIds);
            if (matchTeamsError) throw matchTeamsError;
            const matchIds = [...new Set(((matchTeamsData ?? []) as Array<{ match_id: string | null }>).map((x) => x.match_id).filter((id): id is string => Boolean(id)))];

            if (matchIds.length > 0) {
              const { data: matchesData, error: matchesError } = await supabase.from("matches").select("id,status,matched_at").in("id", matchIds).in("status", ["banpick", "ready", "in_progress", "report_pending"]).order("matched_at", { ascending: false }).limit(1).returns<MatchRow[]>();
              if (matchesError) throw matchesError;
              setMyActiveMatch((matchesData ?? [])[0] ?? null);
            } else { setMyActiveMatch(null); }
          } else { setMyActiveMatch(null); }
        } else { setMyActiveMatch(null); }
      } else {
        setMyPartyMembers([]); setMyPartyInvites([]);
        setMyWaitingEntry(null); setMyMatchedEntryIds([]); setMyActiveMatch(null);
      }
    } catch (e) {
      console.error("loadMyState error:", e);
      let message = "状態の読み込みに失敗しました。";
      if (e instanceof Error) {
        message = e.message;
      } else if (e && typeof e === "object" && "message" in e) {
        const m = (e as { message?: unknown }).message;
        if (typeof m === "string" && m.length > 0) message = m;
      }
      setErrorText(message);
    } finally {
      loadBusyRef.current = false;
      if (!opts?.silent) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    setRulesAccepted(!!localStorage.getItem(RULES_KEY));
  }, []);

  const handleAcceptRules = () => {
    localStorage.setItem(RULES_KEY, "1");
    setRulesAccepted(true);
  };

  useEffect(() => {
    void loadMyState();
  }, [loadMyState]);

  useEffect(() => {
    if (!myWaitingEntry?.created_at) {
      setWaitingSeconds(0);
      return;
    }

    const tick = () => {
      const created = new Date(myWaitingEntry.created_at).getTime();
      const now = Date.now();
      setWaitingSeconds(Math.max(0, Math.floor((now - created) / 1000)));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [myWaitingEntry?.created_at]);

  useEffect(() => {
    if (!myUserId) return;

    const channel = supabase
      .channel(`match-page-auto-${myUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "parties" }, () => void loadMyState({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "party_members" }, () => void loadMyState({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "party_invites" }, () => void loadMyState({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => void loadMyState({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "match_team_members" }, () => void loadMyState({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => void loadMyState({ silent: true }))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [myUserId, loadMyState, supabase]);

  useEffect(() => {
    const interval = setInterval(() => void loadMyState({ silent: true }), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attemptAutoMatch = useCallback(async () => {
    if (!myWaitingEntry?.id) return;
    if (!isPartyLeader) return;
    if (myActiveMatch?.id) return;
    if (autoMatchBusyRef.current) return;
    if (routePushedRef.current) return;

    autoMatchBusyRef.current = true;
    setAutoMatching(true);

    try {
      const { data, error } = await supabase.rpc("rpc_create_match_from_queue", {
        p_anchor_queue_entry_id: myWaitingEntry.id,
        p_queue_type: myWaitingEntry.queue_type,
      });

      if (error) {
        if (!isExpectedAutoMatchMiss(error.message)) {
          setErrorText(error.message);
        }
        // Race may have been lost (someone else matched us already).
        // Silent refresh so polling doesn't blank the page every cycle.
        await loadMyState({ silent: true });
        return;
      }

      const row = (data as RpcCreateMatchResult[] | null)?.[0];
      if (row?.match_id) {
        routePushedRef.current = true;
        setInfoText("マッチが成立しました。");
        playMatchFound();
        await loadMyState({ silent: true });
        router.push(`/match/${row.match_id}/banpick`);
      } else {
        await loadMyState({ silent: true });
      }
    } finally {
      autoMatchBusyRef.current = false;
      setAutoMatching(false);
    }
  }, [myWaitingEntry, isPartyLeader, myActiveMatch?.id, supabase, loadMyState, router]);

  useEffect(() => {
    if (!myActiveMatch?.id) return;
    if (routePushedRef.current) return;
    if (myActiveMatch.status === "banpick") {
      routePushedRef.current = true;
      setInfoText("マッチが成立しました。バンピック画面へ移動します。");
      playMatchFound();
      router.push(`/match/${myActiveMatch.id}/banpick`);
    }
  }, [myActiveMatch?.id, myActiveMatch?.status, router]);

  useEffect(() => {
    if (!isWaiting || !isPartyLeader || !!myActiveMatch) return;

    const timer = window.setInterval(() => {
      void attemptAutoMatch();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [isWaiting, isPartyLeader, myActiveMatch, attemptAutoMatch]);

  useEffect(() => {
    if (!myActiveMatch?.id) {
      routePushedRef.current = false;
    }
  }, [myActiveMatch?.id]);

  const handleCreateParty = async () => {
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_create_party", {
        p_source_team_id: null,
      });

      if (error) throw error;

      setInfoText("パーティを作成しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_create_party error:", e);
      setErrorText(extractErrorMessage(e, "パーティ作成に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePartyFromTeam = async () => {
    if (!myTeam) {
      setErrorText("固定チームに所属していません。");
      return;
    }
    if (myParty) {
      setErrorText("既にパーティがあります。");
      return;
    }

    clearMessages();
    setBusy(true);

    try {
      const { error: createError } = await supabase.rpc("rpc_create_party", {
        p_source_team_id: myTeam.id,
      });
      if (createError) throw createError;

      // 作成したパーティ ID を取得（リーダーが自分の最新の open/queued パーティ）
      const { data: newPartyRow, error: findPartyError } = await supabase
        .from("parties")
        .select("id")
        .eq("leader_user_id", myUserId ?? "")
        .in("status", ["open", "queued"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (findPartyError) throw findPartyError;

      const newPartyId = newPartyRow?.id ?? null;
      if (!newPartyId) {
        throw new Error("作成したパーティが見つかりませんでした。");
      }

      const failures: string[] = [];
      for (const m of myTeam.members) {
        const { error: inviteError } = await supabase.rpc("rpc_invite_to_party", {
          p_party_id: newPartyId,
          p_invitee_user_id: m.auth_user_id,
        });
        if (inviteError) {
          console.error("invite error for", m.auth_user_id, inviteError);
          failures.push(m.display_name ?? m.auth_user_id);
        }
      }

      if (failures.length > 0) {
        setInfoText(
          `パーティを作成し、招待を送信しました（${myTeam.members.length - failures.length}/${myTeam.members.length} 件成功）。失敗: ${failures.join(", ")}`
        );
      } else if (myTeam.members.length === 0) {
        setInfoText("パーティを作成しました（チームに他のメンバーはいません）。");
      } else {
        setInfoText(`パーティを作成し、${myTeam.members.length} 名に招待を送信しました。`);
      }

      await loadMyState();
    } catch (e) {
      console.error("create party from team error:", e);
      setErrorText(extractErrorMessage(e, "パーティ作成に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleInviteToParty = async () => {
    if (!myParty?.id) {
      setErrorText("パーティがありません。先にパーティを作成してください。");
      return;
    }

    const invitee = selectedFriendId.trim();
    if (!invitee) {
      setErrorText("招待するフレンドを選択してください。");
      return;
    }

    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_invite_to_party", {
        p_party_id: myParty.id,
        p_invitee_user_id: invitee,
      });

      if (error) throw error;

      setSelectedFriendId("");
      setInfoText("招待を送信しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_invite_to_party error:", e);
      setErrorText(extractErrorMessage(e, "招待送信に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_accept_party_invite", {
        p_invite_id: inviteId,
      });

      if (error) throw error;

      setInfoText("招待を承認しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_accept_party_invite error:", e);
      setErrorText(extractErrorMessage(e, "招待承認に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleRejectInvite = async (inviteId: string) => {
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_reject_party_invite", {
        p_invite_id: inviteId,
      });

      if (error) throw error;

      setInfoText("招待を拒否しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_reject_party_invite error:", e);
      setErrorText(extractErrorMessage(e, "招待拒否に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleQueueExistingParty = async () => {
    if (!myParty?.id) {
      setErrorText("パーティがありません。");
      return;
    }

    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_queue_existing_party", {
        p_party_id: myParty.id,
        p_queue_type: queueType,
      });

      if (error) throw error;

      setInfoText("パーティを待機に入れました。自動マッチングを開始します。");
      await loadMyState();
    } catch (e) {
      console.error("queue start error:", e);
      setErrorText(extractErrorMessage(e, "待機開始に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelQueue = async () => {
    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_cancel_queue", {
        p_queue_entry_id: myWaitingEntry?.id ?? null,
      });

      if (error) throw error;

      setInfoText("待機解除済み マッチング待機を終了しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_cancel_queue error:", e);
      setErrorText(extractErrorMessage(e, "待機解除に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleDisbandParty = async () => {
    if (!myParty?.id) {
      setErrorText("パーティがありません。");
      return;
    }

    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_disband_party", {
        p_party_id: myParty.id,
      });

      if (error) throw error;

      setInfoText("パーティを解散しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_disband_party error:", e);
      setErrorText(extractErrorMessage(e, "パーティ解散に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleLeaveParty = async () => {
    if (!myParty?.id) {
      setErrorText("パーティがありません。");
      return;
    }

    clearMessages();
    setBusy(true);

    try {
      const { error } = await supabase.rpc("rpc_leave_party", {
        p_party_id: myParty.id,
      });

      if (error) throw error;

      setInfoText("パーティから脱退しました。");
      await loadMyState();
    } catch (e) {
      console.error("rpc_leave_party error:", e);
      setErrorText(extractErrorMessage(e, "パーティ脱退に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleTryCreateMatch = async () => {
    if (!myWaitingEntry?.id) {
      setErrorText("待機中エントリーがありません。");
      return;
    }

    clearMessages();
    setBusy(true);

    try {
      const { data, error } = await supabase.rpc("rpc_create_match_from_queue", {
        p_anchor_queue_entry_id: myWaitingEntry.id,
        p_queue_type: myWaitingEntry.queue_type,
      });

      if (error) throw error;

      const row = (data as RpcCreateMatchResult[] | null)?.[0];
      if (row?.match_id) {
        routePushedRef.current = true;
        setInfoText("マッチが成立しました。");
        playMatchFound();
        await loadMyState();
        router.push(`/match/${row.match_id}/banpick`);
        return;
      }

      await loadMyState();
    } catch (e) {
      console.error("rpc_create_match_from_queue error:", e);
      setErrorText(extractErrorMessage(e, "マッチ生成に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const handleGoToMyMatch = () => {
    if (!myActiveMatch?.id) return;

    if (myActiveMatch.status === "banpick") {
      router.push(`/match/${myActiveMatch.id}/banpick`);
      return;
    }

    if (["ready", "in_progress", "report_pending"].includes(myActiveMatch.status)) {
      router.push(`/match/${myActiveMatch.id}/report`);
      return;
    }

    router.push(`/match/${myActiveMatch.id}/banpick`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 px-6 py-8 text-white">
        <div className="mx-auto max-w-6xl">読み込み中です...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {!rulesAccepted && <RulesGate onAccept={handleAcceptRules} />}
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h1 className="text-3xl font-bold">ASCENT マッチング</h1>
            <p className="mt-2 text-sm text-white/60">招待制パーティ + 自動マッチ生成</p>
          </div>
          <div className="flex gap-2">
            <Tutorial pageKey="match" steps={MATCH_TUTORIAL} />
            <button
              type="button"
              onClick={() => router.push("/menu")}
              className="rounded border border-white/20 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            >
              メニューに戻る
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">自分の情報</h2>

              {profile ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">プレイヤー</div>
                    <div className="mt-1 text-sm font-medium">{profile.display_name}</div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">現在レート</div>
                    <div className="mt-1 text-sm font-medium">{profile.current_rating}</div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">状態</div>
                    <div className="mt-1 text-sm font-medium">
                      {profile.is_banned ? "BAN中" : profile.is_onboarded ? "利用可能" : "初期設定未完了"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-white/60">
                  プロフィールが見つかりません。ログイン状態を確認してください。
                </div>
              )}

              {profile && !profile.is_onboarded && (
                <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  初期設定が未完了のため対戦に参加できません。
                  <button
                    type="button"
                    onClick={() => router.push("/onboarding")}
                    className="ml-2 underline"
                  >
                    初期設定を完了する
                  </button>
                </div>
              )}
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">パーティ作成 / 招待</h2>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleCreateParty}
                    disabled={!canCreateParty}
                    className="rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  >
                    パーティ作成
                  </button>

                  {myTeam && (
                    <button
                      onClick={handleCreatePartyFromTeam}
                      disabled={!canCreateParty}
                      className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      title={`チーム「${myTeam.name}」のメンバー全員に招待を送ります`}
                    >
                      チーム「{myTeam.name}」で作成＋全員招待
                      {myTeam.members.length > 0 && `（${myTeam.members.length}名）`}
                    </button>
                  )}
                </div>

                <div className="rounded border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 text-sm font-semibold">現在のパーティ</div>

                  {!myParty ? (
                    <div className="text-sm text-white/60">まだパーティはありません。</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">状態: {myParty.status === 'open' ? '待機可' : myParty.status === 'queued' ? 'キュー中' : myParty.status === 'matched' ? 'マッチ済' : myParty.status === 'cancelled' ? 'キャンセル' : myParty.status}</div>
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">
                          種別: {myPartySize === 1 ? 'ソロ' : myPartySize === 2 ? 'デュオ' : myPartySize === 3 ? 'トリオ' : myPartySize === 4 ? 'フル' : myPartyLabel}
                        </div>
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">人数: {myPartySize} 人</div>
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">
                          {isPartyLeader ? "あなたはリーダーです" : "参加メンバーです"}
                        </div>
                      </div>

                      <div className="rounded bg-white/5 p-3">
                        <div className="mb-2 text-xs text-white/50">メンバー</div>
                        <div className="space-y-1 text-sm text-white/80">
                          {myPartyMembers.map((m) => (
                            <div key={m.id}>
                              {m.profiles?.display_name ?? m.user_id}
                              {m.user_id === myParty.leader_user_id ? "（リーダー）" : ""}
                            </div>
                          ))}
                        </div>
                      </div>

                      {isPartyLeader && myPartySize < 4 && !isWaiting && (
                        <div className="rounded border border-white/10 bg-neutral-900 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-sm font-medium">メンバー招待</div>
                            <button
                              type="button"
                              onClick={() => router.push("/friends")}
                              className="text-xs text-white/60 underline"
                            >
                              フレンド管理
                            </button>
                          </div>

                          {friends.length === 0 ? (
                            <div className="text-sm text-white/60">
                              招待できるフレンドがいません。
                              <button
                                type="button"
                                onClick={() => router.push("/friends")}
                                className="ml-2 underline"
                              >
                                フレンドを追加する
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2 md:flex-row">
                              <select
                                value={selectedFriendId}
                                onChange={(e) => setSelectedFriendId(e.target.value)}
                                className="flex-1 rounded border border-white/15 bg-black px-3 py-2 text-sm outline-none"
                                disabled={busy}
                              >
                                <option value="">フレンドを選択...</option>
                                {friends
                                  .filter(
                                    (f) =>
                                      !myPartyMembers.some((m) => m.user_id === f.friend_user_id)
                                  )
                                  .map((f) => (
                                    <option key={f.friend_user_id} value={f.friend_user_id}>
                                      {f.friend_display_name ?? f.friend_user_id}
                                    </option>
                                  ))}
                              </select>
                              <button
                                onClick={handleInviteToParty}
                                disabled={busy || !selectedFriendId}
                                className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              >
                                招待送信
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="rounded bg-white/5 p-3">
                        <div className="mb-2 text-xs text-white/50">招待履歴</div>
                        {myPartyInvites.length === 0 ? (
                          <div className="text-sm text-white/50">招待はありません。</div>
                        ) : (
                          <div className="space-y-2 text-sm text-white/80">
                            {myPartyInvites.map((inv) => (
                              <div key={inv.id} className="rounded bg-black/30 px-3 py-2">
                                <div>招待先: {inv.invitee_user_id}</div>
                                <div className="mt-1 text-xs text-white/50">
                                  状態: {inv.status === 'pending' ? '承認待ち' : inv.status === 'accepted' ? '承認済み' : inv.status === 'rejected' ? '拒否' : inv.status === 'cancelled' ? 'キャンセル' : inv.status} / {new Date(inv.created_at).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {isPartyLeader ? (
                          <button
                            onClick={handleDisbandParty}
                            disabled={busy || isWaiting}
                            className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            パーティ解散
                          </button>
                        ) : (
                          <button
                            onClick={handleLeaveParty}
                            disabled={busy || isWaiting}
                            className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            パーティ脱退
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">待機 / 自動マッチング</h2>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleQueueExistingParty}
                    disabled={!canQueueExistingParty}
                    className="rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  >
                    既存パーティで待機開始
                  </button>

                  {isWaiting && (
                    <>
                      <button
                        onClick={handleCancelQueue}
                        disabled={busy}
                        className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        待機解除
                      </button>
                    </>
                  )}

                  {isMatched && (
                    <button
                      onClick={handleGoToMyMatch}
                      disabled={busy}
                      className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      成立した試合へ移動
                    </button>
                  )}
                </div>

                {isWaiting && (() => {
                  const pct = Math.min(waitingSeconds / 330, 1)
                  const phase =
                    waitingSeconds < 90 ? 0
                    : waitingSeconds < 120 ? 1
                    : waitingSeconds < 240 ? 2
                    : 3
                  const messages = [
                    "近いレートの同じ構成の相手を探しています...",
                    "検索範囲を広げています...",
                    "さらに検索範囲を広げています...",
                    "幅広い相手を検索中です...",
                  ]
                  return (
                    <div className="rounded border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">
                          {autoMatching ? "対戦相手を探しています" : "待機中"}
                        </div>
                        <div className="text-xs text-white/50">
                          {Math.floor(waitingSeconds / 60)}:{String(waitingSeconds % 60).padStart(2, "0")}
                        </div>
                      </div>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 4,
                          background: "rgba(140,160,220,0.15)",
                          overflow: "hidden",
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.max(pct * 100, 5)}%`,
                            borderRadius: 4,
                            background: "linear-gradient(90deg, var(--accent-cyan, #00e5ff), var(--accent-violet, #8b5cf6))",
                            transition: "width 1s ease",
                          }}
                        />
                      </div>
                      <p className="text-sm text-white/70">{messages[phase]}</p>
                      <p className="mt-2 text-xs text-white/40">
                        待ち時間が長いほど検索範囲が広がります。キャンセルすると最初からやり直しになります。
                      </p>
                    </div>
                  )
                })()}

                {!isWaiting && !myActiveMatch && (
                  <div className="rounded bg-black/20 p-3 text-sm text-white/50">
                    待機していません。パーティを作成して「既存パーティで待機開始」を押してください。
                  </div>
                )}

                {myActiveMatch && (
                  <div className="rounded border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm">
                    <div className="font-semibold">成立済み試合があります</div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">自分宛の招待</h2>

              {myPendingInvites.length === 0 ? (
                <div className="text-sm text-white/50">現在受け取っている招待はありません。</div>
              ) : (
                <div className="space-y-3">
                  {myPendingInvites.map((inv) => (
                    <div key={inv.invite_id} className="rounded border border-white/10 bg-black/20 p-3">
                      <div className="text-sm">
                        招待者: <span className="font-semibold">{inv.inviter_display_name}</span>
                      </div>
                      <div className="mt-1 text-xs text-white/50">パーティ: {inv.party_id.slice(0, 8)}...</div>
                      <div className="mt-1 text-xs text-white/50">
                        {new Date(inv.created_at).toLocaleString()}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handleAcceptInvite(inv.invite_id)}
                          disabled={busy}
                          className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => handleRejectInvite(inv.invite_id)}
                          disabled={busy}
                          className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          拒否
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">マッチングの仕組み</h2>
              <div className="space-y-3 text-sm text-white/75">
                <div className="rounded bg-black/20 p-3">
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>パーティ人数によるレート補正</p>
                  <p>パーティの人数が多いほど「強い」と見なされ、レート計算で補正がかかります。ソロで参加した場合、パーティに勝つとより多くのレートを獲得でき、負けても失うレートは少なくなります。</p>
                </div>
                <div className="rounded bg-black/20 p-3">
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div className="text-xs text-white/50">ソロ</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-cyan, #00e5ff)' }}>補正なし</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div className="text-xs text-white/50">デュオ</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>やや不利</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div className="text-xs text-white/50">トリオ</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>不利</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div className="text-xs text-white/50">フルパ</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--danger, #ff4d6d)' }}>最も不利</div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-white/40">
                  ソロプレイヤーが不利にならないよう、パーティ側にレートハンデが設定されています。フルパーティ同士なら補正は相殺されます。
                </p>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">使い方</h2>
              <div className="space-y-2 text-sm text-white/75">
                <div>1. パーティを作成します（ソロでもOK）</div>
                <div>2. チームメンバーやフレンドを招待して参加してもらいます</div>
                <div>3. 「既存パーティで待機開始」を押してキューに入ります</div>
                <div>4. 待機中は自動でマッチングを試みます（3秒間隔）</div>
                <div>5. マッチが成立したらバンピック画面に自動で移動します</div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}