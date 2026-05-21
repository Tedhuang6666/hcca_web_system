import Link from "next/link";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { serverApiUrl } from "@/lib/config";
import {
  SOCIAL_IMAGE,
  SOCIAL_SHARE_TITLE,
  SOCIAL_SITE_NAME,
  socialDescription,
} from "@/lib/social-metadata";

type RecipientOut = { id: string; recipient_type: string; name: string; email: string | null };
type AttachmentOut = {
  id: string;
  filename: string;
  content_type: string | null;
  file_size: number | null;
  url: string;
  link_url: string | null;
  uploaded_by: string;
  created_at: string;
};

type DocumentOut = {
  id: string;
  serial_number: string;
  title: string;
  urgency: string;
  classification: string;
  category: string;
  subject: string | null;
  doc_description: string | null;
  action_required: string | null;
  content: string;
  status: string;
  issued_at: string | null;
  due_date: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  visibility_level: string;
  is_public: boolean;
  org_id: string;
  created_by: string;
  attachments: AttachmentOut[];
  recipients: RecipientOut[];
};

async function fetchDoc(idOrSerial: string): Promise<DocumentOut | null> {
  const res = await fetch(serverApiUrl(`/documents/${idOrSerial}`), { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const doc = await fetchDoc(encodeURIComponent(id));
  const docTitle = doc?.title ?? "公文";
  const detail = doc
    ? `${doc.title}${doc.serial_number ? `｜${doc.serial_number}` : ""}`
    : docTitle;
  const desc = socialDescription("公文", detail, "公開公文查閱。");
  return {
    title: SOCIAL_SHARE_TITLE,
    description: desc,
    alternates: { canonical: `/public/documents/${id}` },
    openGraph: {
      title: SOCIAL_SHARE_TITLE,
      description: desc,
      type: "article",
      url: `/public/documents/${id}`,
      siteName: SOCIAL_SITE_NAME,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: SOCIAL_SHARE_TITLE,
      description: desc,
      images: [SOCIAL_IMAGE.url],
    },
  };
}

function fmtSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function PublicDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await fetchDoc(encodeURIComponent(id));

  if (!doc) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "var(--danger)" }}>
        找不到此公文或尚未公開
      </div>
    );
  }

  const isDecree = doc.category === "decree";
  const primaryRecipients = doc.recipients
    .filter(r => r.recipient_type === "main" || r.recipient_type === "primary");
  const decreeBody = doc.doc_description || doc.content || doc.action_required || doc.subject;

  return (
    <div className="space-y-5">
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        <Link href="/public/documents" className="hover:underline" style={{ color: "var(--text-muted)" }}>
          公開公文
        </Link>
        <span> / </span>
        <span className="font-mono" style={{ color: "var(--primary)" }}>
          {doc.serial_number}
        </span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {doc.title}
          </h1>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            建立 {new Date(doc.created_at).toLocaleDateString("zh-TW")}
            {"　·　"}更新 {new Date(doc.updated_at).toLocaleDateString("zh-TW")}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Link
            href={`/documents/${encodeURIComponent(doc.serial_number)}`}
            className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
          >
            管理端檢視
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
        <article className="card overflow-hidden">
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              公文內容
            </span>
          </div>
          <div className="p-6 space-y-5">
            {isDecree ? (
              <div className="space-y-4">
                <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  <p>發文字號：{doc.serial_number}</p>
                  <p>發文日期：{new Date(doc.completed_at ?? doc.submitted_at ?? doc.created_at).toLocaleDateString("zh-TW")}</p>
                  {primaryRecipients.length > 0 && (
                    <p>受文者：{primaryRecipients.map(r => r.name).join("、")}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    令文
                  </p>
                  <div className="mt-2 text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                    {decreeBody || "（尚無令文內容）"}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {doc.subject && (
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      主旨
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                      {doc.subject}
                    </p>
                  </div>
                )}
                {doc.doc_description && (
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      說明
                    </p>
                    <div className="mt-1 text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                      {doc.doc_description}
                    </div>
                  </div>
                )}
                {doc.action_required && (
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      辦法
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                      {doc.action_required}
                    </p>
                  </div>
                )}
                {!doc.subject && !doc.doc_description && !doc.action_required && doc.content && (
                  <div className="prose prose-sm max-w-none" style={{ color: "var(--text-primary)" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
                  </div>
                )}
              </>
            )}
          </div>
        </article>

        <aside className="space-y-3 lg:sticky lg:top-[88px]">
          <div className="card p-4">
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
              基本資訊
            </p>
            <dl className="grid grid-cols-2 gap-3 text-xs mt-3">
              {([
                ["字號", doc.serial_number],
                ["類別", doc.category],
                ["密等", doc.classification],
                ["可見度", doc.visibility_level],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
                  <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {doc.recipients?.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                受文者
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {doc.recipients.map((r) => (
                  <span
                    key={r.id}
                    className="text-xs px-2.5 py-1 rounded-full"
                    style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card p-4">
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
              附件
            </p>
            {doc.attachments?.length ? (
              <ul className="mt-3 space-y-2">
                {doc.attachments.map((a) => {
                  const isLink = Boolean(a.link_url);
                  const isPdf = !isLink && (
                    a.content_type === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf")
                  );
                  const isImg = !isLink && (
                    (a.content_type?.startsWith("image/") ?? false) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.filename)
                  );
                  const href = isLink ? a.link_url! : a.url;
                  return (
                    <li key={a.id} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                      <div className="px-3 py-2 text-xs flex items-center justify-between gap-2" style={{ background: "var(--bg-elevated)" }}>
                        <a href={href} target="_blank" rel="noreferrer" className="truncate hover:underline" style={{ color: "var(--primary)" }}>
                          {a.filename}
                        </a>
                        {!isLink && a.file_size != null && (
                          <span style={{ color: "var(--text-muted)" }}>{fmtSize(a.file_size)}</span>
                        )}
                      </div>
                      {isImg && a.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.filename} className="w-full max-h-64 object-contain" style={{ background: "var(--bg-surface)" }} />
                      )}
                      {isPdf && a.url && (
                        <object data={a.url} type="application/pdf" className="w-full" style={{ height: 420, display: "block" }}>
                          <div className="p-3 text-xs" style={{ color: "var(--text-muted)" }}>
                            瀏覽器不支援 PDF 預覽，請
                            <a href={a.url} target="_blank" rel="noreferrer" className="ml-1 hover:underline" style={{ color: "var(--primary)" }}>
                              下載查看
                            </a>
                            。
                          </div>
                        </object>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                尚無附件
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
