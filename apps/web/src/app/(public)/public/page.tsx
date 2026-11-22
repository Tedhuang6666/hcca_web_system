import PublicHomeServices from "./PublicHomeServices";
import { fetchPublicModuleStatuses } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "公開資料與校園服務",
  description: "查詢公開法規、公文、即時開票與學生自治服務。",
  path: "/public",
  type: "website",
});

export default async function PublicHomePage() {
  const statuses = await fetchPublicModuleStatuses();
  const initialClosedModuleIds = statuses
    .filter((status) => status.on && status.mode === "closed")
    .map((status) => status.id)
    .filter((id): id is "elections" | "petitions" => id === "elections" || id === "petitions");

  return (
    <div className="space-y-10 pb-8">
      <header className="public-page-head">
        <h1 className="text-3xl font-semibold">公開資料與校園服務</h1>
      </header>

      <PublicHomeServices initialClosedModuleIds={initialClosedModuleIds} />

    </div>
  );
}
