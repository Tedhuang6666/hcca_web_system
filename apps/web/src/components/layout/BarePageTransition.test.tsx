import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import BarePageTransition from "./BarePageTransition";

function SharedLayout({ mounted }: { mounted: () => void }) {
  const [clicks, setClicks] = useState(0);
  useEffect(mounted, [mounted]);
  return <button onClick={() => setClicks((value) => value + 1)}>共用狀態 {clicks}</button>;
}

describe("root page transitions", () => {
  it.each([["/", "/articles"], ["/articles", "/"]])(
    "preserves the public layout when navigating from %s to %s",
    (from, to) => {
      navigation.pathname = from;
      const mounted = vi.fn();
      const content = <BarePageTransition><SharedLayout mounted={mounted} /></BarePageTransition>;
      const { rerender } = render(content);
      fireEvent.click(screen.getByRole("button", { name: "共用狀態 0" }));

      navigation.pathname = to;
      rerender(<BarePageTransition><SharedLayout mounted={mounted} /></BarePageTransition>);

      expect(screen.getByRole("button", { name: "共用狀態 1" })).toBeInTheDocument();
      expect(mounted).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the standalone transition on login pages", () => {
    navigation.pathname = "/login";
    const { container } = render(<BarePageTransition>登入</BarePageTransition>);
    expect(container.querySelector(".app-page-transition[data-route='/login']")).not.toBeNull();
  });
});
