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
      <h2 id="shop-parent-delegation-title">家長代訂需要學生授權</h2>
      <p>請學生登入商品頁，建立授權後，把七位數授權碼或分享連結傳給你。</p>
      <p>輸入授權碼或開啟連結 → 核對學生與帳號 → 確認後開始代訂。</p>
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
        <label>學生提供的七位數授權碼
          <input value={code} type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{7}" maxLength={20} placeholder="例如：0123456" required disabled={busy}
            aria-describedby="shop-delegation-code-hint" aria-invalid={Boolean(error)}
            onChange={(event) => {
              setCode(event.target.value.normalize("NFKC").replace(/\D/g, "").slice(0, 7));
              setError("");
            }} />
        </label>
        <button type="submit" className="shop-delegation-primary" disabled={busy || code.length !== 7}>
          {busy ? "確認授權碼中…" : "查看學生授權"}
        </button>
      </form> : <Link href="/login?next=%2Fshop" className="shop-delegation-primary">登入家長帳號</Link>}
      <p id="shop-delegation-code-hint">授權碼有效 30 分鐘。已有學生傳來的連結？直接點開即可，不必輸入授權碼。</p>
      {error && <p role="alert">{error}</p>}
      <p>目前帳號沒有學生身分，需由學生建立授權。代訂直接加入學生預購，由學生繳款與領取；你只能修改自己透過這份授權登記的品項。</p>
      {!isLoggedIn && <p>如果你是學生，登入學生帳號後即可看到建立授權的入口。</p>}
      <DelegationInstructions />
    </section>
  );
}
