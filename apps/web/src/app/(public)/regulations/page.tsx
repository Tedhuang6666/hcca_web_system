import RegulationsClient from "./client";
import { fetchPublicRegulations } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "法規查詢",
  description: "查詢校園自治現行法規、條文沿革與穩定引用連結。",
  path: "/regulations",
  type: "website",
});

export default async function RegulationsPage() {
  const initialRegs = await fetchPublicRegulations();
  return <RegulationsClient initialRegs={initialRegs} />;
}
