import PartnerMapPage from "../page";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  const name = decodeURIComponent(businessSlug).replace(/[-_]+/g, " ").trim();
  return pageMetadata({
    title: name ? `${name}｜合作商家` : "合作商家",
    description: "查看 HCCA 合作商家的店家資訊、位置與學生優惠。",
    path: `/partner-map/${encodeURIComponent(businessSlug)}`,
    imagePath: `/og/partner-map/${encodeURIComponent(businessSlug)}`,
    type: "website",
  });
}

export default async function PartnerBusinessPage({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  return <PartnerMapPage initialBusinessSlug={businessSlug} />;
}
