import { fetchPublicDocument } from "@/lib/publicSeoFetch";

import DocumentDetailEntry from "./DocumentDetailEntry";

export default async function DocumentDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await fetchPublicDocument(id);
  return <DocumentDetailEntry initialDoc={document} />;
}
