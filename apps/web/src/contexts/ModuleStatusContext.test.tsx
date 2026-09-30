import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { systemApi } from "@/lib/api/system";
import { ModuleStatusProvider, useModuleStatus } from "./ModuleStatusContext";

vi.mock("@/lib/api/system", () => ({
  systemApi: {
    moduleStatuses: vi.fn(),
  },
}));

const moduleStatuses = vi.mocked(systemApi.moduleStatuses);

describe("ModuleStatusProvider", () => {
  beforeEach(() => {
    moduleStatuses.mockReset();
  });

  it("waits for the first status response before reporting ready", async () => {
    moduleStatuses.mockResolvedValue([
      {
        id: "shop",
        label: "商品訂購",
        on: true,
        mode: "closed",
        reason: "維護中",
        until: null,
      },
    ]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ModuleStatusProvider>{children}</ModuleStatusProvider>
    );
    const { result } = renderHook(() => useModuleStatus(), { wrapper });

    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isModuleClosed("shop")).toBe(true);
  });
});
