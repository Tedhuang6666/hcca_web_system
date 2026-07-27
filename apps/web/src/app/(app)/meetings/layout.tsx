"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { CalendarDays, Landmark } from "lucide-react";

export default function MeetingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="meetings" skeleton={<ListPageSkeleton />}>
      <ModuleTabs
        label="議事分頁"
        tabs={[
          { href: "/meetings", label: "會議", icon: Landmark, end: true },
          { href: "/meetings/calendar", label: "月曆", icon: CalendarDays },
        ]}
      />
      {children}
    </ModuleBoundary>
  );
}
