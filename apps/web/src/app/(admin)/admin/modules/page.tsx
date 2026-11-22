import { redirect } from "next/navigation";

export default function ModulesPage() {
  redirect("/admin/system?tab=modules");
}
