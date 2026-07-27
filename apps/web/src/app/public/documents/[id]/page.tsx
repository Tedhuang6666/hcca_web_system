import { notFound, permanentRedirect } from "next/navigation";

import { fetchPublicDocument } from "@/lib/publicSeoFetch";

export default async function LegacyPublicDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await fetchPublicDocument(id);
  if (!document) notFound();

  permanentRedirect(`/documents/${encodeURIComponent(document.serial_number || document.id)}`);
}
