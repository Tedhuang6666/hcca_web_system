import type { Metadata } from "next";

import RaffleAdminClient from "./RaffleAdminClient";

export const metadata: Metadata = { title: "抽獎控制台", robots: { index: false, follow: false } };

export default function RaffleAdminPage() {
  return <RaffleAdminClient />;
}
