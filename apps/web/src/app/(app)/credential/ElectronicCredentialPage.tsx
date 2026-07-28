"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { ApiError, apiErrorMessage, electronicCredentialsApi } from "@/lib/api";
import type { ElectronicCredentialOut } from "@/lib/types";

function CredentialSkeleton() {
  return (
    <div className="credential-page mx-auto max-w-5xl space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded" style={{ background: "var(--border)" }} />
        <div className="h-8 w-48 animate-pulse rounded" style={{ background: "var(--border)" }} />
      </div>
      <div className="credential-skeleton h-[31rem] animate-pulse" />
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="credential-page mx-auto max-w-3xl">
      <div className="credential-denied" role="alert">
        <div className="credential-denied__icon" aria-hidden="true">
          <LockKeyhole size={24} />
        </div>
        <p className="text-xs font-semibold tracking-[0.18em]" style={{ color: "var(--primary)" }}>
          ACCESS RESTRICTED
        </p>
        <h1 className="mt-3 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          目前沒有可出示的電子證件
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
          電子證件僅提供校內帳號，或經平台管理者特別授權的個人帳號使用。若你認為自己應有資格，請洽平台管理者確認帳號授權。
        </p>
      </div>
    </div>
  );
}

function CredentialCard({ credential }: { credential: ElectronicCredentialOut }) {
  return (
    <section className="credential-card" aria-labelledby="credential-name">
      <div className="credential-card__shine" aria-hidden="true" />
      <div className="credential-card__header">
        <div className="flex items-center gap-3">
          <BrandEmblem size={44} framed priority />
          <div>
            <p className="text-sm font-semibold tracking-[0.08em] text-[#fffdf7]">HCCA</p>
            <p className="text-[11px] text-[#b9c3d2]">校園自治整合平台</p>
          </div>
        </div>
        <div className="credential-card__status">
          <BadgeCheck size={15} aria-hidden="true" />
          <span>目前有效</span>
        </div>
      </div>

      <div className="credential-card__main">
        <div className="credential-card__identity">
          <p className="credential-card__eyebrow">ELECTRONIC CREDENTIAL</p>
          <h1 id="credential-name">{credential.display_name}</h1>
          <p className="credential-card__kind">{credential.identity_label} · 特約兌換資格</p>

          <dl className="credential-card__fields">
            <div>
              <dt>身份別</dt>
              <dd>{credential.identity_label}</dd>
            </div>
            <div>
              <dt>學號</dt>
              <dd>{credential.student_id || "—"}</dd>
            </div>
            <div className="credential-card__field-wide">
              <dt>登入帳號</dt>
              <dd>{credential.email}</dd>
            </div>
          </dl>
        </div>

        <div className="credential-card__seal" aria-label="HCCA 身份確認">
          <div className="credential-card__seal-ring">
            <BrandEmblem size={72} />
          </div>
          <BadgeCheck size={18} aria-hidden="true" />
          <p>身份確認</p>
          <span>HCCA · VERIFIED</span>
        </div>
      </div>

      <div className="credential-card__footer">
        <span>僅供特約兌換時出示</span>
        <span className="credential-card__mark">{credential.status_label}</span>
      </div>
    </section>
  );
}

export default function ElectronicCredentialPage() {
  const [credential, setCredential] = useState<ElectronicCredentialOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  async function loadCredential() {
    setLoading(true);
    setError(null);
    try {
      setCredential(await electronicCredentialsApi.me());
    } catch (reason) {
      setCredential(null);
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, apiErrorMessage(reason, "無法取得電子證件")),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCredential();
  }, []);

  if (loading) return <CredentialSkeleton />;
  if (error?.status === 403) return <AccessDenied />;

  return (
    <div className="credential-page mx-auto max-w-5xl space-y-7">
      <header className="credential-page__intro">
        <div>
          <p className="credential-page__kicker">PERSONAL PROOF</p>
          <h1>電子證件</h1>
          <p>前往特約店家兌換時，出示這張證件即可完成身分核驗。</p>
        </div>
        <div className="credential-page__trust" aria-label="電子證件安全說明">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>由平台即時確認</span>
        </div>
      </header>

      {error ? (
        <section className="credential-error" role="alert">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <p className="font-semibold">電子證件暫時無法載入</p>
            <p className="mt-1 text-sm">{error.message}</p>
          </div>
          <button type="button" className="btn btn-secondary ml-auto" onClick={() => void loadCredential()}>
            重新載入
          </button>
        </section>
      ) : credential ? (
        <>
          <CredentialCard credential={credential} />

          <section className="credential-usage" aria-labelledby="credential-usage-title">
            <div>
              <p className="credential-page__kicker">HOW TO USE</p>
              <h2 id="credential-usage-title">到店時這樣做</h2>
            </div>
            <div className="credential-usage__steps">
              <div>
                <span>01</span>
                <p>開啟平台內的電子證件</p>
              </div>
              <ChevronRight className="credential-usage__arrow" size={18} aria-hidden="true" />
              <div>
                <span>02</span>
                <p>將卡面身份資訊出示給店家</p>
              </div>
              <ChevronRight className="credential-usage__arrow" size={18} aria-hidden="true" />
              <div>
                <span>03</span>
                <p>依店家規範完成兌換</p>
              </div>
            </div>
          </section>

          <p className="credential-note">
            本證件為平台身分與特約資格的象徵性證明，實際優惠內容與兌換方式仍依各特約店家規範辦理。
          </p>
        </>
      ) : null}
    </div>
  );
}
