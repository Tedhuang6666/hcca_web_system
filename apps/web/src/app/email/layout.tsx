"use client";

import ModuleTabs from "@/components/layout/ModuleTabs";
import { BarChart3, History, MailPlus, Users, WandSparkles } from "lucide-react";

export default function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleTabs
        label="電子郵件分頁"
        tabs={[
          { href: "/email", label: "撰寫", icon: MailPlus, end: true },
          { href: "/email/logs", label: "紀錄", icon: History },
          { href: "/email/templates", label: "範本", icon: WandSparkles },
          { href: "/email/lists", label: "名單", icon: Users },
          { href: "/email/analytics", label: "分析", icon: BarChart3 },
        ]}
      />
      {children}
    </>
  );
}
