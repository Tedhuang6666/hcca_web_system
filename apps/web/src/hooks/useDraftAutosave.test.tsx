import { act, renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";
import { useDraftAutosave } from "./useDraftAutosave";

describe("useDraftAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("user_id", "test-user");
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

    const stored = JSON.parse(
      localStorage.getItem("hcca:draft:v1:user:test-user:test") ?? "null",
    );
    expect(stored.value).toBe("草稿內容");
    expect(stored.updatedAt).toEqual(expect.any(String));
  });

  it("restores an existing draft on mount", () => {
    localStorage.setItem("hcca:draft:v1:user:test-user:test", JSON.stringify({
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

  it("does not copy the previous account draft into a newly signed-in account", async () => {
    localStorage.setItem("user_id", "account-a");
    localStorage.setItem("hcca:draft:v1:user:account-a:test", JSON.stringify({
      value: "甲帳號的私人草稿",
      updatedAt: "2026-07-28T08:00:00.000Z",
    }));

    const { result } = renderHook(() => {
      const [value, setValue] = useState("");
      const onRestore = useCallback((restored: string) => setValue(restored), []);
      const autosave = useDraftAutosave({ key: "test", value, onRestore, debounceMs: 50 });
      return { value, ...autosave };
    });

    expect(result.current.value).toBe("甲帳號的私人草稿");
    localStorage.setItem("user_id", "account-b");
    await act(async () => {
      window.dispatchEvent(new Event(AUTH_CACHE_EVENT));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(localStorage.getItem("hcca:draft:v1:user:account-b:test")).toBeNull();
  });
});
