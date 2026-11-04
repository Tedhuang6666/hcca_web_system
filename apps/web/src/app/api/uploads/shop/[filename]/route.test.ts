import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const fetchMock = vi.fn<typeof fetch>();

vi.mock("@/lib/config", () => ({
  serverApiUrl: (path: string) => `http://api-green:8000${path}`,
}));

function request(filename = "front.png") {
  return GET(new Request(`http://web:3000/api/uploads/shop/${filename}`), {
    params: Promise.resolve({ filename }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("public shop image source", () => {
  it("uses the runtime API slot and streams the original image to Next Image", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" },
    }));

    const response = await request();

    expect(fetchMock).toHaveBeenCalledWith("http://api-green:8000/uploads/shop/front.png", {
      cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=604800");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it.each(["../secret.png", "..%2Fsecret.png", "folder/photo.png", "photo.svg", "photo.html", "photo.png?url=https://other.test"])(
    "rejects paths outside a single public image filename: %s", async (filename) => {
      const response = await request(filename);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([404, 403, 500])("does not cache upstream failure %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    const response = await request();
    expect(response.status).toBe(status === 404 ? 404 : 502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns an uncached temporary failure when the API is unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-image responses", async () => {
    fetchMock.mockResolvedValue(new Response("unexpected HTML", {
      headers: { "Content-Type": "text/html" },
    }));
    const response = await request();
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
