"use client";

import { useState } from "react";
import Link from "next/link";
import { shopApi, apiErrorMessage } from "@/lib/api";
import DelegationInstructions from "./DelegationInstructions";

export default function ParentDelegationEntry({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <section className="shop-delegation-entry shop-delegation-links" aria-labelledby="shop-parent-delegation-title">
      <h2 id="shop-parent-delegation-title">輸入代訂驗證碼</h2>
      <p>請本校學生在商品頁點「代訂」，建立連結後，把七位數驗證碼或分享連結傳給你。</p>
      <ol className="shop-delegation-steps" aria-label="開始代訂的步驟">
        <li>輸入學生提供的驗證碼</li>
        <li>核對學生與目前帳號</li>
        <li>確認授權，開始選購</li>
      </ol>
      {isLoggedIn ? <form className="shop-delegation-form shop-delegation-code-form" onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !/^[0-9]{7}$/.test(code)) return;
        setBusy(true);
        setError("");
        try {
          const result = await shopApi.exchangeDelegationCode(code);
          window.location.hash = `delegate=${encodeURIComponent(result.token)}`;
        } catch (reason) {
          setError(apiErrorMessage(reason, "無法使用授權碼，請確認數字或改用學生傳來的連結。"));
        } finally {
          setBusy(false);
        }
      }}>
        <label>學生提供的七位數代訂驗證碼
          <input data-autofocus value={code} type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{7}" maxLength={20} placeholder="例如：0123456" required disabled={busy}
            aria-describedby={`shop-delegation-code-hint${error ? " shop-delegation-code-error" : ""}`} aria-invalid={Boolean(error)}
            onChange={(event) => {
              setCode(event.target.value.normalize("NFKC").replace(/\D/g, "").slice(0, 7));
              setError("");
            }} />
        </label>
        <button type="submit" className="shop-delegation-primary" disabled={busy || code.length !== 7}>
          {busy ? "確認授權碼中…" : "查看學生授權"}
        </button>
      </form> : <>
        <p>請先登入自己的帳號，登入後會回到這裡輸入驗證碼。</p>
        <Link href="/login?next=%2Fshop%3Fdelegation%3Dentry" className="shop-delegation-primary">登入後開始代訂</Link>
      </>}
      <p id="shop-delegation-code-hint">驗證碼（授權碼）有效 30 分鐘。已有學生傳來的連結？直接點開即可，不必輸入驗證碼。</p>
      {error && <p id="shop-delegation-code-error" role="alert">{error}</p>}
      <p>代訂品項會直接加入學生預購，由學生繳款與領取；你只能修改自己透過這份授權登記的品項。</p>
      {!isLoggedIn && <p>如果你是學生，登入學生帳號後即可看到建立授權的入口。</p>}
      <DelegationInstructions />
    </section>
  );
}
