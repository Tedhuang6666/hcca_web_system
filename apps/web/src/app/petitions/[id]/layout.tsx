import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "陳情案件進度",
  description: "校園自治平台陳情案件進度查詢。",
  openGraph: {
    title: "陳情案件進度",
    description: "校園自治平台陳情案件進度查詢。",
    type: "website",
    siteName: "HCCA 校園自治整合平台",
  },
  twitter: {
    card: "summary",
    title: "陳情案件進度",
    description: "校園自治平台陳情案件進度查詢。",
  },
};

export default function PetitionDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
