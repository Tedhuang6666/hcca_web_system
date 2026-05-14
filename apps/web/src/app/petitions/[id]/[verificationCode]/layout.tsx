import type { Metadata } from "next";
import type { ReactNode } from "react";

import { serverApiUrl } from "@/lib/config";

type PetitionMeta = {
  case_number: string;
  title: string;
  status_public_message: string;
};

async function fetchPetition(caseNumber: string, verificationCode: string): Promise<PetitionMeta | null> {
  const res = await fetch(serverApiUrl(`/petitions/${caseNumber}/${verificationCode}`), {
    next: { revalidate: 30 },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string; verificationCode: string }> },
): Promise<Metadata> {
  const { id, verificationCode } = await params;
  const item = await fetchPetition(id, verificationCode);
  const title = item ? `陳情案件 ${item.case_number}：${item.title}` : `陳情案件 ${id}`;
  const description = item?.status_public_message ?? "校園自治平台陳情案件進度查詢。";
  const path = `/petitions/${id}/${verificationCode}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "article",
      url: path,
      siteName: "HCCA 校園自治整合平台",
    },
    twitter: { card: "summary", title, description },
  };
}

export default function PetitionShareLayout({ children }: { children: ReactNode }) {
  return children;
}
