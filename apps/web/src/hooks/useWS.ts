"use client";
import { useEffect, useRef, useCallback } from "react";
import { silentRefresh } from "@/lib/api/core";
import { wsBase } from "@/lib/config";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

type Subscriber = {
  onMessage: (message: WsMessage) => void;
  onAuthError?: () => void;
};

type SharedConnection = {
  room: string;
  socket: WebSocket | null;
  subscribers: Set<Subscriber>;
  retries: number;
  sessionId: number;
  watchdogTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

const connections = new Map<string, SharedConnection>();

function clearWatchdog(connection: SharedConnection) {
  if (connection.watchdogTimer) {
    clearTimeout(connection.watchdogTimer);
    connection.watchdogTimer = null;
  }
}

function clearReconnect(connection: SharedConnection) {
  if (connection.reconnectTimer) {
    clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
  }
}

function notifyAuthError(connection: SharedConnection) {
  for (const subscriber of connection.subscribers) {
    subscriber.onAuthError?.();
  }
}

function armWatchdog(connection: SharedConnection, socket: WebSocket) {
  clearWatchdog(connection);
  // server 心跳 30s/次；60s 都沒任何訊息就視為連線異常
  connection.watchdogTimer = setTimeout(() => {
    try {
      socket.close(4000, "watchdog timeout");
    } catch {
      /* ignore */
    }
  }, 60_000);
}

function scheduleReconnect(connection: SharedConnection, isCapacityReject: boolean) {
  if (connection.subscribers.size === 0 || connection.reconnectTimer) return;

  // 指數退避 + jitter：避免後端恢復瞬間所有 client 同時重連造成驚群。
  const baseMs = isCapacityReject ? 5_000 : 1_000;
  const backoff = Math.min(30_000, baseMs * 2 ** (connection.retries - 1));
  const delay = backoff + Math.random() * 1_000;
  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    connectShared(connection);
  }, delay);
}

function connectShared(connection: SharedConnection) {
  if (connection.subscribers.size === 0 || connection.socket) return;

  const safeRoom = encodeURIComponent(connection.room);
  const socket = new WebSocket(`${wsBase()}/ws/${safeRoom}`);
  const mySession = ++connection.sessionId;
  connection.socket = socket;

  socket.onopen = () => {
    if (mySession !== connection.sessionId) return;
    connection.retries = 0;
    armWatchdog(connection, socket);
  };

  socket.onmessage = (event) => {
    if (mySession !== connection.sessionId) return;
    // 任何訊息都重置 watchdog
    armWatchdog(connection, socket);
    try {
      const data = JSON.parse(event.data) as WsMessage;
      if (data.type === "ping") {
        // 心跳：自動回 pong，不傳給上層
        try {
          socket.send(JSON.stringify({ type: "pong" }));
        } catch {
          /* socket 已關閉 */
        }
        return;
      }
      for (const subscriber of connection.subscribers) {
        subscriber.onMessage(data);
      }
    } catch {
      /* ignore parse errors */
    }
  };

  socket.onclose = async (event) => {
    clearWatchdog(connection);
    if (connection.socket === socket) connection.socket = null;
    // 若 session 已失效（room 變更或 component unmount），直接忽略
    if (mySession !== connection.sessionId || connection.subscribers.size === 0) return;
    if (event.code === 1000 || event.code === 1001) return;

    // 4002 僅表示 access token 到期：先靜默換發，再以同一 room 重連。
    if (event.code === 4002) {
      const ok = await silentRefresh();
      if (mySession !== connection.sessionId || connection.subscribers.size === 0) return;
      if (!ok) {
        notifyAuthError(connection);
        return;
      }
      connection.retries = 0;
      connectShared(connection);
      return;
    }

    // 4001/4003 = 後端因驗證/授權失敗主動關閉；1008 兼容舊版 policy close。
    if (event.code === 4001 || event.code === 4003 || event.code === 1008) {
      notifyAuthError(connection);
      return;
    }

    // 1013 = 伺服器容量達上限，給較長的 backoff 起點
    const isCapacityReject = event.code === 1013;
    connection.retries++;

    if (connection.retries === 1 && !isCapacityReject) {
      // 第一次失敗：嘗試 refresh token 後再重連
      const ok = await silentRefresh();
      if (mySession !== connection.sessionId || connection.subscribers.size === 0) return;
      if (!ok) {
        notifyAuthError(connection);
        return;
      }
    } else if (connection.retries > 6) {
      // 連續多次仍失敗：放棄（通常是網路問題或長時間無法連線）
      notifyAuthError(connection);
      return;
    }

    scheduleReconnect(connection, isCapacityReject);
  };

  socket.onerror = () => socket.close();
}

function subscribe(room: string, subscriber: Subscriber) {
  let connection = connections.get(room);
  if (!connection) {
    connection = {
      room,
      socket: null,
      subscribers: new Set(),
      retries: 0,
      sessionId: 0,
      watchdogTimer: null,
      reconnectTimer: null,
    };
    connections.set(room, connection);
  }
  connection.subscribers.add(subscriber);
  connectShared(connection);

  return () => {
    connection?.subscribers.delete(subscriber);
    if (connection?.subscribers.size !== 0) return;
    connection.sessionId++;
    clearWatchdog(connection);
    clearReconnect(connection);
    connection.socket?.close(1000, "no subscribers");
    connection.socket = null;
    connections.delete(room);
  };
}

function sendToRoom(room: string, data: unknown) {
  const socket = connections.get(room)?.socket;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

/**
 * 連線到後端 WebSocket room，監聽指定事件。
 *
 * 內建心跳處理：
 *  - 收到 server 端 `{type:"ping"}` 自動回 `{type:"pong"}`（不傳給 onMessage）
 *  - watchdog：若 60s 內未收到任何訊息（含 ping）→ 主動關閉觸發重連
 *
 * @param room        房間 ID，例如 `org:${orgId}` 或 `doc:${docId}`
 * @param onMessage   收到訊息的 callback
 * @param enabled     是否啟用（預設 true）
 * @param onAuthError token 過期且 refresh 失敗時呼叫（可選）
 */
export function useWS(
  room: string | null | undefined,
  onMessage: (msg: WsMessage) => void,
  enabled = true,
  onAuthError?: () => void,
) {
  const stableCallback = useRef(onMessage);
  stableCallback.current = onMessage;
  const stableAuthError = useRef(onAuthError);
  stableAuthError.current = onAuthError;

  useEffect(() => {
    if (!room || !enabled) return;
    return subscribe(room, {
      onMessage: (message) => stableCallback.current(message),
      onAuthError: () => stableAuthError.current?.(),
    });
  }, [room, enabled]);

  const send = useCallback((data: unknown) => {
    if (room) sendToRoom(room, data);
  }, [room]);

  return { send };
}
