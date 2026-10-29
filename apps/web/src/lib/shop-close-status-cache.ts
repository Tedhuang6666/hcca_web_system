export type CachedStatus<TStatus> = {
  fetchedAt: number;
  statuses: TStatus;
};

export type ClassStatusCache<TStatus> = {
  catalogKey: string;
  byClass: Record<string, CachedStatus<TStatus>>;
};

export type StatusRefreshOptions = {
  refreshCloseStatus?: boolean;
  refreshClassId?: string;
};

export function planClassStatusRefresh<TStatus>(
  cache: ClassStatusCache<TStatus> | null,
  catalogKey: string,
  classIds: string[],
  now: number,
  ttlMs: number,
  options?: StatusRefreshOptions,
): { byClass: Record<string, CachedStatus<TStatus>>; classIdsToRefresh: string[] } {
  const byClass = cache?.catalogKey === catalogKey ? { ...cache.byClass } : {};
  const classIdsToRefresh = [...new Set(classIds)].filter((classId) => {
    const entry = byClass[classId];
    return options?.refreshCloseStatus
      || options?.refreshClassId === classId
      || !entry
      || now - entry.fetchedAt >= ttlMs;
  });
  return { byClass, classIdsToRefresh };
}
