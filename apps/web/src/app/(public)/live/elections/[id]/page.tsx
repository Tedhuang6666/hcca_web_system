import LiveElectionBoard from "@/components/elections/LiveElectionBoard";

export default async function ElectionLivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LiveElectionBoard electionId={id} />;
}
