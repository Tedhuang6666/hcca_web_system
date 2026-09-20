import { notFound, permanentRedirect } from "next/navigation";

import { fetchPublicDocumentResult } from "@/lib/publicSeoFetch";

export default async function LegacyPublicDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchPublicDocumentResult(id);
  if (result.status === 404) notFound();
  if (!result.data) throw new Error("公開公文服務暫時無法使用");

  permanentRedirect(`/documents/${encodeURIComponent(result.data.serial_number || result.data.id)}`);
}
