import AnnouncementsClient from "./client";
import { fetchAnnouncements } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "最新公告",
  description: "查看校園自治平台發布的最新公告、重要通知與活動消息。",
  path: "/announcements",
  type: "website",
});

export default async function AnnouncementsPage() {
  const initialItems = await fetchAnnouncements(100);
  return <AnnouncementsClient initialItems={initialItems} />;
}
