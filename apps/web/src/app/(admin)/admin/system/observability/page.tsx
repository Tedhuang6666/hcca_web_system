import { redirect } from "next/navigation";

export default function ObservabilityPage() {
  redirect("/admin/system?tab=observability");
}
