import type { Metadata } from "next";
import { cookies } from "next/headers";

import { serverApiUrl } from "@/lib/config";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";
import type { MeetingMinutesOut, MeetingOut } from "@/lib/types";

import MeetingDetailPageClient from "./MeetingDetailPageClient";

async function authHeaders() {
  const cookie = (await cookies()).toString();
  return cookie ? { Cookie: cookie } : undefined;
}

async function fetchMeeting(id: string): Promise<MeetingOut | null> {
  const res = await fetch(serverApiUrl(`/meetings/${encodeURIComponent(id)}`), {
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchMinutes(id: string): Promise<MeetingMinutesOut | null> {
  const res = await fetch(serverApiUrl(`/meetings/${encodeURIComponent(id)}/minutes`), {
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const meeting = await fetchMeeting(id);
  const title = meeting?.title ?? "會議紀錄";
  const description = excerpt(
    meeting?.description ?? meeting?.screen_focus_body,
    "班聯會會議資訊與會議紀錄。",
  );

  return pageMetadata({
    title,
    description,
    path: `/meetings/${encodeURIComponent(id)}`,
  });
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meeting = await fetchMeeting(id);
  const minutes = meeting?.status === "closed" ? await fetchMinutes(id) : null;
  const path = `/meetings/${encodeURIComponent(id)}`;

  return (
    <>
      {meeting && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Event",
            name: meeting.title,
            description: excerpt(
              minutes?.markdown ?? meeting.description ?? meeting.screen_focus_body,
              "班聯會會議資訊與會議紀錄。",
            ),
            startDate: meeting.starts_at,
            endDate: meeting.ends_at,
            eventStatus:
              meeting.status === "closed"
                ? "https://schema.org/EventCompleted"
                : "https://schema.org/EventScheduled",
            location: meeting.location
              ? { "@type": "Place", name: meeting.location }
              : undefined,
            organizer: { "@type": "Organization", name: "新竹高中班聯會" },
            mainEntityOfPage: absoluteUrl(path),
          }}
        />
      )}
      <MeetingDetailPageClient params={params} initialMeeting={meeting} initialMinutes={minutes} />
    </>
  );
}
