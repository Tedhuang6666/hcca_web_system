import PartnerMapClient from "./client";
import { fetchPublicPartnerMapData } from "@/lib/serverFetch";

export type PartnerMapPageProps = {
  initialBusinessSlug?: string;
};

export default async function PartnerMapPage({ initialBusinessSlug }: PartnerMapPageProps = {}) {
  const initialData = await fetchPublicPartnerMapData();
  return <PartnerMapClient initialBusinessSlug={initialBusinessSlug} {...initialData} />;
}
