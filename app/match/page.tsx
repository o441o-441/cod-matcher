"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Tutorial } from "@/components/Tutorial";
import { playMatchFound } from "@/lib/sounds";
import { usePageView } from "@/lib/usePageView";
import { LoadingSkeleton } from "@/components/UIState";
import QueueRadar from '@/components/QueueRadar';

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
  { title: "ソロ参加", body: "パーティを作成して「対戦開始」を押すとキューに入ります。1人でもパーティを作れるので、チームメンバーがいなくてもOKです。" },
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
    current_rating: number | null;
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

function partyLabelText(size: number): string {
  if (size === 1) return "SOLO";
  if (size === 2) return "DUO";
  if (size === 3) return "TRIO";
  if (size === 4) return "FULL";
  return "---";
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
  const [queueWaitingCount, setQueueWaitingCount] = useState<number | null>(null);

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

      // Phase 1: profile + party membership (always), invites + friends + team (initial only)
      const [profileRes, partyMemberRes, pendingInvitesRes, friendsRes, membershipRes] = await Promise.all([
        supabase.from("profiles").select("id,display_name,current_rating,is_banned,is_onboarded").eq("id", uid).maybeSingle<ProfileRow>(),
        supabase.from("party_members").select("id,party_id,user_id").eq("user_id", uid).returns<PartyMemberRow[]>(),
        opts?.silent ? Promise.resolve({ data: null, error: null }) : supabase.rpc("rpc_list_my_pending_party_invites"),
        opts?.silent ? Promise.resolve({ data: null, error: null }) : supabase.rpc("rpc_list_my_friends"),
        opts?.silent ? Promise.resolve({ data: null, error: null }) : supabase.from("team_members").select("team_id").eq("user_id", uid).maybeSingle<{ team_id: string }>(),
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

      // Set team info from parallel result (skip on silent reload)
      if (!opts?.silent && membershipRes.data?.team_id) {
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
      } else if (!opts?.silent) {
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
          supabase.from("party_members").select("id,party_id,user_id,profiles!party_members_user_id_fkey(id,display_name,current_rating)").eq("party_id", activeParty.id).returns<PartyMemberRow[]>(),
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

        // 待機中のプレイヤー数を取得
        if (waitingRes.data) {
          const { count } = await supabase
            .from("queue_entries")
            .select("id", { count: "exact", head: true })
            .eq("status", "waiting")
            .eq("queue_type", waitingRes.data.queue_type);
          setQueueWaitingCount(count ?? 0);
        } else {
          setQueueWaitingCount(null);
        }

        if (matchedRes.error) throw matchedRes.error;
        const matchedIds = (matchedRes.data ?? []).map((x) => x.id);
        setMyMatchedEntryIds(matchedIds);

        if (matchedIds.length > 0) {
          const { data: activeMatchData, error: activeMatchError } = await supabase.rpc("rpc_get_active_match_for_queue_entries", {
            p_queue_entry_ids: matchedIds,
          });
          if (activeMatchError) throw activeMatchError;
          const rows = (activeMatchData ?? []) as Array<{ match_id: string; match_status: string; matched_at: string }>;
          if (rows.length > 0) {
            setMyActiveMatch({ id: rows[0].match_id, status: rows[0].match_status, matched_at: rows[0].matched_at });
          } else { setMyActiveMatch(null); }
        } else { setMyActiveMatch(null); }
      } else {
        // Auto-create solo party if none exists
        if (resolvedProfile && !resolvedProfile.is_banned) {
          try {
            const { error: autoErr } = await supabase.rpc("rpc_create_party", { p_source_team_id: null });
            if (!autoErr) {
              // Reload to pick up the new party
              loadBusyRef.current = false;
              await loadMyState();
              return;
            }
          } catch {
            // Ignore auto-create failure, show empty state
          }
        }
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

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void loadMyState({ silent: true }), 500);
    };

    const channel = supabase
      .channel(`match-page-auto-${myUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "parties" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "party_members" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "party_invites" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_team_members" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, debouncedLoad)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [myUserId, loadMyState, supabase]);

  useEffect(() => {
    const interval = setInterval(() => void loadMyState({ silent: true }), 15000);
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
    }, 5000);

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

      if (error) {
        if (error.message?.includes('already matched')) {
          setInfoText("マッチが成立しました。キャンセルできません。");
          await loadMyState();
          return;
        }
        throw error;
      }

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

  /* ── Compute avg rating for party ── */
  const avgRating = useMemo(() => {
    if (!myWaitingEntry) return profile?.current_rating ?? 0;
    return myWaitingEntry.avg_rating;
  }, [myWaitingEntry, profile]);

  if (loading) {
    return (
      <main><LoadingSkeleton cards={3} /></main>
    );
  }

  /* ── Slot rendering helpers ── */
  const slots = Array.from({ length: 4 }, (_, i) => myPartyMembers[i] ?? null);

  return (
    <main className="page">
      {!rulesAccepted && <RulesGate onAccept={handleAcceptRules} />}

      {/* ── Header ── */}
      <div className="rowx" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">RANKED MATCHMAKING</span>
          <h1 style={{ marginBottom: 0 }}>マッチング</h1>
          <p className="muted" style={{ marginTop: 4 }}>招待制パーティ + 自動マッチ生成</p>
        </div>
        <div className="row">
          <Tutorial pageKey="match" steps={MATCH_TUTORIAL} />
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.push("/menu")}
          >
            メニューに戻る
          </button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {errorText && (
        <div className="card" style={{ borderColor: 'rgba(255,77,109,0.35)', background: 'var(--danger-soft)', marginBottom: 16 }}>
          <span className="danger" style={{ fontSize: 14 }}>{errorText}</span>
        </div>
      )}
      {infoText && (
        <div className="card" style={{ borderColor: 'rgba(0,245,160,0.35)', background: 'var(--success-soft)', marginBottom: 16 }}>
          <span className="success" style={{ fontSize: 14 }}>{infoText}</span>
        </div>
      )}

      {/* ── Onboarding warning ── */}
      {profile && !profile.is_onboarded && (
        <div className="card" style={{ borderColor: 'rgba(255,176,32,0.35)', background: 'var(--amber-soft)', marginBottom: 16 }}>
          <span className="amber" style={{ fontSize: 14 }}>
            初期設定が未完了のため対戦に参加できません。
            <button type="button" onClick={() => router.push("/onboarding")} className="btn-ghost btn-sm" style={{ marginLeft: 8 }}>
              初期設定を完了する
            </button>
          </span>
        </div>
      )}

      {/* ── No profile warning ── */}
      {!profile && (
        <div className="card" style={{ marginBottom: 16 }}>
          <span className="muted">プロフィールが見つかりません。ログイン状態を確認してください。</span>
        </div>
      )}

      {/* ── 2-column grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

        {/* ════════ LEFT COLUMN ════════ */}
        <div className="stack">

          {/* ── Pending invites (if any) ── */}
          {myPendingInvites.length > 0 && (
            <div className="card-strong">
              <div className="sec-title">自分宛の招待</div>
              <div className="stack">
                {myPendingInvites.map((inv) => (
                  <div key={inv.invite_id} className="card">
                    <div className="rowx">
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>
                          {inv.inviter_display_name}
                        </div>
                        <div className="dim" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                          {inv.party_id.slice(0, 8)}... / {new Date(inv.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="row">
                        <button
                          onClick={() => handleAcceptInvite(inv.invite_id)}
                          disabled={busy}
                          className="btn-primary btn-sm"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => handleRejectInvite(inv.invite_id)}
                          disabled={busy}
                          className="btn-danger btn-sm"
                        >
                          拒否
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Party panel ── */}
          <div className="card-strong">
            <div className="sec-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              パーティ編成
            </div>

            {/* Party header row */}
            <div className="rowx" style={{ marginBottom: 16 }}>
              <div className="row">
                <span className="badge">
                  <span className="badge-dot" />
                  {partyLabelText(myPartySize)} {myPartySize}/4
                </span>
                {myParty && (
                  <span className="badge" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-soft)' }}>
                    {myParty.status === 'open' ? '待機可' : myParty.status === 'queued' ? 'キュー中' : myParty.status === 'matched' ? 'マッチ済' : myParty.status === 'cancelled' ? 'キャンセル' : myParty.status}
                  </span>
                )}
              </div>
              <span className="mono muted" style={{ fontSize: 13 }}>AVG {avgRating}</span>
            </div>

            {/* 4-slot grid */}
            <div className="g4" style={{ marginBottom: 16 }}>
              {slots.map((member, i) => {
                if (member) {
                  const isLeader = myParty && member.user_id === myParty.leader_user_id;
                  const name = member.profiles?.display_name ?? member.user_id.slice(0, 8);
                  return (
                    <div
                      key={member.id}
                      className="card glow-hover"
                      style={{ position: 'relative', textAlign: 'center', padding: '16px 8px', cursor: 'pointer' }}
                      onClick={() => router.push(`/users/${member.user_id}`)}
                    >
                      {/* Crown for leader */}
                      {isLeader && (
                        <div style={{ position: 'absolute', top: 6, left: 8, color: 'var(--amber)', fontSize: 14 }} title="リーダー">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 19h19v2h-19zM22.7 7.3l-4.6 5.2-5.1-7.2L8 12.5 2.3 7.3 4.1 18h15.8z"/></svg>
                        </div>
                      )}
                      {/* Avatar */}
                      <div className="avatar" style={{ width: 48, height: 48, fontSize: 16, margin: '0 auto 8px' }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      {/* Name */}
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </div>
                      {/* SR */}
                      <div className="row" style={{ justifyContent: 'center', marginTop: 6, gap: 6 }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>SR {member.profiles?.current_rating ?? '---'}</span>
                      </div>
                    </div>
                  );
                }
                // Empty slot
                return (
                  <div
                    key={`empty-${i}`}
                    className="card"
                    style={{
                      borderStyle: 'dashed',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '24px 8px',
                      opacity: 0.6,
                      transition: 'opacity 0.15s',
                      cursor: 'default',
                      minHeight: 140,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.6'; }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span className="dim" style={{ fontSize: 12, marginTop: 6 }}>招待</span>
                  </div>
                );
              })}
            </div>

            {/* Party create / invite / manage buttons */}
            {!myParty && (
              <div className="row" style={{ marginBottom: 12 }}>
                <button onClick={handleCreateParty} disabled={!canCreateParty} className="btn-primary">
                  パーティ作成
                </button>
                {myTeam && (
                  <button
                    onClick={handleCreatePartyFromTeam}
                    disabled={!canCreateParty}
                    title={`チーム「${myTeam.name}」のメンバー全員に招待を送ります`}
                  >
                    チーム「{myTeam.name}」で作成＋全員招待
                    {myTeam.members.length > 0 && `（${myTeam.members.length}名）`}
                  </button>
                )}
              </div>
            )}

            {/* Invite section (when party exists, leader, not full, not queued) */}
            {myParty && isPartyLeader && myPartySize < 4 && !isWaiting && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="rowx" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>メンバー招待</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => router.push("/friends")}>
                    フレンド管理
                  </button>
                </div>
                {friends.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    招待できるフレンドがいません。
                    <button type="button" className="btn-ghost btn-sm" onClick={() => router.push("/friends")} style={{ marginLeft: 6 }}>
                      フレンドを追加する
                    </button>
                  </div>
                ) : (
                  <div className="row">
                    <select
                      value={selectedFriendId}
                      onChange={(e) => setSelectedFriendId(e.target.value)}
                      disabled={busy}
                      style={{ flex: 1 }}
                    >
                      <option value="">フレンドを選択...</option>
                      {friends
                        .filter((f) => !myPartyMembers.some((m) => m.user_id === f.friend_user_id))
                        .map((f) => (
                          <option key={f.friend_user_id} value={f.friend_user_id}>
                            {f.friend_display_name ?? f.friend_user_id}
                          </option>
                        ))}
                    </select>
                    <button onClick={handleInviteToParty} disabled={busy || !selectedFriendId} className="btn-primary btn-sm">
                      招待送信
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Invite history */}
            {myParty && myPartyInvites.length > 0 && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="stat-label" style={{ marginBottom: 8 }}>招待履歴</div>
                <div className="stack-sm">
                  {myPartyInvites.map((inv) => (
                    <div key={inv.id} className="rowx" style={{ fontSize: 12 }}>
                      <span className="mono dim">{inv.invitee_user_id.slice(0, 12)}...</span>
                      <span className={`badge ${inv.status === 'accepted' ? 'success' : inv.status === 'rejected' ? 'danger' : inv.status === 'cancelled' ? 'amber' : ''}`} style={{ fontSize: 9 }}>
                        {inv.status === 'pending' ? '承認待ち' : inv.status === 'accepted' ? '承認済み' : inv.status === 'rejected' ? '拒否' : inv.status === 'cancelled' ? 'キャンセル' : inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Queue / disband / leave buttons */}
            {myParty && (
              <div className="row">
                {canQueueExistingParty && (
                  <button onClick={handleQueueExistingParty} className="btn-primary">
                    対戦開始
                  </button>
                )}
                {isPartyLeader && myPartyMembers.length > 1 ? (
                  <button onClick={handleDisbandParty} disabled={busy || isWaiting} className="btn-danger">
                    パーティ解散
                  </button>
                ) : !isPartyLeader ? (
                  <button onClick={handleLeaveParty} disabled={busy || isWaiting} className="btn-danger">
                    パーティ脱退
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Queue waiting state ── */}
          {isWaiting && (() => {
            const pct = Math.min(waitingSeconds / 330, 1);
            const phase =
              waitingSeconds < 90 ? 0
              : waitingSeconds < 120 ? 1
              : waitingSeconds < 240 ? 2
              : 3;
            const messages = [
              "近いレートの同じ構成の相手を探しています...",
              "検索範囲を広げています...",
              "さらに検索範囲を広げています...",
              "幅広い相手を検索中です...",
            ];
            return (
              <div className="card-strong">
                {/* SEARCHING badge with pulsing dot */}
                <div style={{ marginBottom: 16 }}>
                  <span className="badge magenta">
                    <span className="badge-dot" style={{ animation: 'pulse-glow 1.5s ease-in-out infinite' }} />
                    SEARCHING
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <QueueRadar size={160} waitingCount={queueWaitingCount ?? undefined} />
                  <div style={{ flex: 1 }}>
                    {/* Large searching text */}
                    <div className="flicker" style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 44,
                      fontWeight: 800,
                      lineHeight: 1.1,
                      background: 'linear-gradient(135deg, #fff, var(--cyan))',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      marginBottom: 16,
                    }}>
                      対戦相手を探索中<span style={{ animation: 'flicker 1.2s infinite' }}>...</span>
                    </div>

                    {/* Progress bar */}
                    <div className="bar" style={{ marginBottom: 16 }}>
                      <div className="bar-fill" style={{ width: `${Math.max(pct * 100, 5)}%` }} />
                    </div>

                    {/* Stats row */}
                    <div className="row" style={{ gap: 24 }}>
                      <div className="stat">
                        <span className="stat-label">キュー時間</span>
                        <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--cyan)' }}>
                          {Math.floor(waitingSeconds / 60)}:{String(waitingSeconds % 60).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">パーティ</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
                          {partyLabelText(myPartySize)} ({myPartySize})
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">範囲拡大 LV</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
                          {myWaitingEntry?.wait_expand_level ?? phase}
                        </span>
                      </div>
                    </div>

                    <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>{messages[phase]}</p>
                  </div>
                </div>

                {/* Cancel button */}
                <div style={{ marginTop: 16 }}>
                  <button onClick={handleCancelQueue} disabled={busy} className="btn-danger">
                    待機解除
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Not queued placeholder ── */}
          {!isWaiting && !myActiveMatch && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <span className="muted">待機していません。パーティを作成して「対戦開始」を押してください。</span>
            </div>
          )}

          {/* ── Match found ── */}
          {myActiveMatch && (
            <div className="card-strong enter" style={{ textAlign: 'center' }}>
              <span className="badge success" style={{ marginBottom: 16 }}>
                <span className="badge-dot" />
                MATCH FOUND
              </span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 44,
                fontWeight: 800,
                background: 'linear-gradient(135deg, #fff, var(--cyan))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                marginBottom: 16,
              }}>
                マッチ成立
              </div>

              {/* Team comparison */}
              <div className="row" style={{ justifyContent: 'center', gap: 24, marginBottom: 16 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="side-chip alpha">ALPHA</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--alpha)' }}>TEAM A</span>
                </div>
                <span className="dim" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800 }}>VS</span>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--bravo)' }}>TEAM B</span>
                  <span className="side-chip bravo">BRAVO</span>
                </div>
              </div>

              <button onClick={handleGoToMyMatch} disabled={busy} className="btn-primary btn-lg">
                成立した試合へ移動
              </button>
            </div>
          )}
        </div>

        {/* ════════ RIGHT COLUMN (sidebar) ════════ */}
        <div className="stack">

          {/* Queue status */}
          <div className="card-strong">
            <div className="sec-title">現在のキュー状況</div>
            <div className="stack">
              <div className="rowx">
                <span className="stat-label">ステータス</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>
                  {isMatched ? '成立' : isWaiting ? 'キュー中' : myParty ? '待機可' : '未参加'}
                </span>
              </div>
              <div className="div" />
              <div className="rowx">
                <span className="stat-label">パーティ</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>
                  {myParty ? `${partyLabelText(myPartySize)} (${myPartySize}/4)` : '--'}
                </span>
              </div>
              <div className="div" />
              <div className="rowx">
                <span className="stat-label">AVG レート</span>
                <span className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                  {myParty ? avgRating : '--'}
                </span>
              </div>
              <div className="div" />
              <div className="rowx">
                <span className="stat-label">キュータイプ</span>
                <span className="badge" style={{ fontSize: 9 }}>RANKED</span>
              </div>
              {isWaiting && (
                <>
                  <div className="div" />
                  <div className="rowx">
                    <span className="stat-label">待機時間</span>
                    <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: 'var(--cyan)' }}>
                      {Math.floor(waitingSeconds / 60)}:{String(waitingSeconds % 60).padStart(2, "0")}
                    </span>
                  </div>
                </>
              )}
              <div className="div" />
              <div className="rowx">
                <span className="stat-label">リーダー</span>
                <span style={{ fontSize: 13 }}>
                  {isPartyLeader ? 'あなた' : myParty ? 'メンバー' : '--'}
                </span>
              </div>
            </div>
          </div>

          {/* Rules card */}
          <div className="card">
            <div className="sec-title">ルール</div>
            <div className="stack-sm" style={{ fontSize: 13 }}>
              <div className="muted">
                <span style={{ color: 'var(--cyan)', marginRight: 6 }}>&#8226;</span>
                パーティ人数が多いほどレート補正あり
              </div>
              <div className="muted">
                <span style={{ color: 'var(--cyan)', marginRight: 6 }}>&#8226;</span>
                ソロ参加者は補正なし（有利）
              </div>
              <div className="muted">
                <span style={{ color: 'var(--cyan)', marginRight: 6 }}>&#8226;</span>
                フルパーティ同士なら補正相殺
              </div>
              <div className="muted">
                <span style={{ color: 'var(--cyan)', marginRight: 6 }}>&#8226;</span>
                待ち時間が長いほど検索範囲拡大
              </div>
              <div className="muted">
                <span style={{ color: 'var(--cyan)', marginRight: 6 }}>&#8226;</span>
                3秒間隔で自動マッチング試行
              </div>
            </div>

            {/* Rating correction breakdown */}
            <div className="div" />
            <div className="g4" style={{ gap: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-label">ソロ</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cyan)', marginTop: 4 }}>補正なし</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-label">デュオ</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>やや不利</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-label">トリオ</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>不利</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-label">フルパ</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', marginTop: 4 }}>最も不利</div>
              </div>
            </div>
          </div>

          {/* How-to card */}
          <div className="card">
            <div className="sec-title">使い方</div>
            <div className="stack-sm" style={{ fontSize: 13 }}>
              <div className="muted"><span style={{ color: 'var(--violet)', marginRight: 8, fontWeight: 700 }}>1.</span>パーティを作成します（ソロでもOK）</div>
              <div className="muted"><span style={{ color: 'var(--violet)', marginRight: 8, fontWeight: 700 }}>2.</span>チームメンバーやフレンドを招待</div>
              <div className="muted"><span style={{ color: 'var(--violet)', marginRight: 8, fontWeight: 700 }}>3.</span>「対戦開始」でキューイン</div>
              <div className="muted"><span style={{ color: 'var(--violet)', marginRight: 8, fontWeight: 700 }}>4.</span>自動マッチング（3秒間隔）</div>
              <div className="muted"><span style={{ color: 'var(--violet)', marginRight: 8, fontWeight: 700 }}>5.</span>マッチ成立でバンピック画面へ自動遷移</div>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
