"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { governanceApi } from "@/lib/api";

export type GovernanceLinkContext = {
  matterId: string;
  matterSlug: string | null;
  matterTitle: string;
  orgId: string | null;
};

export function governanceContextFromParams(
  searchParams: ReadonlyURLSearchParams,
): GovernanceLinkContext | null {
  const matterId = searchParams.get("governance_matter_id")?.trim();
  if (!matterId) return null;
  return {
    matterId,
    matterSlug: searchParams.get("governance_matter_slug")?.trim() || null,
    matterTitle: searchParams.get("title")?.trim() || "未命名事情",
    orgId: searchParams.get("org_id")?.trim() || null,
  };
}

export async function createGovernanceBacklink({
  context,
  targetType,
  targetId,
  title,
  href,
}: {
  context: GovernanceLinkContext | null;
  targetType: string;
  targetId: string;
  title: string;
  href: string;
}) {
  if (!context) return;
  await governanceApi.createRelation(context.matterId, {
    case_id: null,
    source_type: "matter",
    source_id: context.matterId,
    target_type: targetType,
    target_id: targetId,
    relation: "includes",
    title,
    href,
    note: `從事情「${context.matterTitle}」建立`,
    meta: { created_from_governance_form: true },
  });
}

export function GovernanceLinkNotice({ context }: { context: GovernanceLinkContext | null }) {
  if (!context) return null;
  return (
    <section
      className="rounded-lg p-3 text-sm"
      style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
    >
      <span style={{ color: "var(--text-muted)" }}>建立後會關聯到 </span>
      <Link href={`/governance/${context.matterSlug ?? context.matterId}`} className="font-medium" style={{ color: "var(--primary)" }}>
        {context.matterTitle}
      </Link>
    </section>
  );
}
