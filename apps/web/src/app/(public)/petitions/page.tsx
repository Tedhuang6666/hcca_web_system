import PetitionsPageClient from "@/app/(protected)/petitions/PetitionsPageClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "陳情服務",
  description: "登入後具名提出校園陳情、查詢案件進度。",
  path: "/petitions",
  type: "website",
});

export default function PetitionsPage() {
  return <PetitionsPageClient />;
}
