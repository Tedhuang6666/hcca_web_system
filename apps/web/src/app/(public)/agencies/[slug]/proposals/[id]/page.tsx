import "../../../agencies.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import {
  CASE_TYPE_LABEL,
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STEPS,
  formatTwDate,
} from "@/lib/agency-meta";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicAgency, fetchPublicProposal, fetchPublicShellData } from "@/lib/serverFetch";

type Params = Promise<{ slug: string; id: string }>;

const KIND_LABEL: Record<string, string> = { enact: "制定", amend: "修正", abolish: "廢止" };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, id } = await params;
  const [agency, proposal] = await Promise.all([fetchPublicAgency(slug), fetchPublicProposal(id)]);
  if (!agency || agency.agency.branch !== "legislative" || !proposal) return {};
  return pageMetadata({
    title: `${proposal.serial_number} ${proposal.title}`,
    description: proposal.summary.slice(0, 120),
    path: `/agencies/${encodeURIComponent(slug)}/proposals/${encodeURIComponent(id)}`,
    type: "article",
  });
}

function Block({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <section className="agency-section" aria-label={title}>
      <h2 className="agency-section-title">{title}</h2>
      <p className="agency-proposal-text">{text}</p>
    </section>
  );
}

export default async function ProposalPage({ params }: { params: Params }) {
  const { slug, id } = await params;
  const [{ bundle, urgentAnnouncement }, agency, proposal] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicAgency(slug),
    fetchPublicProposal(id),
  ]);
  if (!agency || agency.agency.branch !== "legislative" || !proposal) notFound();

  const rejected = proposal.status === "rejected";
  const current = PROPOSAL_STEPS.indexOf(proposal.status);
  const caseType = CASE_TYPE_LABEL[proposal.case_type] ?? proposal.case_type;

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <article className="agency">
        <header className="public-page-head agency-head">
          <Link href={`/agencies/${encodeURIComponent(slug)}#tracking`} className="agency-back">
            <ArrowLeft size={16} aria-hidden />{agency.agency.name}議案追蹤
          </Link>
          <p className="agency-meta">
            <span>{proposal.serial_number}</span>
            <span>{proposal.kind ? `${caseType}・${KIND_LABEL[proposal.kind] ?? proposal.kind}` : caseType}</span>
          </p>
          <h1 className="text-3xl font-bold">{proposal.title}</h1>
        </header>

        <dl className="agency-facts">
          <div><dt>提案人</dt><dd>{proposal.proposer_name}</dd></div>
          {proposal.co_sponsors && <div><dt>連署人</dt><dd>{proposal.co_sponsors}</dd></div>}
          <div><dt>提出日期</dt><dd>{formatTwDate(proposal.created_at)}</dd></div>
          <div>
            <dt>進度</dt>
            <dd className={rejected ? "agency-status is-muted" : "agency-status"}>
              {PROPOSAL_STATUS_LABEL[proposal.status] ?? proposal.status}
              {proposal.decided_at && <span className="agency-meta">{formatTwDate(proposal.decided_at)}</span>}
            </dd>
          </div>
        </dl>

        {!rejected && (
          <ol className="agency-proposal-steps" aria-label="審議進度">
            {PROPOSAL_STEPS.map((step, index) => (
              <li
                key={step}
                data-state={index < current ? "done" : index === current ? "current" : "todo"}
                aria-current={index === current ? "step" : undefined}
              >
                {PROPOSAL_STATUS_LABEL[step]}
              </li>
            ))}
          </ol>
        )}

        <Block title="案由" text={proposal.summary} />
        <Block title="法源依據" text={proposal.legal_basis} />
        <Block title="提案內容" text={proposal.proposal_text} />
        <Block title="提案理由" text={proposal.rationale} />
        <Block title="預期效益" text={proposal.expected_effect} />
      </article>
    </PublicSiteShell>
  );
}
