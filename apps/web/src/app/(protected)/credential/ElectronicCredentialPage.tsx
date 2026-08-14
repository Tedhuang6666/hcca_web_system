"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  CircleX,
  Link2,
  LogIn,
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

function CredentialPageIntro({ denied = false }: { denied?: boolean }) {
  return (
    <header className={`credential-page__intro${denied ? " credential-page__intro--denied" : ""}`}>
      <div>
        <p className="credential-page__kicker">PERSONAL PROOF</p>
        <h1>電子證件</h1>
        <p>
          {denied
            ? "電子證件只提供學校帳號或已連結學校 Email 的帳號使用。"
            : "前往特約店家兌換時，出示這張證件即可完成身分核驗。"}
        </p>
      </div>
      <div
        className={`credential-page__trust${denied ? " credential-page__trust--denied" : ""}`}
        aria-label={denied ? "需要使用學校帳號" : "電子證件安全說明"}
      >
        {denied ? <CircleX size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
        <span>{denied ? "需要學校帳號" : "由平台即時確認"}</span>
      </div>
    </header>
  );
}

function AccessDenied({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="credential-page mx-auto max-w-5xl space-y-7">
      <CredentialPageIntro denied />

      <section className="credential-denied" role="alert" aria-labelledby="credential-denied-title">
        <div className="credential-denied__icon" aria-hidden="true">
          <CircleX size={72} strokeWidth={1.7} />
        </div>
        <p className="credential-page__kicker credential-denied__kicker">ACCESS UNAVAILABLE</p>
        <h2 id="credential-denied-title">這個帳號目前無法顯示電子證件</h2>
        <p className="credential-denied__message">
          請使用學校帳號登入，或將目前帳號與學校 Email 連結；完成後再重新確認帳號資格。
        </p>

        <div className="credential-denied__guidance" aria-label="可用的處理方式">
          <div>
            <LogIn size={20} aria-hidden="true" />
            <div>
              <strong>使用學校帳號登入</strong>
              <span>以學校核發的 Email 登入平台。</span>
            </div>
          </div>
          <div>
            <Link2 size={20} aria-hidden="true" />
            <div>
              <strong>將學校 Email 連結至目前帳號</strong>
              <span>到帳號設定完成 Email 驗證後即可使用。</span>
            </div>
          </div>
        </div>

        <div className="credential-denied__actions">
          <Link href="/login?next=%2Fcredential" className="btn btn-primary">
            使用學校帳號登入
          </Link>
          <Link href="/settings/account" className="btn btn-secondary">
            前往帳號設定
          </Link>
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            重新確認
          </button>
        </div>
      </section>

      <p className="credential-note">
        若你已完成學校 Email 連結但仍無法使用，請先重新確認；仍有問題時再洽平台管理者。
      </p>
    </div>
  );
}

function CredentialCard({ credential }: { credential: ElectronicCredentialOut }) {
  const cardRef = useRef<HTMLElement | null>(null);

  function resetTilt() {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--credential-rotate-x", "0deg");
    card.style.setProperty("--credential-rotate-y", "0deg");
    card.style.setProperty("--credential-glint-x", "36%");
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / rect.width - 0.5;
    const pointerY = (event.clientY - rect.top) / rect.height - 0.5;
    const maxTilt = event.pointerType === "touch" ? 2.25 : 3.5;

    card.style.setProperty("--credential-rotate-x", `${(-pointerY * maxTilt).toFixed(2)}deg`);
    card.style.setProperty("--credential-rotate-y", `${(pointerX * maxTilt).toFixed(2)}deg`);
    card.style.setProperty("--credential-glint-x", `${((pointerX + 0.5) * 100).toFixed(1)}%`);
  }

  return (
    <section
      ref={cardRef}
      className="credential-card"
      aria-labelledby="credential-name"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
      onPointerUp={resetTilt}
    >
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
  if (error?.status === 403) return <AccessDenied onRetry={() => void loadCredential()} />;

  return (
    <div className="credential-page mx-auto max-w-5xl space-y-7">
      <CredentialPageIntro />

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
