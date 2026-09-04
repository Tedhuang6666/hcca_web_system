"use client";

import { useEffect, useMemo, useState } from "react";

import { emailApi } from "@/lib/api";
import type { EmailPosition } from "@/lib/types";

type OrganizationRecipient = {
  id: string;
  name: string;
  target_org_id?: string;
  email_position_ids?: string[];
};

export function OrganizationEmailRecipientSettings({
  recipients,
  onPositionsChange,
}: {
  recipients: OrganizationRecipient[];
  onPositionsChange: (recipientId: string, positionIds: string[]) => void;
}) {
  const organizationKey = useMemo(
    () => [...new Set(recipients.map((recipient) => recipient.target_org_id).filter(Boolean))].join(","),
    [recipients],
  );
  const organizationIds = useMemo(
    () => (organizationKey ? organizationKey.split(",") : []),
    [organizationKey],
  );
  const [positionsByOrganization, setPositionsByOrganization] = useState<Record<string, EmailPosition[]>>({});
  const [loadingOrganizations, setLoadingOrganizations] = useState<string[]>([]);
  const [failedOrganizations, setFailedOrganizations] = useState<string[]>([]);

  useEffect(() => {
    if (!organizationIds.length) {
      setPositionsByOrganization({});
      setLoadingOrganizations([]);
      setFailedOrganizations([]);
      return;
    }

    let active = true;
    setLoadingOrganizations(organizationIds);
    setFailedOrganizations([]);
    Promise.all(
      organizationIds.map(async (organizationId) => {
        try {
          const positions = await emailApi.orgPositions(organizationId);
          return { organizationId, positions };
        } catch {
          return { organizationId, positions: null };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setPositionsByOrganization(
        Object.fromEntries(
          results
            .filter((result): result is { organizationId: string; positions: EmailPosition[] } => result.positions !== null)
            .map((result) => [result.organizationId, result.positions]),
        ),
      );
      setFailedOrganizations(
        results.filter((result) => result.positions === null).map((result) => result.organizationId),
      );
      setLoadingOrganizations([]);
    });

    return () => {
      active = false;
    };
  }, [organizationKey, organizationIds]);

  return (
    <section className="border-t pt-4 space-y-3" style={{ borderColor: "var(--border)" }}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          機關 Email 通知
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          選擇機關中的職位；公文核准或直接發文時，會通知當時在任且有信箱的人。
        </p>
      </div>

      {!recipients.length ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          先在上方新增機關受文者，再選擇通知職位。
        </p>
      ) : recipients.map((recipient) => {
        const organizationId = recipient.target_org_id;
        if (!organizationId) return null;
        const positions = positionsByOrganization[organizationId] ?? [];
        const selected = new Set(recipient.email_position_ids ?? []);
        const isLoading = loadingOrganizations.includes(organizationId);
        const hasFailed = failedOrganizations.includes(organizationId);

        return (
          <div key={recipient.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                {recipient.name}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {selected.size ? `已選 ${selected.size} 個職位` : "未設定通知職位"}
              </span>
            </div>
            {isLoading ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>載入職位中…</p>
            ) : hasFailed ? (
              <p className="text-xs" style={{ color: "var(--danger)" }}>無法載入此機關職位，請稍後再試。</p>
            ) : positions.length ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {positions.map((position) => (
                  <label
                    key={position.id}
                    className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-xs"
                    style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(position.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(position.id);
                        else next.delete(position.id);
                        onPositionsChange(recipient.id, [...next]);
                      }}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    <span style={{ color: "var(--text-primary)" }}>{position.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>此機關目前沒有可通知的職位。</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
