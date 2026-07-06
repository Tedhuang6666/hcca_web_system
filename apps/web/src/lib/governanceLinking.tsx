"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { ArrowRight, GitBranch } from "lucide-react";
import { governanceApi } from "@/lib/api";

export type GovernanceLinkContext = {
  matterId: string;
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
  const matterHref = `/governance/${context.matterId}`;
  return (
    <section
      className="overflow-hidden rounded-xl text-sm"
      style={{
        border: "1px solid var(--primary)",
        background: "linear-gradient(135deg, var(--primary-dim), var(--bg-elevated))",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--primary) 18%, transparent), var(--shadow-md)",
      }}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "var(--primary)",
              color: "var(--bg-base)",
              boxShadow: "0 10px 24px color-mix(in srgb, var(--primary) 26%, transparent)",
            }}
          >
            <GitBranch size={20} aria-hidden={true} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--primary)" }}>
              治理事件關聯
            </p>
            <p className="mt-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              建立完成後會自動關聯到
            </p>
            <Link
              href={matterHref}
              className="mt-1 block truncate text-lg font-semibold"
              style={{ color: "var(--primary)", textDecoration: "none" }}
              title={context.matterTitle}
            >
              {context.matterTitle}
            </Link>
          </div>
        </div>
        <Link
          href={matterHref}
          className="btn btn-primary flex-shrink-0 justify-center"
        >
          查看事件
          <ArrowRight size={15} aria-hidden={true} />
        </Link>
      </div>
    </section>
  );
}
