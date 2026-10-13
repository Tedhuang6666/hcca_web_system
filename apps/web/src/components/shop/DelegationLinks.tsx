"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ShopDelegationOut } from "@/lib/types";
import DelegationPermissions from "./DelegationPermissions";

export default function DelegationLinks({ categoryId, activityId, scopeName }: {
  categoryId: string;
  activityId: string | null;
  scopeName: string;
}) {
  const [links, setLinks] = useState<ShopDelegationOut[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareLinkId, setShareLinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const shareInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (creating) nameInput.current?.focus(); }, [creating]);
  useEffect(() => {
    if (shareUrl) {
      shareInput.current?.focus();
      shareInput.current?.select();
    }
  }, [shareUrl]);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await shopApi.listDelegationLinks();
      setLinks(result);
      setNames(Object.fromEntries(result.map((link) => [link.id, link.name])));
    } catch (error) {
      setLoadError(true);
      setMessage(apiErrorMessage(error, "無法載入代訂連結"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<ShopDelegationOut | void>, success: string, revokedId?: string) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await operation();
      if (result?.token) {
        setShareUrl(`${window.location.origin}/shop#delegate=${encodeURIComponent(result.token)}`);
        setShareLinkId(result.id);
        setName("");
      } else if (revokedId === shareLinkId) {
        setShareUrl("");
        setShareLinkId(null);
      }
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(apiErrorMessage(error, "操作失敗，請再試一次"));
    } finally {
      setBusy(false);
    }
  };
  const visibleLinks = links.filter((link) => activityId
    ? link.activity_id === activityId : !link.activity_id && link.category_id === categoryId);
  const otherLinks = links.filter((link) => !visibleLinks.includes(link));
  const renderLink = (link: ShopDelegationOut) => <li key={link.id}>
    <label>連結名稱
      <input aria-label={`修改${link.name}的名稱`} maxLength={80} value={names[link.id] ?? link.name}
        disabled={busy || Boolean(link.revoked_at)}
        onChange={(event) => setNames((current) => ({ ...current, [link.id]: event.target.value }))} />
    </label>
    <p>{link.revoked_at ? "已撤銷" : link.bound_user_email
      ? `已綁定 ${link.bound_user_name ?? "家人"}（${link.bound_user_email}）` : "尚未綁定家人帳號"}</p>
    <p>建立於 {new Date(link.created_at).toLocaleDateString("zh-TW")}</p>
    {!link.revoked_at && <div className="shop-delegation-actions">
      <button type="button" disabled={busy || !names[link.id]?.trim()} onClick={() => void run(
        () => shopApi.renameDelegationLink(link.id, names[link.id].trim()), "名稱已更新；既有品項會保留下單時的名稱。",
      )}>儲存名稱</button>
      <button type="button" disabled={busy} onClick={() => void run(
        () => shopApi.renewDelegationLink(link.id), "新連結已建立，舊連結已停用；請複製新連結。",
      )}>重新產生（停用舊連結）</button>
      <button type="button" disabled={busy} onClick={() => void run(
        () => shopApi.revokeDelegationLink(link.id), "連結已撤銷，已登記的品項仍保留。", link.id,
      )}>撤銷</button>
    </div>}
  </li>;

  return (
    <section className="shop-delegation-links shop-delegation-entry" aria-labelledby="shop-delegation-title">
      <div className="shop-delegation-heading">
        <div>
          <h2 id="shop-delegation-title">家長代訂</h2>
          <p>請家長或受你授權的家人替你選購，代訂品項會直接加入你的預購。</p>
          <p>家長只能修改自己透過連結登記的品項；你仍可管理全部品項。</p>
        </div>
        <button type="button" className={creating ? undefined : "shop-delegation-primary"} aria-expanded={creating}
          aria-controls="shop-delegation-create" disabled={busy}
          onClick={() => setCreating((current) => !current)}>
          {creating ? "收起建立表單" : "建立家長代訂連結"}
        </button>
      </div>
      <p className="shop-delegation-scope"><strong>本次授權：{scopeName}</strong>
        {activityId ? "（包含同活動的商品主題）" : "（僅此商品主題）"}。要授權其他活動，請先切換下方商品主題。</p>
      <div id="shop-delegation-create" hidden={!creating}>
        <ol className="shop-delegation-steps" aria-label="家長代訂流程">
          <li>為家長建立具名連結</li>
          <li>複製連結，私下傳給家長</li>
          <li>家長登入自己的帳號，確認後開始代訂</li>
        </ol>
        <p>每個連結只綁定一個家人帳號。請只分享給你授權的人，不需要提供你的帳號或密碼。</p>
        <form className="shop-delegation-form" onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void run(() => shopApi.createDelegationLink({ name: name.trim(), category_id: categoryId }), "連結已建立，請複製並分享給家人。");
        }}>
          <label>連結名稱（給誰代訂）
            <input ref={nameInput} value={name} maxLength={80} placeholder="例如：給媽媽代訂" required
              onChange={(event) => setName(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="shop-delegation-primary" disabled={busy || !name.trim()}>建立連結</button>
        </form>
      </div>
      {shareUrl && <div className="shop-delegation-share">
        <p><strong>連結已準備好，請複製並傳給家長。</strong></p>
        <div className="shop-delegation-form">
          <label>分享連結（請在離開頁面前保存）
            <input ref={shareInput} readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
          </label>
          <button type="button" className="shop-delegation-primary" onClick={async () => {
            try { await navigator.clipboard.writeText(shareUrl); setMessage("連結已複製。"); }
            catch { setMessage("請選取分享連結後手動複製。"); }
          }}>複製連結</button>
        </div>
        <p>切換活動、關閉或重整頁面後，無法再次查看這個網址；未保存時可在連結管理重新產生。</p>
      </div>}
      <p role="status">{busy ? "處理中…" : loading ? "載入代訂連結中…" : message}</p>
      {loadError && <button type="button" onClick={() => void load()}>重新載入連結</button>}
      {!loading && !loadError && visibleLinks.length === 0 && <p>這個活動尚未建立代訂連結。</p>}
      <details className="shop-delegation-help">
        <summary>學生與家長的用途及權限說明</summary>
        <DelegationPermissions />
      </details>
      {visibleLinks.length > 0 && <details className="shop-delegation-management">
        <summary>管理本次授權的連結（{visibleLinks.length}）</summary>
        <ul className="shop-delegation-list">
          {visibleLinks.map(renderLink)}
        </ul>
      </details>}
      {otherLinks.length > 0 && <details>
        <summary>其他活動的連結（{otherLinks.length}）</summary>
        <ul className="shop-delegation-list">{otherLinks.map(renderLink)}</ul>
      </details>}
    </section>
  );
}
