import Link from "next/link";
import { ArrowRight } from "lucide-react";

import AgencyLink from "@/components/agencies/AgencyLink";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicOfficerDirectory from "@/components/site/PublicOfficerDirectory";
import {
  BODY_LABEL,
  BRANCH_KINDS,
  BRANCH_META,
  CASE_TYPE_LABEL,
  DELEGATION_STAGES,
  KIND_META,
  OUTCOME_LABEL,
  PROPOSAL_STATUS_LABEL,
  STATUS_LABEL,
  formatTwDate,
  type AgencyEntryKind,
} from "@/lib/agency-meta";
import type { AgencyEntryOut, AgencyLinkedRecord, AgencyPublicOut } from "@/lib/types";

const MEMBER_HEADING = {
  executive: "團隊成員",
  legislative: "議員",
  judicial: "評議委員",
  delegation: "代表團成員",
} as const;

// 日期在左的條列；其餘類型以內容為主。
const ROW_KINDS = new Set<AgencyEntryKind>(["session", "achievement", "document", "meeting", "event"]);
const NEGATIVE = new Set(["rejected", "dismissed", "withdrawn"]);

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="agency-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="agency-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Status({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return null;
  return (
    <span className={NEGATIVE.has(value) ? "agency-status is-muted" : "agency-status"}>
      {label ?? STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? value}
    </span>
  );
}

function EntryBody({ entry }: { entry: AgencyEntryOut }) {
  const bodyLabel = BODY_LABEL[entry.kind];
  const outcomeLabel = OUTCOME_LABEL[entry.kind];
  return (
    <>
      {entry.summary && <p className="agency-summary">{entry.summary}</p>}
      {entry.body_md && (
        <div className="agency-block">
          {bodyLabel && <h4>{bodyLabel}</h4>}
          <MarkdownBlock markdown={entry.body_md} />
        </div>
      )}
      {entry.outcome_md && (
        <div className="agency-block">
          {outcomeLabel && <h4>{outcomeLabel}</h4>}
          <MarkdownBlock markdown={entry.outcome_md} />
        </div>
      )}
      {entry.link_url && <AgencyLink href={entry.link_url} title={entry.title} />}
    </>
  );
}

function EntryList({ entries, kind }: { entries: AgencyEntryOut[]; kind: AgencyEntryKind }) {
  const dated = ROW_KINDS.has(kind);
  return (
    <ul className={dated ? "agency-list is-dated" : "agency-list"}>
      {entries.map((entry) => (
        <li key={entry.id}>
          {dated && (
            <time className="agency-meta" dateTime={entry.occurred_on ?? undefined}>
              {entry.occurred_on ? formatTwDate(entry.occurred_on) : ""}
            </time>
          )}
          <div className="agency-item">
            <h3>{entry.title}</h3>
            {(entry.reference_no || entry.status || (!dated && entry.occurred_on)) && (
              <p className="agency-meta">
                {!dated && entry.occurred_on && <time dateTime={entry.occurred_on}>{formatTwDate(entry.occurred_on)}</time>}
                {entry.reference_no && <span>{entry.reference_no}</span>}
                <Status value={entry.status} />
              </p>
            )}
            <EntryBody entry={entry} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BillTracker({ records, slug }: { records: AgencyLinkedRecord[]; slug: string }) {
  if (records.length === 0) return <p className="agency-empty">目前沒有受理中的議案</p>;
  return (
    <div className="agency-table-wrap">
      <table className="agency-table">
        <thead>
          <tr><th scope="col">案號</th><th scope="col">案由</th><th scope="col">提案人</th><th scope="col">進度</th></tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td className="agency-nowrap">{record.reference_no}</td>
              <td>
                <span className="agency-meta">{CASE_TYPE_LABEL[record.category] ?? record.category}</span>
                <Link href={`/agencies/${encodeURIComponent(slug)}/proposals/${record.id}`} className="agency-table-link">
                  {record.title}
                </Link>
              </td>
              <td className="agency-nowrap">{record.proposer_name}</td>
              <td className="agency-nowrap">
                <Status value={record.status} label={PROPOSAL_STATUS_LABEL[record.status]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Decisions({ entries, records }: { entries: AgencyEntryOut[]; records: AgencyLinkedRecord[] }) {
  if (entries.length === 0 && records.length === 0) return <p className="agency-empty">尚無公布的評議書</p>;
  return (
    <div className="agency-decisions">
      {entries.map((entry) => (
        <article key={entry.id} className="card agency-decision">
          <p className="agency-meta">
            {entry.reference_no && <span>{entry.reference_no}</span>}
            {entry.occurred_on && <time dateTime={entry.occurred_on}>{formatTwDate(entry.occurred_on)}</time>}
            <Status value={entry.status} />
          </p>
          <h3>{entry.title}</h3>
          <EntryBody entry={entry} />
        </article>
      ))}
      {records.map((record) => (
        <article key={record.id} className="card agency-decision">
          <p className="agency-meta">
            <span>{record.reference_no}</span>
            <span>{CASE_TYPE_LABEL[record.category] ?? record.category}</span>
            {record.decided_at && <time dateTime={record.decided_at}>{formatTwDate(record.decided_at)}</time>}
          </p>
          <h3>{record.title}</h3>
          {record.summary && (
            <div className="agency-block"><h4>主文</h4><MarkdownBlock markdown={record.summary} /></div>
          )}
        </article>
      ))}
    </div>
  );
}

function DelegationStages({ proposals }: { proposals: AgencyEntryOut[] }) {
  return (
    <ol className="agency-stages">
      {DELEGATION_STAGES.map((stage) => (
        <li key={stage.label}>
          <span>{stage.label}</span>
          <strong>{proposals.filter((entry) => entry.status && stage.statuses.includes(entry.status)).length}</strong>
        </li>
      ))}
    </ol>
  );
}

export default function AgencyPage({ data }: { data: AgencyPublicOut }) {
  const { agency, members, linked_records: records } = data;
  const branch = agency.branch;
  const grouped: Partial<Record<AgencyEntryKind, AgencyEntryOut[]>> = {};
  for (const entry of data.entries) (grouped[entry.kind] ??= []).push(entry);
  // 這些類型有專屬區塊，不走通用條列。
  const custom = new Set<AgencyEntryKind>(
    branch === "judicial" ? ["procedure", "template", "decision"] : branch === "delegation" ? ["proposal"] : [],
  );
  const membersSection = members.length > 0 && (
    <Section id="members" title={MEMBER_HEADING[branch]}>
      <PublicOfficerDirectory officers={members} showHeading={false} />
    </Section>
  );

  return (
    <div className="agency" data-branch={branch}>
      <header className="public-page-head agency-head">
        <p className="agency-meta">{BRANCH_META[branch].label}</p>
        <h1 className="text-3xl font-bold">{agency.name}</h1>
        {agency.tagline && <p className="agency-tagline">{agency.tagline}</p>}
      </header>

      {(agency.intro_md || agency.mandate_md) && (
        <div className="agency-intro">
          {agency.intro_md && <MarkdownBlock markdown={agency.intro_md} />}
          {agency.mandate_md && (
            <aside className="card agency-mandate">
              <h2>{branch === "judicial" ? "職權與中立" : "職權與法源"}</h2>
              <MarkdownBlock markdown={agency.mandate_md} />
            </aside>
          )}
        </div>
      )}

      {branch === "executive" && membersSection}

      {branch === "legislative" && (
        <Section id="tracking" title="議案追蹤"><BillTracker records={records} slug={agency.slug} /></Section>
      )}

      {branch === "judicial" && (
        <>
          <Section id="procedure" title="聲請程序">
            {grouped.procedure && (
              <ol className="agency-steps">
                {grouped.procedure.map((entry) => (
                  <li key={entry.id}><h3>{entry.title}</h3><EntryBody entry={entry} /></li>
                ))}
              </ol>
            )}
            <Link href="/judicial-petitions" className="btn btn-primary">
              提出評議聲請<ArrowRight size={16} aria-hidden />
            </Link>
          </Section>
          {grouped.template && (
            <Section id="template" title={KIND_META.template.label}>
              <EntryList entries={grouped.template} kind="template" />
            </Section>
          )}
          <Section id="decision" title="評議書">
            <Decisions entries={grouped.decision ?? []} records={records} />
          </Section>
        </>
      )}

      {branch === "delegation" && grouped.proposal && (
        <Section id="proposal" title={KIND_META.proposal.label}>
          <DelegationStages proposals={grouped.proposal} />
          <EntryList entries={grouped.proposal} kind="proposal" />
        </Section>
      )}

      {BRANCH_KINDS[branch].filter((kind) => !custom.has(kind) && grouped[kind]).map((kind) => (
        <Section key={kind} id={kind} title={KIND_META[kind].label}>
          <EntryList entries={grouped[kind] ?? []} kind={kind} />
        </Section>
      ))}

      {branch !== "executive" && membersSection}

      {agency.contact_md && (
        <Section id="contact" title="聯絡方式"><MarkdownBlock markdown={agency.contact_md} /></Section>
      )}
    </div>
  );
}
