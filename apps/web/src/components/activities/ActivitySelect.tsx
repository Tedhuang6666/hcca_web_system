"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { activitiesApi } from "@/lib/api/activities";
import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";
import type { Activity } from "@/lib/types";

type ActivitySelectProps = {
  value: string;
  onChange: (activityId: string) => void;
  label?: string;
  includeNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
  scope?: "mine" | "all";
  onActivitiesLoaded?: (activities: Activity[]) => void;
  hideWhenUnauthenticated?: boolean;
};

function subscribeToAuthChanges(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener(AUTH_CACHE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(AUTH_CACHE_EVENT, onChange);
  };
}

function getAuthSnapshot() {
  try {
    return Boolean(window.localStorage.getItem("user_id"));
  } catch {
    return false;
  }
}

function getServerAuthSnapshot() {
  return false;
}

const STATUS_LABEL: Record<Activity["status"], string> = {
  draft: "草稿",
  active: "進行中",
  ended: "已結束",
  archived: "已封存",
};

export default function ActivitySelect({
  value,
  onChange,
  label = "所屬活動",
  includeNone = true,
  noneLabel = "不指定活動",
  disabled = false,
  className = "",
  scope = "mine",
  onActivitiesLoaded,
  hideWhenUnauthenticated = false,
}: ActivitySelectProps) {
  const isAuthenticated = useSyncExternalStore(
    subscribeToAuthChanges,
    getAuthSnapshot,
    getServerAuthSnapshot,
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(!hideWhenUnauthenticated);

  useEffect(() => {
    let alive = true;
    if (
      typeof window === "undefined" ||
      (hideWhenUnauthenticated ? !isAuthenticated : !localStorage.getItem("user_id"))
    ) {
      setActivities([]);
      onActivitiesLoaded?.([]);
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    const request = scope === "all"
      ? activitiesApi.list({ active_only: true }).catch(() => activitiesApi.mine(true))
      : activitiesApi.mine(true);
    request
      .then((items) => {
        if (!alive) return;
        setActivities(items);
        onActivitiesLoaded?.(items);
      })
      .catch(() => {
        if (!alive) return;
        setActivities([]);
        onActivitiesLoaded?.([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [hideWhenUnauthenticated, isAuthenticated, onActivitiesLoaded, scope]);

  const options = useMemo(
    () => activities.filter((activity) => activity.status !== "archived" && activity.is_active),
    [activities],
  );

  if (hideWhenUnauthenticated && !isAuthenticated) {
    return null;
  }

  if (!loading && options.length === 0 && includeNone) {
    return null;
  }

  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || loading}
        className="input w-full"
      >
        {includeNone && <option value="">{loading ? "載入活動中..." : noneLabel}</option>}
        {options.map((activity) => (
          <option key={activity.id} value={activity.id}>
            {activity.name} · {STATUS_LABEL[activity.status] ?? activity.status}
          </option>
        ))}
      </select>
      {options.length > 0 && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          只會列出你目前可管理的活動。
        </p>
      )}
    </label>
  );
}
