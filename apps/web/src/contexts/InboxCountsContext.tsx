"use client";
import { createContext, useContext } from "react";
import type { useInboxCounts } from "@/hooks/useInboxCounts";

type InboxCountsState = ReturnType<typeof useInboxCounts>;

const InboxCountsContext = createContext<InboxCountsState | null>(null);

export const InboxCountsProvider = InboxCountsContext.Provider;

export function useInboxCountsContext(): InboxCountsState {
  const ctx = useContext(InboxCountsContext);
  if (!ctx) throw new Error("useInboxCountsContext must be used within InboxCountsProvider");
  return ctx;
}
