"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, ExternalLink, Gauge, Lock, Pause, Play, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/ConfirmDialog";

import { ApiError, apiErrorMessage, rafflesApi } from "@/lib/api";
import type { RaffleAdminOut, RafflePrizeInput, RaffleStatus } from "@/lib/types";

import styles from "./raffle-admin.module.css";

const statusLabel: Record<RaffleStatus, string> = { draft: "草稿", open: "進行中", paused: "暫停", closed: "已結束" };

type PrizeDraft = { tier: string; name: string; quantity: string };

const defaultPrizeDrafts: PrizeDraft[] = [
  { tier: "A", name: "屁墊", quantity: "2" },
  { tier: "A", name: "水壺", quantity: "2" },
  { tier: "A", name: "帽踢", quantity: "2" },
  { tier: "B", name: "麻袋", quantity: "5" },
  { tier: "B", name: "帆布袋", quantity: "5" },
  { tier: "C", name: "金屬吊牌", quantity: "10" },
  { tier: "C", name: "帽子", quantity: "10" },
  { tier: "D", name: "毛巾", quantity: "35" },
  { tier: "F", name: "資料夾或徽章", quantity: "" },
];

function draftsFromEvent(event: RaffleAdminOut): PrizeDraft[] {
  return event.prizes.map((prize) => ({
    tier: prize.tier,
    name: prize.name,
    quantity: prize.total_quantity === null ? "" : String(prize.total_quantity),
  }));
}

function parsePrizeDrafts(drafts: PrizeDraft[]): RafflePrizeInput[] | null {
  if (drafts.length === 0) return null;
  const parsed: RafflePrizeInput[] = [];
  for (const draft of drafts) {
    const tier = draft.tier.trim();
    const name = draft.name.trim();
    const quantity = draft.quantity.trim();
    if (!tier || tier.length > 2 || !name) return null;
    if (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 0)) return null;
    parsed.push({ tier, name, total_quantity: quantity ? Number(quantity) : null });
  }
  return parsed;
}

export default function RaffleAdminClient() {
  const confirm = useConfirm();
  const [events, setEvents] = useState<RaffleAdminOut[]>([]);
  const [busy, setBusy] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [prizeDrafts, setPrizeDrafts] = useState<PrizeDraft[]>(defaultPrizeDrafts);
  const [accessDenied, setAccessDenied] = useState(false);
  const [permissionChecked, setPermissionChecked] = useState(false);

  const selected = events[0] ?? null;

  const load = useCallback(async () => {
    try {
      const rows = await rafflesApi.list();
      setEvents(rows);
      if (rows[0]) setPrizeDrafts(draftsFromEvent(rows[0]));
      setAccessDenied(false);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        setAccessDenied(true);
      } else {
        toast.error(apiErrorMessage(caught, "無法讀取抽獎狀態"));
      }
    } finally {
      setPermissionChecked(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessCode.trim()) {
      toast.error("請輸入本輪驗證碼");
      return;
    }
    setBusy(true);
    try {
      const prizes = parsePrizeDrafts(prizeDrafts);
      if (!prizes) {
        toast.error("請確認每筆獎品都有等級、名稱，數量需為 0 以上整數；留白代表不限量");
        return;
      }
      const created = await rafflesApi.create({ access_code: accessCode.trim(), prizes });
      setAccessCode("");
      setPrizeDrafts(draftsFromEvent(created));
      toast.success("抽獎台已開放，請把驗證碼提供給參加者");
      setEvents((current) => [created, ...current]);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "無法開放抽獎"));
    } finally {
      setBusy(false);
    }
  };

  const savePrizes = async () => {
    if (!selected) return;
    const prizes = parsePrizeDrafts(prizeDrafts);
    if (!prizes) {
      toast.error("請確認每筆獎品都有等級、名稱，數量需為 0 以上整數；留白代表不限量");
      return;
    }
    setBusy(true);
    try {
      const updated = await rafflesApi.update(selected.id, { prizes });
      setEvents((current) => current.map((row) => row.id === updated.id ? updated : row));
      setPrizeDrafts(draftsFromEvent(updated));
      toast.success("獎池設定已更新，機率會依目前階段自動重算");
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "更新獎池設定失敗"));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: RaffleStatus, reserve_released?: boolean) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await rafflesApi.update(selected.id, { status, reserve_released });
      setEvents((current) => current.map((row) => row.id === updated.id ? updated : row));
      toast.success(status === "open" ? "抽獎台已開放" : status === "paused" ? "抽獎台已暫停" : status === "closed" ? "本輪抽獎已結束" : "狀態已更新");
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "更新抽獎狀態失敗"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  };

  const reset = async () => {
    if (!selected || !(await confirm({
      title: "清除本輪所有測試資料？",
      description: "中獎紀錄與平板驗證 session 都會刪除，獎品庫存會恢復原始數量。",
      confirmLabel: "清除測試資料",
      danger: true,
    }))) return;
    setBusy(true);
    try {
      const resetEvent = await rafflesApi.reset(selected.id);
      setEvents((current) => current.map((row) => row.id === resetEvent.id ? resetEvent : row));
      toast.success("本輪測試資料已清除，抽獎台已重新開放");
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "清除測試資料失敗"));
    } finally {
      setBusy(false);
    }
  };

  const finiteRemaining = selected?.prizes.reduce((sum, prize) => sum + (prize.remaining_quantity ?? 0), 0) ?? 0;

  if (!permissionChecked) {
    return <main className={styles.denied}><Lock size={30} /><h1>正在確認管理權限</h1><p>正在連線確認抽獎管理權限。</p></main>;
  }

  if (accessDenied) {
    return <main className={styles.denied}><Lock size={30} /><h1>需要管理員權限</h1><p>抽獎管理僅開放給管理員。</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><div className={styles.kicker}>現場工具</div><h1>抽獎管理</h1><p>可調整獎池、單一驗證碼；多台平板可同時使用。</p></div>
        <button className={styles.ghostButton} type="button" onClick={() => void load()}><RefreshCw size={15} /> 重新整理</button>
      </header>

      <div className={styles.layout}>
        <section className={styles.content}>
          <section className={styles.activatePanel}>
            <div>
              <span className={styles.statusBadge}>開始新一輪</span>
              <h2>設定獎池與驗證碼</h2>
              <p>數量可自訂；機率會依階段、剩餘庫存與保留大獎自動計算。</p>
            </div>
            <form className={styles.activateForm} onSubmit={activate}>
              <label>本輪驗證碼<input value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="輸入 4 位以上驗證碼" autoComplete="off" /></label>
              <PrizeEditor drafts={prizeDrafts} setDrafts={setPrizeDrafts} />
              <button className={styles.primaryCreate} type="submit" disabled={busy}>{busy ? "開放中…" : "開放抽獎"} <Play size={15} /></button>
            </form>
          </section>

          {!selected ? <section className={styles.emptyState}><Gauge size={24} /><h2>尚未開放本輪抽獎</h2><p>輸入驗證碼與獎池設定後，系統會建立本輪抽獎。</p></section> : (
            <>
              <div className={styles.controlHead}><div><span className={`${styles.statusBadge} ${styles[`badge_${selected.status}`]}`}>{statusLabel[selected.status]}</span><h2>目前抽獎台</h2><p>{selected.description}</p></div><div className={styles.headActions}>
                {selected.status === "draft" && <button className={styles.primarySmall} type="button" disabled={busy} onClick={() => void changeStatus("open")}><Play size={14} /> 開放</button>}
                {selected.status === "open" && <button className={styles.warningSmall} type="button" disabled={busy} onClick={() => void changeStatus("paused")}><Pause size={14} /> 暫停</button>}
                {selected.status === "paused" && <button className={styles.primarySmall} type="button" disabled={busy} onClick={() => void changeStatus("open")}><Play size={14} /> 繼續</button>}
                {selected.status !== "closed" && <button className={styles.closeSmall} type="button" disabled={busy} onClick={() => void changeStatus("closed")}><X size={14} /> 結束</button>}
                <button className={styles.resetSmall} type="button" disabled={busy} onClick={() => void reset()}>清除測試資料</button>
              </div></div>

              <div className={styles.metrics}><Metric label="已抽出" value={String(selected.draw_count)} note="人" accent="orange" /><Metric label="有限獎剩餘" value={String(finiteRemaining)} note="份" accent="yellow" /><Metric label="目前節奏" value={selected.reserve_released ? "尾聲" : "保留中"} note={selected.reserve_released ? "全獎池開放" : "依人數分段"} accent="green" /></div>

              <div className={styles.gridTwo}>
                <section className={styles.panel}><div className={styles.panelTitle}><div><span>自動機率獎池</span><small>依階段與剩餘數量即時計算</small></div>{!selected.reserve_released && selected.status !== "closed" && <button className={styles.outlineButton} type="button" onClick={() => void changeStatus(selected.status, true)}><Send size={14} /> 開啟尾聲獎</button>}</div><div className={styles.prizeList}>{selected.prizes.map((prize) => <div className={styles.prizeRow} key={prize.id}><span className={`${styles.tier} ${styles[`tier_${prize.tier}`]}`}>{prize.tier}</span><strong>{prize.name}</strong><span className={styles.stock}>{prize.current_probability.toFixed(1)}% · {prize.remaining_quantity === null ? "∞" : `${prize.remaining_quantity} / ${prize.total_quantity}`}</span></div>)}</div><p className={styles.panelHint}><ShieldCheck size={14} /> 高等級會自動保留部分到尾聲；庫存由後端鎖定，不會超發。</p></section>
                <section className={styles.panel}><div className={styles.panelTitle}><div><span>參加者入口</span><small>現場平板開啟此網址</small></div><ExternalLink size={16} color="var(--text-muted)" /></div><div className={styles.shareBox}><div><small>抽獎網址</small><strong>/raffle</strong></div><button type="button" onClick={() => void copy(`${window.location.origin}/raffle`, "抽獎網址已複製")}><Copy size={14} /></button></div><p className={styles.panelHint}><Lock size={14} /> 驗證成功後會固定在每台平板；上一位抽完可直接交給下一位。</p></section>
              </div>

              <section className={styles.panel}><div className={styles.panelTitle}><div><span>調整目前獎池</span><small>{selected.draw_count > 0 ? "已開始抽獎，本輪設定已鎖定" : "修改後會立即重算各獎品目前機率"}</small></div><button className={styles.outlineButton} type="button" disabled={busy || selected.draw_count > 0} onClick={() => void savePrizes()}><Save size={14} /> 儲存獎池</button></div><PrizeEditor drafts={prizeDrafts} setDrafts={setPrizeDrafts} /><p className={styles.panelHint}>數量留白代表不限量參加獎；最高等級預設保留部分獎數，尾聲可由管理員開放。</p></section>

              <section className={styles.panel}><div className={styles.panelTitle}><div><span>最近抽獎</span><small>最近 12 筆結果</small></div><button className={styles.iconButton} type="button" onClick={() => void load()}><RefreshCw size={14} /></button></div>{selected.recent_draws.length === 0 ? <div className={styles.noDraws}>抽獎開始後，這裡會顯示中獎紀錄。</div> : <div className={styles.drawTable}>{selected.recent_draws.map((draw) => <div className={styles.drawRow} key={draw.id}><span>#{String(draw.draw_number).padStart(3, "0")}</span><strong><b className={`${styles.tierMini} ${styles[`tier_${draw.prize_tier}`]}`}>{draw.prize_tier}</b>{draw.prize_name}</strong><time>{new Date(draw.created_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</time></div>)}</div>}</section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function PrizeEditor({ drafts, setDrafts }: { drafts: PrizeDraft[]; setDrafts: (drafts: PrizeDraft[]) => void }) {
  const update = (index: number, field: keyof PrizeDraft, value: string) => {
    setDrafts(drafts.map((draft, current) => current === index ? { ...draft, [field]: value } : draft));
  };

  return (
    <div className={styles.prizeEditor}>
      <div className={styles.formSectionTitle}><span>獎品設定</span><small>等級／名稱／數量</small></div>
      {drafts.map((draft, index) => (
        <div className={styles.prizeEditRow} key={`${index}-${draft.tier}`}>
          <input aria-label={`第 ${index + 1} 筆獎品等級`} value={draft.tier} onChange={(event) => update(index, "tier", event.target.value)} placeholder="A" maxLength={2} />
          <input aria-label={`第 ${index + 1} 筆獎品名稱`} value={draft.name} onChange={(event) => update(index, "name", event.target.value)} placeholder="獎品名稱" />
          <input aria-label={`第 ${index + 1} 筆獎品數量`} type="number" min="0" value={draft.quantity} onChange={(event) => update(index, "quantity", event.target.value)} placeholder="不限量" />
          <button className={styles.iconButton} type="button" aria-label="移除獎品" disabled={drafts.length <= 1} onClick={() => setDrafts(drafts.filter((_, current) => current !== index))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className={styles.outlineButton} type="button" onClick={() => setDrafts([...drafts, { tier: "D", name: "", quantity: "" }])}><Plus size={14} /> 新增獎品</button>
    </div>
  );
}

function Metric({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return <div className={styles.metric}><span className={`${styles.metricIcon} ${styles[`metric_${accent}`]}`}><Gauge size={16} /></span><div><small>{label}</small><strong>{value}<em>{note}</em></strong></div></div>;
}
