"use client";

import { useEffect, useRef } from "react";
import { wsBase } from "@/lib/config";

export type PublicWsMessage = {
  type: string;
  [key: string]: unknown;
};

type Subscriber = (message: PublicWsMessage) => void;

type SharedPublicConnection = {
  path: string;
  socket: WebSocket | null;
  subscribers: Set<Subscriber>;
  retries: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

const connections = new Map<string, SharedPublicConnection>();
let pageFrozen = false;
let pageLifecycleListenersInstalled = false;

function suspendConnections() {
  pageFrozen = true;
  for (const connection of connections.values()) {
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
    connection.socket?.close(1000, "page hidden");
    connection.socket = null;
  }
}

function resumeConnections() {
  pageFrozen = false;
  for (const connection of connections.values()) connect(connection);
}

function installPageLifecycleListeners() {
  if (pageLifecycleListenersInstalled || typeof window === "undefined") return;
  pageLifecycleListenersInstalled = true;
  window.addEventListener("pagehide", suspendConnections);
  window.addEventListener("pageshow", resumeConnections);
}

function scheduleReconnect(connection: SharedPublicConnection) {
  if (pageFrozen || connection.subscribers.size === 0 || connection.reconnectTimer) return;
  const delay = Math.min(30_000, 1_000 * 2 ** connection.retries) + Math.random() * 500;
  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    connect(connection);
  }, delay);
}

function connect(connection: SharedPublicConnection) {
  if (pageFrozen || connection.socket || connection.subscribers.size === 0) return;
  const socket = new WebSocket(`${wsBase()}/ws${connection.path}`);
  connection.socket = socket;

  socket.onopen = () => {
    connection.retries = 0;
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as PublicWsMessage;
      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      for (const subscriber of connection.subscribers) subscriber(message);
    } catch {
      // 保留既有 HTTP 資料，忽略損毀的公開訊息。
    }
  };
  socket.onclose = () => {
    if (connection.socket === socket) connection.socket = null;
    if (pageFrozen || connection.subscribers.size === 0) return;
    connection.retries += 1;
    scheduleReconnect(connection);
  };
  socket.onerror = () => socket.close();
}

function subscribe(path: string, subscriber: Subscriber) {
  installPageLifecycleListeners();
  let connection = connections.get(path);
  if (!connection) {
    connection = { path, socket: null, subscribers: new Set(), retries: 0, reconnectTimer: null };
    connections.set(path, connection);
  }
  connection.subscribers.add(subscriber);
  connect(connection);

  return () => {
    connection?.subscribers.delete(subscriber);
    if (connection?.subscribers.size !== 0) return;
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
    connection.socket?.close(1000, "no subscribers");
    connection.socket = null;
    connections.delete(path);
  };
}

export function usePublicWS(
  path: string | null | undefined,
  onMessage: (message: PublicWsMessage) => void,
  enabled = true,
) {
  const callback = useRef(onMessage);
  callback.current = onMessage;

  useEffect(() => {
    if (!path || !enabled) return;
    return subscribe(path, (message) => callback.current(message));
  }, [enabled, path]);
}
