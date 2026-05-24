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

  const connect = useCallback(() => {
    if (!room || !enabled) return;
    const safeRoom = encodeURIComponent(room);
    const url = `${wsBase()}/ws/${safeRoom}`;
    const mySession = sessionId.current;

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      retries.current = 0;
    };

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WsMessage;
        stableCallback.current(data);
      } catch { /* ignore parse errors */ }
    };

    socket.onclose = async (e) => {
      // 若 session 已失效（room 變更或 component unmount），直接忽略
      if (mySession !== sessionId.current) return;
      if (e.code === 1000 || e.code === 1001) return;

      retries.current++;

      if (retries.current === 1) {
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

      setTimeout(connect, 3000);
    };

    socket.onerror = () => socket.close();
  }, [room, enabled]);

  useEffect(() => {
    const activeSession = sessionId.current + 1;
    sessionId.current = activeSession;
    retries.current = 0;
    connect();
    return () => {
      sessionId.current = activeSession + 1; // 使所有進行中的 async onclose 失效
      ws.current?.close(1000, "component unmounted");
      ws.current = null;
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
