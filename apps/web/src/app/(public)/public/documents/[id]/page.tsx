import { permanentRedirect } from "next/navigation";

import { fetchPublicDocumentResult } from "@/lib/publicSeoFetch";

export default async function LegacyPublicDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchPublicDocumentResult(id);
  const identifier = result.data?.serial_number || result.data?.id || id;
  permanentRedirect(`/documents/${encodeURIComponent(identifier)}`);
}
