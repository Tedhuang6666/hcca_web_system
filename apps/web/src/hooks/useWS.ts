"use client";
import { useEffect, useRef, useCallback } from "react";
import { silentRefresh } from "@/lib/api";
import { wsBase } from "@/lib/config";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
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
  const ws = useRef<WebSocket | null>(null);
  const stableCallback = useRef(onMessage);
  stableCallback.current = onMessage;
  const stableAuthError = useRef(onAuthError);
  stableAuthError.current = onAuthError;
  const retries = useRef(0);
  // 每次 useEffect 執行時遞增，讓 stale 的 async onclose 能辨別自己已失效
  const sessionId = useRef(0);
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armWatchdog = useCallback((socket: WebSocket) => {
    if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
    // server 心跳 30s/次；60s 都沒任何訊息就視為連線異常
    watchdogTimer.current = setTimeout(() => {
      try {
        socket.close(4000, "watchdog timeout");
      } catch {
        /* ignore */
      }
    }, 60_000);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current) {
      clearTimeout(watchdogTimer.current);
      watchdogTimer.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!room || !enabled) return;
    const safeRoom = encodeURIComponent(room);
    const url = `${wsBase()}/ws/${safeRoom}`;
    const mySession = sessionId.current;

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      retries.current = 0;
      armWatchdog(socket);
    };

    socket.onmessage = (e) => {
      // 任何訊息都重置 watchdog
      armWatchdog(socket);
      try {
        const data = JSON.parse(e.data) as WsMessage;
        if (data.type === "ping") {
          // 心跳：自動回 pong，不傳給上層
          try {
            socket.send(JSON.stringify({ type: "pong" }));
          } catch {
            /* socket 已關閉 */
          }
          return;
        }
        stableCallback.current(data);
      } catch {
        /* ignore parse errors */
      }
    };

    socket.onclose = async (e) => {
      clearWatchdog();
      // 若 session 已失效（room 變更或 component unmount），直接忽略
      if (mySession !== sessionId.current) return;
      if (e.code === 1000 || e.code === 1001) return;

      // 1013 = 伺服器容量達上限，給較長的 backoff
      const isCapacityReject = e.code === 1013;

      retries.current++;

      if (retries.current === 1 && !isCapacityReject) {
        // 第一次失敗：嘗試 refresh token 後再重連
        const ok = await silentRefresh();
        if (mySession !== sessionId.current) return;
        if (!ok) {
          stableAuthError.current?.();
          return;
        }
      } else if (retries.current > 5) {
        // 超過 5 次仍失敗：放棄（通常是網路問題或長時間無法連線）
        stableAuthError.current?.();
        return;
      }

      const delay = isCapacityReject
        ? Math.min(30_000, 5_000 * 2 ** (retries.current - 1))
        : 3_000;
      setTimeout(connect, delay);
    };

    socket.onerror = () => socket.close();
  }, [room, enabled, armWatchdog, clearWatchdog]);

  useEffect(() => {
    const activeSession = sessionId.current + 1;
    sessionId.current = activeSession;
    retries.current = 0;
    connect();
    return () => {
      sessionId.current = activeSession + 1; // 使所有進行中的 async onclose 失效
      clearWatchdog();
      ws.current?.close(1000, "component unmounted");
      ws.current = null;
    };
  }, [connect, clearWatchdog]);

  const send = useCallback((data: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
