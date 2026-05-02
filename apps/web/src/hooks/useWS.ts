"use client";
import { useEffect, useRef, useCallback } from "react";

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
  .replace(/^http/, "ws");

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * 連線到後端 WebSocket room，監聽指定事件。
 *
 * @param room     房間 ID，例如 `org:${orgId}` 或 `doc:${docId}`
 * @param onMessage  收到訊息的 callback
 * @param enabled  是否啟用（預設 true）
 */
export function useWS(
  room: string | null | undefined,
  onMessage: (msg: WsMessage) => void,
  enabled = true,
) {
  const ws = useRef<WebSocket | null>(null);
  const stableCallback = useRef(onMessage);
  stableCallback.current = onMessage;

  const connect = useCallback(() => {
    if (!room || !enabled) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const url = `${WS_BASE}/ws/${encodeURIComponent(room)}${token ? `?token=${token}` : ""}`;

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WsMessage;
        stableCallback.current(data);
      } catch { /* ignore parse errors */ }
    };

    socket.onclose = (e) => {
      // 非正常關閉時，3 秒後重試
      if (e.code !== 1000 && e.code !== 1001) {
        setTimeout(connect, 3000);
      }
    };

    socket.onerror = () => socket.close();
  }, [room, enabled]);

  useEffect(() => {
    connect();
    return () => {
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
