import type { Metadata } from "next";
import type { ReactNode } from "react";

import { serverApiUrl } from "@/lib/config";
import { socialDescription } from "@/lib/social-metadata";
import { pageMetadata } from "@/lib/seo";

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
  const description = socialDescription(
    "陳情案件",
    item ? `${item.case_number}｜${item.title}` : id,
    "陳情案件進度查詢。",
  );
  const path = `/petitions/${id}/${verificationCode}`;
  return pageMetadata({
    title: item?.title ?? "陳情案件進度",
    description,
    path,
  });
}

export default function PetitionShareLayout({ children }: { children: ReactNode }) {
  return children;
}
