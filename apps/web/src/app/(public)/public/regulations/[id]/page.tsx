import { notFound, permanentRedirect } from "next/navigation";

import { regulationHref } from "@/lib/api/regulations";
import { fetchPublicRegulation } from "@/lib/publicSeoFetch";

export default async function LegacyPublicRegulationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const regulation = await fetchPublicRegulation(id);
  if (!regulation) notFound();

  permanentRedirect(regulationHref(regulation));
}
