"use client";
import { useEffect, useRef, useCallback } from "react";

function getWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/^http/, "ws");
  if (typeof window === "undefined") return "ws://localhost:8000";
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api`;
}

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
    // 房間名稱如 "user:uuid" 中的冒號在 URL 路徑段中是合法字符（RFC 3986），無需 encodeURIComponent
    // 使用 encodeURIComponent 會將冒號轉成 %3A，導致 Starlette 路由匹配或 room key 不一致（404）
    const safeRoom = room.replace(/\//g, "%2F"); // 只需 encode 正斜線
    const url = `${getWsBase()}/ws/${safeRoom}`;

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
