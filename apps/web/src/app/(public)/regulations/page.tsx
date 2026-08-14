import RegulationsClient from "./client";
import { fetchPublicRegulations } from "@/lib/serverFetch";

export default async function RegulationsPage() {
  const initialRegs = await fetchPublicRegulations();
  return <RegulationsClient initialRegs={initialRegs} />;
}
