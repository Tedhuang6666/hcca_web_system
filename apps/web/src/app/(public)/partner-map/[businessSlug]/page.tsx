import PartnerMapPage from "../page";

export default async function PartnerBusinessPage({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  return <PartnerMapPage initialBusinessSlug={businessSlug} />;
}
