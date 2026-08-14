import DocumentListClient from "./client";
import { fetchPublicDocuments } from "@/lib/serverFetch";

export default async function DocumentListPage() {
  const initialDocs = await fetchPublicDocuments({ limit: 20, offset: 0 });
  return <DocumentListClient initialDocs={initialDocs} />;
}
