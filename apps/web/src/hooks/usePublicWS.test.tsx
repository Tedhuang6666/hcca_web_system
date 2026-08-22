import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePublicWS } from "./usePublicWS";

vi.mock("@/lib/config", () => ({
  wsBase: () => "wss://example.test",
}));

class MockWebSocket {
  static readonly instances: MockWebSocket[] = [];

  readonly url: string;
  closeCode: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send() {}

  close(code = 1000) {
    this.closeCode = code;
    this.onclose?.();
  }
}

describe("usePublicWS", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes shared connections on pagehide and reconnects after bfcache restore", () => {
    const hook = renderHook(() => usePublicWS("/public/announcements", vi.fn()));
    const firstSocket = MockWebSocket.instances[0];

    expect(firstSocket.url).toBe("wss://example.test/ws/public/announcements");
    window.dispatchEvent(new Event("pagehide"));
    expect(firstSocket.closeCode).toBe(1000);

    window.dispatchEvent(new Event("pageshow"));
    expect(MockWebSocket.instances).toHaveLength(2);

    hook.unmount();
  });
});
