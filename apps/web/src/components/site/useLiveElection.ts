"use client";

import { useEffect, useState } from "react";

import { usePublicModuleStatus } from "@/contexts/PublicModuleStatusContext";
import { useResilientPoll } from "@/hooks/useResilientPoll";
import { usePublicWS } from "@/hooks/usePublicWS";
import { electionsApi } from "@/lib/api/elections";
import { apiUrl } from "@/lib/config";
import type { CandidateTally, ElectionLiveSummary, ElectionStatus } from "@/lib/types";

interface PublicElectionItem {
  id: string;
  title: string;
  status: ElectionStatus;
  updated_at: string;
}

export interface ActiveLiveElection {
  id: string;
  title: string;
  status: ElectionStatus;
  /** 即時摘要；首次載入或暫時取不到時為 null（仍會顯示標題與狀態）。 */
  summary: ElectionLiveSummary | null;
}

const SHARED_CACHE_MS = 5_000;
let sharedActive: ActiveLiveElection | null = null;
let sharedCheckedAt = 0;
let sharedRequest: Promise<ActiveLiveElection | null> | null = null;

async function fetchPublicElections(): Promise<PublicElectionItem[]> {
  try {
    const res = await fetch(apiUrl("/elections/public"), { credentials: "include" });
    if (!res.ok) return [];
    return (await res.json()) as PublicElectionItem[];
  } catch {
    return [];
  }
}

async function fetchSharedLiveElection(): Promise<ActiveLiveElection | null> {
  const now = Date.now();
  if (now - sharedCheckedAt < SHARED_CACHE_MS) return sharedActive;
  if (sharedRequest) return sharedRequest;

  sharedRequest = (async () => {
    const elections = await fetchPublicElections();
    const current =
      elections.find((item) => item.status === "live") ??
      elections.find((item) => item.status === "paused") ??
      null;
    if (!current) {
      sharedActive = null;
      sharedCheckedAt = Date.now();
      return null;
    }

    let summary: ElectionLiveSummary | null = null;
    try {
      summary = await electionsApi.live(current.id);
    } catch {
      summary = null;
    }
    sharedActive = {
      id: current.id,
      title: current.title,
      status: current.status,
      summary,
    };
    sharedCheckedAt = Date.now();
    return sharedActive;
  })().finally(() => {
    sharedRequest = null;
  });

  return sharedRequest;
}

/**
 * 公開站「正在發生」的單一資料來源：找出進行中（live 優先，其次 paused）的選舉，
 * 並抓取即時摘要，供站台級 banner 與首頁卡片共用，避免兩處各抓一份。
 * 用 useResilientPoll 週期更新，分頁隱藏 / 離線時自動暫停。
 */
export function useLiveElection(pollMs = 25_000, enabled = true): ActiveLiveElection | null {
  const [active, setActive] = useState<ActiveLiveElection | null>(null);
  const { statuses, isModuleDown } = usePublicModuleStatus();
  const electionStatusReady = Boolean(statuses.elections);
  const electionsModuleDown = isModuleDown("elections");

  useEffect(() => {
    if (!enabled) setActive(null);
  }, [enabled]);

  useResilientPoll(
    async () => {
      if (electionsModuleDown) {
        setActive(null);
        return "ok";
      }
      setActive(await fetchSharedLiveElection());
      return "ok";
    },
    // The public endpoint intentionally returns 503 while elections is closed.
    // Wait for the module-status response before polling so every public page
    // does not emit a predictable failed request during its first render.
    { enabled: enabled && electionStatusReady, intervalMs: pollMs },
  );

  usePublicWS(
    active?.id ? `/public/elections/${encodeURIComponent(active.id)}` : null,
    (message) => {
      if (message.type !== "election_update" || !message.data) return;
      const summary = message.data as ElectionLiveSummary;
      setActive((previous) => {
        if (!previous || previous.id !== summary.election_id) return previous;
        const next = { ...previous, status: summary.status, summary };
        sharedActive = next;
        sharedCheckedAt = Date.now();
        return next;
      });
    },
    enabled && !electionsModuleDown,
  );

  return active;
}

/** 取目前領先的候選組合：優先用後端標記的 leader，否則退而取得票最高者。 */
export function liveLeader(summary: ElectionLiveSummary | null): CandidateTally | null {
  if (!summary || summary.candidates.length === 0) return null;
  if (summary.leader_candidate_id) {
    const flagged = summary.candidates.find(
      (candidate) => candidate.candidate_id === summary.leader_candidate_id,
    );
    if (flagged) return flagged;
  }
  return [...summary.candidates].sort((a, b) => b.votes - a.votes)[0] ?? null;
}
