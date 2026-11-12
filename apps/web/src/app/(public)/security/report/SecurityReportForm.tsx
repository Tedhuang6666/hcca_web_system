"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Send, ShieldCheck } from "lucide-react";
import {
  apiErrorMessage,
  siteReportsApi,
  type SiteReportCreated,
  type SiteReportKind,
  type SiteReportPortal,
  type SiteReportSeverity,
} from "@/lib/api";

type FormState = {
  kind: SiteReportKind;
  severity: SiteReportSeverity;
  title: string;
  description: string;
  steps_to_reproduce: string;
  affected_url: string;
  contact_email: string;
  website: string;
};

const EMPTY_FORM: FormState = {
  kind: "vulnerability",
  severity: "medium",
  title: "",
  description: "",
  steps_to_reproduce: "",
  affected_url: "",
  contact_email: "",
  website: "",
};

function requiredMark() {
  return (
    <span className="ml-1 text-[var(--public-accent-text)]" aria-label="必填">
      *
    </span>
  );
}

export default function SecurityReportForm() {
  const [portal, setPortal] = useState<SiteReportPortal | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SiteReportCreated | null>(null);

  useEffect(() => {
    let cancelled = false;
    siteReportsApi
      .portal()
      .then((nextPortal) => {
        if (!cancelled) setPortal(nextPortal);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(apiErrorMessage(reason, "目前無法載入回報表單，請稍後再試。"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await siteReportsApi.create({
        kind: form.kind,
        severity: form.severity,
        title: form.title,
        description: form.description,
        steps_to_reproduce: form.steps_to_reproduce || null,
        affected_url: form.affected_url || null,
        contact_email: form.contact_email || null,
        website: form.website || null,
      });
      setCreated(result);
      setForm(EMPTY_FORM);
    } catch (reason) {
      setError(apiErrorMessage(reason, "送出失敗，請確認欄位內容後再試一次。"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <section className="card flex items-center gap-3 p-6 text-sm text-[var(--text-secondary)]" role="status">
        <LoaderCircle size={18} className="animate-spin" aria-hidden />
        正在載入回報表單…
      </section>
    );
  }

  if (error && !portal) {
    return (
      <section className="card p-6" role="alert">
        <p className="text-sm text-[var(--text-secondary)]">{error}</p>
      </section>
    );
  }

  if (!portal?.is_open) {
    return (
      <section className="card p-6 sm:p-8">
        <h2 className="text-xl font-semibold">目前暫停受理回報</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
          表單正在維護中，請稍後再回來，或透過聯絡頁面與我們聯繫。
        </p>
      </section>
    );
  }

  if (created) {
    return (
      <section className="card p-6 sm:p-8" role="status">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--brand-accent-dim)] text-[var(--public-accent)]">
          <CheckCircle2 size={22} aria-hidden />
        </span>
        <h2 className="mt-5 text-2xl font-semibold">已收到你的回報</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
          謝謝你協助改善網站。請保留以下回報編號，方便後續聯繫時對照：
        </p>
        <p className="mt-4 inline-flex rounded-lg border border-[var(--public-border)] bg-[var(--public-soft)] px-4 py-2 font-mono text-lg font-semibold tracking-wide">
          {created.reference_code}
        </p>
        <p className="mt-3 text-xs leading-6 text-[var(--text-secondary)]">
          若你留下聯絡 Email，我們會在需要釐清重現步驟時與你聯繫。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-primary min-h-11"
            onClick={() => setCreated(null)}
          >
            再回報一筆
          </button>
          <Link
            href="/"
            className="btn btn-secondary min-h-11"
          >
            回到首頁
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="card p-6 sm:p-8">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--public-border)] bg-[var(--public-soft)] p-4">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[var(--public-accent)]" aria-hidden />
        <p className="text-sm leading-7 text-[var(--text-secondary)]">{portal.notice}</p>
      </div>

      <div className="mt-7 grid gap-6">
        <fieldset>
          <legend className="text-sm font-semibold">
            回報類型{requiredMark()}
          </legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {portal.kinds.map((option) => {
              const checked = form.kind === option.value;
              return (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                    checked
                      ? "border-[var(--public-accent)] bg-[var(--public-soft)]"
                      : "border-[var(--public-border)] bg-[var(--public-surface)] hover:border-[var(--public-accent)]"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="radio"
                      name="kind"
                      value={option.value}
                      checked={checked}
                      onChange={() => update("kind", option.value as SiteReportKind)}
                      required
                      className="accent-[var(--public-accent)]"
                    />
                    {option.label}
                  </span>
                  <span className="mt-2 block text-xs leading-6 text-[var(--text-secondary)]">
                    {option.description}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-semibold">
              影響程度{requiredMark()}
            </span>
            <select
              className="input min-h-11 w-full"
              value={form.severity}
              onChange={(event) => update("severity", event.target.value as SiteReportSeverity)}
              required
            >
              {portal.severities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}－{option.description}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-semibold">發生問題的網址（選填）</span>
            <input
              type="text"
              className="input min-h-11 w-full"
              value={form.affected_url}
              onChange={(event) => update("affected_url", event.target.value)}
              placeholder="例如 /documents/123 或 https://…"
              maxLength={2000}
              inputMode="url"
            />
          </label>
        </div>

        <label className="space-y-2">
          <span className="block text-sm font-semibold">
            問題標題{requiredMark()}
          </span>
          <input
            type="text"
            className="input min-h-11 w-full"
            value={form.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder="用一句話說明問題"
            minLength={4}
            maxLength={200}
            required
          />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-semibold">
            問題描述{requiredMark()}
          </span>
          <textarea
            className="input min-h-36 w-full resize-y"
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="請描述你看到什麼、預期應該是什麼，以及是否會影響其他使用者。"
            minLength={10}
            maxLength={10000}
            required
          />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-semibold">重現步驟（選填）</span>
          <textarea
            className="input min-h-36 w-full resize-y"
            value={form.steps_to_reproduce}
            onChange={(event) => update("steps_to_reproduce", event.target.value)}
            placeholder={"1. 開啟…\n2. 點選…\n3. 看到…"}
            maxLength={10000}
          />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-semibold">聯絡 Email（選填）</span>
          <input
            type="email"
            className="input min-h-11 w-full"
            value={form.contact_email}
            onChange={(event) => update("contact_email", event.target.value)}
            placeholder="需要後續聯繫時使用，不會公開"
            maxLength={320}
            autoComplete="email"
          />
        </label>

        <div className="hidden" aria-hidden="true">
          <label>
            網站
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(event) => update("website", event.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p className="rounded-lg border border-[var(--public-border)] bg-[var(--public-soft)] px-4 py-3 text-sm text-[var(--text-secondary)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-[var(--public-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-6 text-[var(--text-secondary)]">
            送出後會產生一組回報編號。請勿在內容中提供密碼或驗證碼。
          </p>
          <button type="submit" className="btn btn-primary min-h-11 shrink-0" disabled={submitting}>
            {submitting ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden />
            ) : (
              <Send size={16} aria-hidden />
            )}
            {submitting ? "正在送出…" : "送出回報"}
          </button>
        </div>
      </div>
    </form>
  );
}
