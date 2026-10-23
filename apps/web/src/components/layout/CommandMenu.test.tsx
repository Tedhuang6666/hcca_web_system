import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({
  loaded: vi.fn(),
  ready: undefined as Promise<void> | undefined,
}));
vi.mock("./CommandMenuDialog", async () => {
  dialog.loaded();
  await dialog.ready;
  return { default: ({ query, setQuery, onClose }: {
    query: string; setQuery: (value: string) => void; onClose: () => void;
  }) => (
    <div role="dialog" aria-label="所有服務">
      <input aria-label="搜尋服務" value={query} onChange={event => setQuery(event.target.value)} />
      <button onClick={onClose}>關閉</button>
    </div>
  ) };
});

import CommandMenu, { OPEN_COMMAND_MENU_EVENT } from "./CommandMenu";

describe("command menu activation", () => {
  beforeEach(() => { dialog.loaded.mockClear(); });

  it("waits for the first request, preserves the query and supports keyboard reopening", async () => {
    let release!: () => void;
    dialog.ready = new Promise<void>(resolve => { release = resolve; });
    render(<CommandMenu />);
    expect(dialog.loaded).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent(window, new Event(OPEN_COMMAND_MENU_EVENT));
    expect(screen.getByRole("status")).toHaveTextContent("正在開啟功能選單");
    await waitFor(() => expect(dialog.loaded).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => { release(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent(window, new Event(OPEN_COMMAND_MENU_EVENT));
    expect(await screen.findByRole("dialog")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "公文" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("textbox")).toHaveValue("公文");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes its global listeners when the shell unmounts", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<CommandMenu />);
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(remove).toHaveBeenCalledWith(OPEN_COMMAND_MENU_EVENT, expect.any(Function));
  });
});
