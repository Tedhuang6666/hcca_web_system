import type { Metadata } from "next";

import RaffleClient from "./RaffleClient";

export const metadata: Metadata = {
  title: "現場抽獎",
  robots: { index: false, follow: false },
};

export default function RafflePage() {
  return <RaffleClient />;
}
