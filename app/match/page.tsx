"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
    normalized.includes("failed to split teams into 4v4") ||
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

  const autoMatchBusyRef = useRef(false);
  const routePushedRef = useRef(false);

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

  const loadMyState = useCallback(async (opts?: { silent?: boolean }) => {
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

      const uid = user?.id ?? null;
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

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id,display_name,current_rating,is_banned,is_onboarded")
        .eq("id", uid)
        .maybeSingle<ProfileRow>();

      if (profileError) throw profileError;

      // 旧 users テーブル（is_profile_complete）で onboarding 済みなのに、
      // 新 profiles テーブルが未作成 / is_onboarded=false の場合は自己修復で同期する。
      let resolvedProfile = profileData ?? null;
      if (!resolvedProfile || !resolvedProfile.is_onboarded) {
        const { data: legacyUser } = await supabase
          .from("users")
          .select("display_name,is_profile_complete")
          .eq("auth_user_id", uid)
          .maybeSingle<{ display_name: string | null; is_profile_complete: boolean | null }>();

        if (legacyUser?.is_profile_complete && legacyUser.display_name) {
          const { data: upserted, error: upsertError } = await supabase
            .from("profiles")
            .upsert(
              {
                id: uid,
                display_name: legacyUser.display_name,
                is_onboarded: true,
              },
              { onConflict: "id" }
            )
            .select("id,display_name,current_rating,is_banned,is_onboarded")
            .maybeSingle<ProfileRow>();

          if (!upsertError && upserted) {
            resolvedProfile = upserted;
          }
        }
      }

      setProfile(resolvedProfile);

      // 初期設定が未完了なら、対戦関連のロードはスキップする。
      // RPC や RLS が onboarded を前提とすることがあり、無理にロードすると失敗するため。
      if (!resolvedProfile || !resolvedProfile.is_onboarded) {
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

      const { data: partyMemberData, error: partyMemberError } = await supabase
        .from("party_members")
        .select("id,party_id,user_id")
        .eq("user_id", uid)
        .returns<PartyMemberRow[]>();

      if (partyMemberError) throw partyMemberError;

      const partyIds = [...new Set((partyMemberData ?? []).map((x) => x.party_id))];

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
        const { data: membersData, error: membersError } = await supabase
          .from("party_members")
          .select("id,party_id,user_id,profiles!party_members_user_id_fkey(id,display_name)")
          .eq("party_id", activeParty.id)
          .returns<PartyMemberRow[]>();

        if (membersError) throw membersError;
        setMyPartyMembers(membersData ?? []);

        const { data: invitesData, error: invitesError } = await supabase
          .from("party_invites")
          .select("id,party_id,inviter_user_id,invitee_user_id,status,created_at,responded_at")
          .eq("party_id", activeParty.id)
          .order("created_at", { ascending: false })
          .returns<PartyInviteRow[]>();

        if (invitesError) throw invitesError;
        setMyPartyInvites(invitesData ?? []);

        const { data: waitingEntryData, error: waitingEntryError } = await supabase
          .from("queue_entries")
          .select(
            "id,party_id,queue_type,status,party_size,avg_rating,min_rating,max_rating,party_size_bonus,wait_expand_level,created_at,matched_at,cancelled_at,expired_at"
          )
          .eq("party_id", activeParty.id)
          .eq("status", "waiting")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<QueueEntryRow>();

        if (waitingEntryError) throw waitingEntryError;
        setMyWaitingEntry(waitingEntryData ?? null);

        const { data: matchedEntriesData, error: matchedEntriesError } = await supabase
          .from("queue_entries")
          .select(
            "id,party_id,queue_type,status,party_size,avg_rating,min_rating,max_rating,party_size_bonus,wait_expand_level,created_at,matched_at,cancelled_at,expired_at"
          )
          .eq("party_id", activeParty.id)
          .eq("status", "matched")
          .returns<QueueEntryRow[]>();

        if (matchedEntriesError) throw matchedEntriesError;

        const matchedIds = (matchedEntriesData ?? []).map((x) => x.id);
        setMyMatchedEntryIds(matchedIds);

        if (matchedIds.length > 0) {
          const { data: mtmData, error: mtmError } = await supabase
            .from("match_team_members")
            .select("source_queue_entry_id,match_team_id")
            .in("source_queue_entry_id", matchedIds);

          if (mtmError) throw mtmError;

          const matchTeamIds = [
            ...new Set(
              ((mtmData ?? []) as Array<{ match_team_id: string | null }>)
                .map((x) => x.match_team_id)
                .filter((id): id is string => Boolean(id))
            ),
          ];

          if (matchTeamIds.length > 0) {
            const { data: matchTeamsData, error: matchTeamsError } = await supabase
              .from("match_teams")
              .select("id,match_id")
              .in("id", matchTeamIds);

            if (matchTeamsError) throw matchTeamsError;

            const matchIds = [
              ...new Set(
                ((matchTeamsData ?? []) as Array<{ match_id: string | null }>)
                  .map((x) => x.match_id)
                  .filter((id): id is string => Boolean(id))
              ),
            ];

            if (matchIds.length > 0) {
              const { data: matchesData, error: matchesError } = await supabase
                .from("matches")
                .select("id,status,matched_at")
                .in("id", matchIds)
                .in("status", ["banpick", "ready", "in_progress", "report_pending"])
                .order("matched_at", { ascending: false })
                .limit(1)
                .returns<MatchRow[]>();

              if (matchesError) throw matchesError;
              setMyActiveMatch((matchesData ?? [])[0] ?? null);
            } else {
              setMyActiveMatch(null);
            }
          } else {
            setMyActiveMatch(null);
          }
        } else {
          setMyActiveMatch(null);
        }
      } else {
        setMyPartyMembers([]);
        setMyPartyInvites([]);
        setMyWaitingEntry(null);
        setMyMatchedEntryIds([]);
        setMyActiveMatch(null);
      }

      const { data: pendingInvitesData, error: pendingInvitesError } = await supabase.rpc(
        "rpc_list_my_pending_party_invites"
      );

      if (pendingInvitesError) throw pendingInvitesError;
      setMyPendingInvites((pendingInvitesData as PendingInviteListRow[] | null) ?? []);

      const { data: friendsData, error: friendsError } = await supabase.rpc("rpc_list_my_friends");
      if (friendsError) {
        console.error("rpc_list_my_friends error:", friendsError);
      } else {
        setFriends(
          (friendsData as { friend_user_id: string; friend_display_name: string | null }[] | null) ?? []
        );
      }

      // 固定チーム情報（team_members.user_id は profiles.id = auth.uid()）
      const { data: myMembership } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("user_id", uid)
        .maybeSingle<{ team_id: string }>();

      if (myMembership?.team_id) {
        const { data: teamRow } = await supabase
          .from("teams")
          .select("id, name")
          .eq("id", myMembership.team_id)
          .maybeSingle<{ id: string; name: string }>();

        const { data: memberRows } = await supabase
          .from("team_members")
          .select("user_id, profiles!inner(id, display_name)")
          .eq("team_id", myMembership.team_id);

        type RawTeamMemberRow = {
          user_id: string;
          profiles:
            | { id: string; display_name: string | null }
            | { id: string; display_name: string | null }[]
            | null;
        };

        const otherMembers: MyTeamMember[] = ((memberRows ?? []) as RawTeamMemberRow[])
          .map((row) => {
            const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
            return { auth_user_id: row.user_id, display_name: p?.display_name ?? null };
          })
          .filter((m) => m.auth_user_id && m.auth_user_id !== uid);

        if (teamRow) {
          setMyTeam({ id: teamRow.id, name: teamRow.name, members: otherMembers });
        } else {
          setMyTeam(null);
        }
      } else {
        setMyTeam(null);
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
      if (!opts?.silent) setLoading(false);
    }
  }, [supabase]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "parties" }, () => void loadMyState())
      .on("postgres_changes", { event: "*", schema: "public", table: "party_members" }, () => void loadMyState())
      .on("postgres_changes", { event: "*", schema: "public", table: "party_invites" }, () => void loadMyState())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => void loadMyState())
      .on("postgres_changes", { event: "*", schema: "public", table: "match_team_members" }, () => void loadMyState())
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => void loadMyState())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [myUserId, loadMyState, supabase]);

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
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h1 className="text-3xl font-bold">ASCENT マッチング</h1>
            <p className="mt-2 text-sm text-white/60">招待制パーティ + 自動マッチ生成</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/menu")}
            className="rounded border border-white/20 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          >
            メニューに戻る
          </button>
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
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">状態: {myParty.status}</div>
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">
                          種別: {myPartyLabel === "invalid" ? myParty.party_type : myPartyLabel}
                        </div>
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">人数: {myPartySize} 人</div>
                        <div className="rounded bg-white/5 px-3 py-2 text-sm">
                          {isPartyLeader ? "あなたはLeaderです" : "参加メンバーです"}
                        </div>
                      </div>

                      <div className="rounded bg-white/5 p-3">
                        <div className="mb-2 text-xs text-white/50">メンバー</div>
                        <div className="space-y-1 text-sm text-white/80">
                          {myPartyMembers.map((m) => (
                            <div key={m.id}>
                              {m.profiles?.display_name ?? m.user_id}
                              {m.user_id === myParty.leader_user_id ? " (Leader)" : ""}
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
                                <div>invitee: {inv.invitee_user_id}</div>
                                <div className="mt-1 text-xs text-white/50">
                                  status: {inv.status} / {new Date(inv.created_at).toLocaleString()}
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

                      <button
                        onClick={handleTryCreateMatch}
                        disabled={busy}
                        className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        手動でマッチ生成を試す
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

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">待機状態</div>
                    <div className="mt-1 text-sm font-medium">{myWaitingEntry ? "waiting" : "待機なし"}</div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">待機時間</div>
                    <div className="mt-1 text-sm font-medium">{isWaiting ? `${waitingSeconds} 秒` : "-"}</div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">許容差レベル</div>
                    <div className="mt-1 text-sm font-medium">{myWaitingEntry?.wait_expand_level ?? "-"}</div>
                  </div>

                  <div className="rounded bg-black/20 p-3">
                    <div className="text-xs text-white/50">自動マッチング</div>
                    <div className="mt-1 text-sm font-medium">
                      {isWaiting && isPartyLeader ? (autoMatching ? "探索中..." : "有効") : "無効"}
                    </div>
                  </div>
                </div>

                {myWaitingEntry && (
                  <div className="rounded border border-white/10 bg-black/20 p-4 text-sm text-white/80">
                    <div>queue_entry_id: {myWaitingEntry.id}</div>
                    <div className="mt-1">queue_type: {myWaitingEntry.queue_type}</div>
                    <div className="mt-1">avg_rating: {myWaitingEntry.avg_rating}</div>
                    <div className="mt-1">party_size: {myWaitingEntry.party_size}</div>
                    <div className="mt-1">party_size_bonus: +{myWaitingEntry.party_size_bonus}</div>
                    <div className="mt-1">created_at: {new Date(myWaitingEntry.created_at).toLocaleString()}</div>
                  </div>
                )}

                {myActiveMatch && (
                  <div className="rounded border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm">
                    <div className="font-semibold">成立済み試合</div>
                    <div className="mt-1">match_id: {myActiveMatch.id}</div>
                    <div className="mt-1">status: {myActiveMatch.status}</div>
                    <div className="mt-1">matched_at: {new Date(myActiveMatch.matched_at).toLocaleString()}</div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">自分宛の招待</h2>

              {myPendingInvites.length === 0 ? (
                <div className="text-sm text-white/50">現在 pending 招待はありません。</div>
              ) : (
                <div className="space-y-3">
                  {myPendingInvites.map((inv) => (
                    <div key={inv.invite_id} className="rounded border border-white/10 bg-black/20 p-3">
                      <div className="text-sm">
                        招待者: <span className="font-semibold">{inv.inviter_display_name}</span>
                      </div>
                      <div className="mt-1 text-xs text-white/50">party_id: {inv.party_id}</div>
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
              <h2 className="mb-3 text-lg font-semibold">使い方</h2>
              <div className="space-y-2 text-sm text-white/75">
                <div>1. Leader がパーティを作成します。</div>
                <div>2. 招待を送り、相手が承認します。</div>
                <div>3. 完成したパーティを queue に入れます。</div>
                <div>4. waiting 中は自動でマッチ生成を試します。</div>
                <div>5. 成立したら banpick に自動遷移します。</div>
              </div>
            </section>

            <section className="rounded border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-semibold">補足</h2>
              <div className="space-y-2 text-sm text-white/75">
                <div>・自動マッチ生成は leader 側だけが試行します。</div>
                <div>・人数不足などの想定内失敗は静かに再試行します。</div>
                <div>・手動ボタンも残してあるのでテストしやすいです。</div>
                <div>・本番前には RPC 側の競合対策強化があるとより安全です。</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}