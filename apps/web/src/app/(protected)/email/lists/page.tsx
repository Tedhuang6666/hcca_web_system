"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useOrgOptions } from "@/components/ui/targeting";
import { emailApi, apiErrorMessage } from "@/lib/api";
import type { EmailRecipientListOut, EmailResourceVisibility } from "@/lib/types";

const EMPTY_RECIPIENTS = {
  user_ids: [], position_ids: [], org_ids: [], external_emails: [],
  include_all: false, include_school: false,
};
const SCHOOL_EMAIL_DOMAIN = "hchs.hc.edu.tw";

function toSchoolEmail(value: string): { email: string; converted: boolean } {
  const input = value.trim();
  const studentId = input.match(/^(?:g0)?(\d{6,12})$/i)?.[1];
  return studentId
    ? { email: `g0${studentId}@${SCHOOL_EMAIL_DOMAIN}`, converted: true }
    : { email: input, converted: false };
}

export default function EmailListsPage() {
  const orgs = useOrgOptions();
  const [rows, setRows] = useState<EmailRecipientListOut[]>([]);
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [visibility, setVisibility] = useState<EmailResourceVisibility>("private");
  const [orgId, setOrgId] = useState("");

  const load = () =>
    emailApi
      .listRecipientLists()
      .then(setRows)
      .catch((e) => toast.error(apiErrorMessage(e, "載入名單失敗")));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    let convertedCount = 0;
    const members = raw
      .split(/\r?\n/)
      .map((line) => line.split(/[\t,]/).map((cell) => cell.trim()))
      .filter(([address]) => address && !["學號", "email", "電子郵件"].includes(address.toLowerCase()))
      .map(([address, memberName]) => {
        const resolved = toSchoolEmail(address);
        if (resolved.converted) convertedCount += 1;
        return { email: resolved.email, name: memberName || null, variables: {} };
      });
    if (!name.trim() || members.length === 0) return toast.error("請填寫名稱與至少一位收件人");
    try {
      await emailApi.createRecipientList({
        name: name.trim(),
        visibility,
        org_id: visibility === "org" ? orgId : null,
        recipient_spec: EMPTY_RECIPIENTS,
        variable_definitions: [],
        members,
      });
      setName("");
      setRaw("");
      load();
      toast.success(
        convertedCount
          ? `名單已建立：${convertedCount} 筆學號已換為校務信箱，並自動去除重複 Email`
          : "名單已建立並自動去除重複 Email",
      );
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立名單失敗"));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>EMAIL</p>
          <h1 className="mt-1 text-xl font-semibold">收件名單</h1>
        </div>
        <Link href="/email" className="btn btn-primary btn-sm">返回寄信</Link>
      </header>
      <section className="card space-y-3 p-4">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="名單名稱" />
        <textarea
          className="input min-h-36 font-mono text-xs"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"每行一位，可使用 Email 或學號,姓名，也可從試算表貼上\ng0108123456@hchs.hc.edu.tw,王小明\n108123456,王小明"}
        />
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          純學號會自動轉為 g0＋學號＠{SCHOOL_EMAIL_DOMAIN}。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as EmailResourceVisibility)}>
            <option value="private">私人名單</option>
            <option value="org">組織共享名單</option>
          </select>
          {visibility === "org" && (
            <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">選擇組織</option>
              {orgs.map((org) => <option key={org.value} value={org.value}>{org.label}</option>)}
            </select>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={create}>建立名單</button>
      </section>
      <section className="card overflow-hidden">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{row.name}</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {row.visibility === "org" ? "組織共享" : "私人"} · {row.members.length} 人
              </p>
            </div>
            <Link href={`/email?list=${row.id}`} className="btn btn-secondary btn-sm">使用</Link>
            <button className="btn btn-ghost btn-sm" onClick={async () => { await emailApi.deleteRecipientList(row.id); load(); }}>停用</button>
          </div>
        ))}
      </section>
    </div>
  );
}
