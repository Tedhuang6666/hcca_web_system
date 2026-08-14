import type { Metadata } from "next";
import type { ReactNode } from "react";

import { pageMetadata } from "@/lib/seo";
import PetitionsLayoutClient from "./PetitionsLayoutClient";

export const metadata: Metadata = pageMetadata({
  title: "陳情中心",
  description: "提出陳情、查詢案件進度，或閱讀經同意公開的校園問題與回覆。",
  path: "/petitions",
  type: "website",
});

export default function PetitionsLayout({ children }: { children: ReactNode }) {
  return <PetitionsLayoutClient>{children}</PetitionsLayoutClient>;
}
