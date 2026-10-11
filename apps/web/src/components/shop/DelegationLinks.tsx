"use client";

import { useCallback, useEffect, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ShopDelegationOut } from "@/lib/types";

export default function DelegationLinks({ categoryId, activityId }: {
  categoryId: string;
  activityId: string | null;
}) {
  const [links, setLinks] = useState<ShopDelegationOut[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareLinkId, setShareLinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const result = await shopApi.listDelegationLinks();
      setLinks(result);
      setNames(Object.fromEntries(result.map((link) => [link.id, link.name])));
    } catch (error) {
      setLoadError(true);
      setMessage(apiErrorMessage(error, "無法載入代訂連結"));
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
    <details className="shop-public-promotions shop-delegation-links">
      <summary className="shop-public-promotion-toggle">
        <span><strong>請家人幫忙代訂</strong><br />建立具名連結，使用同一個商品頁</span>
        <span>管理連結</span>
      </summary>
      <div className="shop-public-promotions-content">
        <p>送出後立即加入你的訂單，優惠按本人與家人合計。家人需登入自己的帳號，確認後此連結只供該帳號使用；各商品截止、班級結單或收款後無法再修改。</p>
        <p>請只分享給你授權的人。你可隨時撤銷連結；已登記品項會保留，可在訂單明細修改。</p>
        <form className="shop-delegation-form" onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void run(() => shopApi.createDelegationLink({ name: name.trim(), category_id: categoryId }), "連結已建立，請複製並分享給家人。");
        }}>
          <label>連結名稱（給誰代訂）
            <input value={name} maxLength={80} placeholder="例如：給媽媽代訂" required
              onChange={(event) => setName(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>建立連結</button>
        </form>
        {shareUrl && <div className="shop-delegation-form">
          <label>分享連結（請在離開頁面前保存）
            <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
          </label>
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(shareUrl); setMessage("連結已複製。"); }
            catch { setMessage("請選取分享連結後手動複製。"); }
          }}>複製連結</button>
        </div>}
        <p role="status">{busy ? "處理中…" : message}</p>
        {loadError && <button type="button" onClick={() => void load()}>重新載入連結</button>}
        {!loadError && visibleLinks.length === 0 && <p>這個活動尚未建立代訂連結。</p>}
        <ul className="shop-delegation-list">
          {visibleLinks.map(renderLink)}
        </ul>
        {otherLinks.length > 0 && <details>
          <summary>其他活動的連結（{otherLinks.length}）</summary>
          <ul className="shop-delegation-list">{otherLinks.map(renderLink)}</ul>
        </details>}
      </div>
    </details>
  );
}
