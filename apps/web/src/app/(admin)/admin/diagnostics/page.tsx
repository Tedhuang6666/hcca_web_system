import { redirect } from "next/navigation";

export default function DiagnosticsPage() {
  redirect("/admin/system?tab=diagnostics");
}
