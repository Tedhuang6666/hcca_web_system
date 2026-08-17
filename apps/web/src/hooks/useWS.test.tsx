import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWS } from "./useWS";

vi.mock("@/lib/api/core", () => ({
  silentRefresh: vi.fn(async () => true),
}));

vi.mock("@/lib/config", () => ({
  wsBase: () => "wss://example.test",
}));

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly instances: MockWebSocket[] = [];
  readonly sent: string[] = [];
  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("useWS", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one room connection between subscribers and broadcasts messages", () => {
    const firstMessage = vi.fn();
    const secondMessage = vi.fn();
    const first = renderHook(() => useWS("org:1", firstMessage));
    const second = renderHook(() => useWS("org:1", secondMessage));
    const socket = MockWebSocket.instances[0];

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.url).toBe("wss://example.test/ws/org%3A1");

    socket.emitOpen();
    socket.emitMessage({ type: "updated", id: "123" });

    expect(firstMessage).toHaveBeenCalledWith({ type: "updated", id: "123" });
    expect(secondMessage).toHaveBeenCalledWith({ type: "updated", id: "123" });

    first.unmount();
    expect(socket.readyState).toBe(MockWebSocket.OPEN);

    second.result.current.send({ type: "ack" });
    expect(socket.sent).toContain(JSON.stringify({ type: "ack" }));

    second.unmount();
    expect(socket.readyState).toBe(3);
  });

  it("answers heartbeat messages without notifying subscribers", () => {
    const onMessage = vi.fn();
    const hook = renderHook(() => useWS("doc:1", onMessage));
    const socket = MockWebSocket.instances[0];

    socket.emitOpen();
    socket.emitMessage({ type: "ping" });

    expect(onMessage).not.toHaveBeenCalled();
    expect(socket.sent).toContain(JSON.stringify({ type: "pong" }));

    hook.unmount();
  });
});
