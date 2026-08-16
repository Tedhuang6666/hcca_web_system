import DocumentListClient from "./client";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "公開公文",
  description: "依字號、標題與主旨查詢校園自治平台公開公文。",
  path: "/documents",
  type: "website",
});

export default async function DocumentListPage() {
  return <DocumentListClient />;
}
