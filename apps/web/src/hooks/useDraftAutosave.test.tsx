import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftAutosave } from "./useDraftAutosave";

describe("useDraftAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("saves changed values after the debounce window", async () => {
    const onRestore = vi.fn();
    const isEmpty = (value: string) => !value.trim();
    const { rerender } = renderHook(
      ({ value }: { value: string }) => useDraftAutosave({
        key: "test",
        value,
        onRestore,
        isEmpty,
        debounceMs: 50,
      }),
      { initialProps: { value: "" } },
    );

    rerender({ value: "草稿內容" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const stored = JSON.parse(localStorage.getItem("hcca:draft:v1:test") ?? "null");
    expect(stored.value).toBe("草稿內容");
    expect(stored.updatedAt).toEqual(expect.any(String));
  });

  it("restores an existing draft on mount", () => {
    localStorage.setItem("hcca:draft:v1:test", JSON.stringify({
      value: "已保存內容",
      updatedAt: "2026-07-28T08:00:00.000Z",
    }));
    const onRestore = vi.fn();

    renderHook(() => useDraftAutosave({
      key: "test",
      value: "目前內容",
      onRestore,
    }));

    expect(onRestore).toHaveBeenCalledWith("已保存內容", {
      updatedAt: "2026-07-28T08:00:00.000Z",
    });
  });
});
