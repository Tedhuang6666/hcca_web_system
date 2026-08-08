import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "我要陳情",
  description: "提交校園問題與建議給新竹高中班聯會。",
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
    },
  },
};

export default function NewPetitionLayout({ children }: { children: ReactNode }) {
  return children;
}
