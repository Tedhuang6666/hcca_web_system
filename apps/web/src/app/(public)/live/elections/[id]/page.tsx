import LiveElectionBoard from "@/components/elections/LiveElectionBoard";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pageMetadata({
    title: "即時選舉開票",
    description: "查看校園選舉開票進度、候選人票數與最終結果。",
    path: `/live/elections/${encodeURIComponent(id)}`,
    imagePath: `/og/live/elections/${encodeURIComponent(id)}`,
    type: "website",
  });
}

export default async function ElectionLivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LiveElectionBoard electionId={id} />;
}
