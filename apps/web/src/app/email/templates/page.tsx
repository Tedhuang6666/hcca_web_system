"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useOrgOptions } from "@/components/ui/targeting";
import { emailApi, apiErrorMessage } from "@/lib/api";
import type { EmailResourceVisibility, EmailTemplateOut } from "@/lib/types";

export default function EmailTemplatesPage() {
  const orgs = useOrgOptions();
  const [rows, setRows] = useState<EmailTemplateOut[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<EmailResourceVisibility>("private");
  const [orgId, setOrgId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    emailApi
      .listTemplates()
      .then(setRows)
      .catch((e) => toast.error(apiErrorMessage(e, "載入範本失敗")));

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!name.trim()) return toast.error("請填寫範本名稱");
    if (visibility === "org" && !orgId) return toast.error("請選擇共享組織");
    setBusy(true);
    try {
      await emailApi.createTemplate({
        name: name.trim(),
        visibility,
        org_id: visibility === "org" ? orgId : null,
        content: {
          subject,
          heading: "",
          body,
          banner_image_url: "",
          banner_image_alt: "",
          card_rows: [],
          cta_label: "",
          cta_url: "",
          buttons: [],
          blocks: [],
          recipients: {
            user_ids: [], position_ids: [], org_ids: [], external_emails: [],
            include_all: false, include_school: false,
          },
        },
        variable_definitions: [],
      });
      setName("");
      setSubject("");
      setBody("");
      load();
      toast.success("範本已建立");
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立範本失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>EMAIL</p>
          <h1 className="mt-1 text-xl font-semibold">郵件範本</h1>
        </div>
        <Link href="/email" className="btn btn-primary btn-sm">返回寄信</Link>
      </header>

      <section className="card grid gap-3 p-4 md:grid-cols-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="範本名稱" />
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="預設主旨" />
        <textarea className="input min-h-28 md:col-span-2" value={body} onChange={(e) => setBody(e.target.value)} placeholder="預設內文，可使用佔位符" />
        <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as EmailResourceVisibility)}>
          <option value="private">私人範本</option>
          <option value="org">組織共享範本</option>
        </select>
        {visibility === "org" && (
          <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">選擇組織</option>
            {orgs.map((org) => <option key={org.value} value={org.value}>{org.label}</option>)}
          </select>
        )}
        <button className="btn btn-primary btn-sm md:col-span-2" disabled={busy} onClick={create}>建立範本</button>
      </section>

      <section className="card overflow-hidden">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{row.is_favorite ? "★ " : ""}{row.name}</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {row.visibility === "org" ? "組織共享" : "私人"} · v{row.current_version} · {(row.content as Record<string, string>).subject || "無預設主旨"}
              </p>
            </div>
            <Link href={`/email?template=${row.id}`} className="btn btn-secondary btn-sm">使用</Link>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await emailApi.updateTemplate(row.id, { is_favorite: !row.is_favorite });
                load();
              }}
            >
              {row.is_favorite ? "取消常用" : "設為常用"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await emailApi.deleteTemplate(row.id);
                load();
              }}
            >
              停用
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
