"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type PeopleManagementSection =
  | "people"
  | "organization"
  | "classes";

export default function PeopleManagementRedirect({ section }: { section: PeopleManagementSection }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/admin/people?section=${section}`);
  }, [router, section]);

  return <div className="p-6 text-sm" role="status" style={{ color: "var(--text-muted)" }}>正在開啟人員管理…</div>;
}
