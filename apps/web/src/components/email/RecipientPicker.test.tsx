import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecipientSelector } from "@/lib/types";

import RecipientPicker from "./RecipientPicker";

vi.mock("@/components/ui/targeting", () => ({
  ModeTabs: ({
    modes,
    value,
    onChange,
  }: {
    modes: { key: string; label: string }[];
    value: string;
    onChange: (key: string) => void;
  }) => (
    <div>
      {modes.map((mode) => (
        <button
          key={mode.key}
          type="button"
          aria-pressed={value === mode.key}
          onClick={() => onChange(mode.key)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  ),
  useOrgOptions: () => [],
  usePositionOptions: () => [],
  useUserSearch: () => ({ results: [], search: () => undefined }),
}));

const USER_RECIPIENTS: RecipientSelector = {
  user_ids: ["user-1"],
  position_ids: [],
  org_ids: [],
  external_emails: [],
  include_all: false,
  include_school: false,
};

const EXTERNAL_RECIPIENTS: RecipientSelector = {
  user_ids: [],
  position_ids: [],
  org_ids: [],
  external_emails: ["outside@example.org"],
  include_all: false,
  include_school: false,
};

function RecipientHarness() {
  const [value, setValue] = useState(USER_RECIPIENTS);

  return (
    <>
      <button type="button" onClick={() => setValue(EXTERNAL_RECIPIENTS)}>
        套用外部名單
      </button>
      <output data-testid="selector">{JSON.stringify(value)}</output>
      <RecipientPicker value={value} onChange={setValue} />
    </>
  );
}

describe("RecipientPicker", () => {
  it("does not write the old mode back while applying a different recipient list", async () => {
    render(<RecipientHarness />);

    fireEvent.click(screen.getByRole("button", { name: "套用外部名單" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("outside@example.org");
      expect(screen.getByRole("button", { name: "外部信箱" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByTestId("selector")).toHaveTextContent(
      '"external_emails":["outside@example.org"]',
    );
  });
});
