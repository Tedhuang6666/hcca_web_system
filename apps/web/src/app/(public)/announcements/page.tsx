import AnnouncementsClient from "./client";
import { fetchAnnouncements } from "@/lib/serverFetch";

export default async function AnnouncementsPage() {
  const initialItems = await fetchAnnouncements(100);
  return <AnnouncementsClient initialItems={initialItems} />;
}
