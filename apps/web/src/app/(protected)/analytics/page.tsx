import { redirect } from "next/navigation";

export default function AnalyticsPage() {
  redirect("/admin/system?tab=performance");
}
