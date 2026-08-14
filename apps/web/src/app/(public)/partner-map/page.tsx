import PartnerMapClient from "./client";
import { fetchPublicPartnerMapData } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "合作商家地圖",
  description: "探索校園自治平台合作商家與學生優惠資訊。",
  path: "/partner-map",
  type: "website",
});

export type PartnerMapPageProps = {
  initialBusinessSlug?: string;
};

export default async function PartnerMapPage({ initialBusinessSlug }: PartnerMapPageProps = {}) {
  const initialData = await fetchPublicPartnerMapData();
  return <PartnerMapClient initialBusinessSlug={initialBusinessSlug} {...initialData} />;
}
