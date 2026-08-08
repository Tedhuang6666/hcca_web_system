import "leaflet/dist/leaflet.css";

import type { Metadata } from "next";

import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { pageMetadata } from "@/lib/seo";
import PartnerMapTabs from "./PartnerMapTabs";

export const metadata: Metadata = pageMetadata({
  title: "特約地圖",
  description: "探索新竹高中班聯會合作店家、校園周邊特約優惠與店家位置。",
  path: "/partner-map",
  type: "website",
});

export default function PartnerMapLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://b.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossOrigin="" />
      <ModuleBoundary id="partnerMap" skeleton={<ListPageSkeleton />}>
        <PartnerMapTabs />
        {children}
      </ModuleBoundary>
    </>
  );
}
