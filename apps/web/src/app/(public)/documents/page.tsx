import DocumentListClient from "./client";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicDocuments } from "@/lib/serverFetch";

export const metadata = pageMetadata({
  title: "公開公文",
  description: "依字號、標題與主旨查詢校園自治平台公開公文。",
  path: "/documents",
  type: "website",
});

export default async function DocumentListPage() {
  const initialDocs = await fetchPublicDocuments({ limit: 20, offset: 0 });
  return <DocumentListClient initialDocs={initialDocs} />;
}
