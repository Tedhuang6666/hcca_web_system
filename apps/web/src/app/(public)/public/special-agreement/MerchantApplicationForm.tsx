"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";
import { ApiError, apiErrorMessage } from "@/lib/api-helpers";
import { partnerApplicationApi } from "@/lib/api/partner-applications";
import type { PartnerApplicationFieldOut, PartnerApplicationPortalOut } from "@/lib/types";

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: PartnerApplicationFieldOut;
  value: string;
  onChange: (value: string) => void;
}) {
  const describedBy = field.help_text ? `${field.key}-help` : undefined;
  const commonProps = {
    id: field.key,
    name: field.key,
    value,
    required: field.required,
    placeholder: field.placeholder ?? undefined,
    "aria-describedby": describedBy,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(event.target.value),
  };

  if (field.field_type === "textarea") {
    return <textarea {...commonProps} rows={4} className="input min-h-28 w-full resize-y" />;
  }
  if (field.field_type === "select") {
    return (
      <select {...commonProps} className="input w-full">
        <option value="">請選擇</option>
        {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  return <input {...commonProps} type={field.field_type} className="input w-full" />;
}

export default function MerchantApplicationForm() {
  const [portal, setPortal] = useState<PartnerApplicationPortalOut | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    partnerApplicationApi.portal()
      .then((nextPortal) => {
        setPortal(nextPortal);
        setValues(Object.fromEntries(nextPortal.settings.fields.map((field) => [field.key, ""])));
      })
      .catch((reason) => setError(apiErrorMessage(reason, "目前無法載入申請表單，請稍後再試。")))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await partnerApplicationApi.submit({ field_values: values });
      setSubmitted(true);
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? reason.message
          : apiErrorMessage(reason, "申請送出失敗，請檢查欄位後再試。"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="partner-application-title" className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 sm:p-8">
      {loading ? (
        <div className="flex items-center gap-3 py-8 text-sm text-[var(--public-secondary)]" role="status">
          <LoaderCircle size={18} className="animate-spin" aria-hidden />
          正在載入申請表單…
        </div>
      ) : error && !portal ? (
        <p className="py-6 text-sm text-[var(--public-secondary)]" role="alert">{error}</p>
      ) : portal && !portal.is_accepting ? (
        <div className="py-4">
          <p className="public-section-kicker">Application</p>
          <h2 id="partner-application-title" className="mt-2 text-2xl font-semibold">{portal.settings.title}</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--public-secondary)]">目前暫停受理申請，請稍後再回來查看。</p>
        </div>
      ) : portal && submitted ? (
        <div className="flex flex-col items-start gap-4 py-5" role="status">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--brand-accent-dim)] text-[var(--public-accent)]">
            <CheckCircle2 size={22} aria-hidden />
          </span>
          <div>
            <h2 id="partner-application-title" className="text-2xl font-semibold">申請已送出</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--public-secondary)]">
              感謝您的合作提案。我們會依申請內容與您聯繫，請留意您填寫的聯絡方式。
            </p>
          </div>
        </div>
      ) : portal ? (
        <form onSubmit={submit} noValidate={false}>
          <div className="max-w-2xl">
            <p className="public-section-kicker">Application</p>
            <h2 id="partner-application-title" className="mt-2 text-2xl font-semibold">{portal.settings.title}</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--public-secondary)]">{portal.settings.intro}</p>
          </div>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            {portal.settings.fields.filter((field) => field.is_active).map((field) => (
              <label key={field.id} htmlFor={field.key} className={field.field_type === "textarea" ? "space-y-2 sm:col-span-2" : "space-y-2"}>
                <span className="block text-sm font-semibold">
                  {field.label}{field.required ? <span className="ml-1 text-[var(--public-accent)]" aria-label="必填">*</span> : null}
                </span>
                <FieldControl
                  field={field}
                  value={values[field.key] ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                />
                {field.help_text ? <span id={`${field.key}-help`} className="block text-xs leading-5 text-[var(--public-secondary)]">{field.help_text}</span> : null}
              </label>
            ))}
          </div>
          {portal.settings.privacy_notice ? (
            <p className="mt-6 rounded-lg bg-[var(--public-soft)] px-4 py-3 text-xs leading-5 text-[var(--public-secondary)]">
              {portal.settings.privacy_notice}
            </p>
          ) : null}
          {error ? <p className="mt-5 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--public-secondary)]">送出後，工作人員會依內容與您聯繫。</p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--public-accent)] px-5 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--public-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--public-focus)]"
            >
              {submitting ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
              {submitting ? "送出中…" : "送出合作申請"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
