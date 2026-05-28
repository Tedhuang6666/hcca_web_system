"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, discordApi, lineApi, notificationsApi } from "@/lib/api";
import type { ChannelPref, NotificationPreferences } from "@/lib/types";
import { enableWebPush } from "@/lib/web-push";
import { SectionSkeleton } from "@/components/ui/Skeleton";

const OPTIONS: { key: keyof NotificationPreferences; label: string; desc: string }[] = [
  { key: "document_pending", label: "公文待審", desc: "有公文需要您審核或處理時提醒" },
  { key: "document_approved", label: "公文核准", desc: "您送出的公文通過審核時提醒" },
  { key: "document_rejected", label: "公文退回", desc: "公文被退回或需要修正時提醒" },
  { key: "document_recalled", label: "公文撤回", desc: "相關公文從簽核流程撤回時提醒" },
  { key: "announcement", label: "公告通知", desc: "重要公告、緊急公告與公告更新提醒" },
  { key: "system", label: "系統通知", desc: "平台維運、權限或安全相關提醒" },
];

type Channel = keyof ChannelPref;

function Switch({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: on ? "var(--primary)" : "var(--border-strong)" }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: on ? "translateX(18px)" : "translateX(3px)" }}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [lineLinked, setLineLinked] = useState(false);
  const [discordLinked, setDiscordLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [digest, setDigest] = useState<"off" | "daily" | "weekly">("off");
  const [digestSaving, setDigestSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      notificationsApi.getPreferences(),
      lineApi.me().catch(() => ({ linked: false })),
      discordApi.me().catch(() => ({ linked: false })),
      notificationsApi.getDigestFrequency().catch(() => ({ frequency: "off" as const })),
    ])
      .then(([nextPrefs, line, discord, digestPref]) => {
        setPrefs(nextPrefs);
        setLineLinked(Boolean(line.linked));
        setDiscordLinked(Boolean(discord.linked));
        setDigest(digestPref.frequency);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入通知偏好失敗"))
      .finally(() => setLoading(false));
  }, []);

  const updateDigest = async (next: "off" | "daily" | "weekly") => {
    const prev = digest;
    setDigest(next);
    setDigestSaving(true);
    try {
      await notificationsApi.setDigestFrequency(next);
      toast.success(
        next === "off"
          ? "已關閉 Email 摘要"
          : next === "daily"
            ? "已啟用每日摘要（08:00 寄送）"
            : "已啟用每週摘要（週一 08:00 寄送）",
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新摘要設定失敗");
      setDigest(prev);
    } finally {
      setDigestSaving(false);
    }
  };

  const counts = useMemo(() => {
    if (!prefs) return { inapp: 0, email: 0, line: 0, discord: 0 };
    return {
      inapp: OPTIONS.filter((o) => prefs[o.key].inapp).length,
      email: OPTIONS.filter((o) => prefs[o.key].email).length,
      line: OPTIONS.filter((o) => prefs[o.key].line).length,
      discord: OPTIONS.filter((o) => prefs[o.key].discord).length,
    };
  }, [prefs]);

  const update = async (next: NotificationPreferences) => {
    const prev = prefs;
    setPrefs(next);
    setSaving(true);
    try {
      const saved = await notificationsApi.updatePreferences(next);
      setPrefs(saved);
      toast.success("通知偏好已更新");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
      setPrefs(prev);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof NotificationPreferences, channel: Channel) => {
    if (!prefs || saving) return;
    if (channel === "line" && !lineLinked) {
      toast.error("請先到個人資料綁定 LINE");
      return;
    }
    if (channel === "discord" && !discordLinked) {
      toast.error("請先到個人資料綁定 Discord");
      return;
    }
    update({ ...prefs, [key]: { ...prefs[key], [channel]: !prefs[key][channel] } });
  };

  const setAll = (value: boolean) => {
    if (!prefs || saving) return;
    const next = { ...prefs };
    for (const o of OPTIONS) {
      next[o.key] = {
        inapp: value,
        email: value,
        line: lineLinked ? value : false,
        discord: discordLinked ? value : false,
      };
    }
    update(next);
  };

  const enablePush = async () => {
    setPushBusy(true);
    try {
      await enableWebPush();
      toast.success("瀏覽器推播已啟用");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "啟用推播失敗");
    } finally {
      setPushBusy(false);
    }
  };

  const testPush = async () => {
    setPushBusy(true);
    try {
      const result = await notificationsApi.testWebPush();
      toast.success(result.sent > 0 ? "已送出測試推播" : "沒有可用的推播訂閱");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "測試推播失敗");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            NOTIFICATION SETTINGS
          </p>
          <h1 className="mt-1 text-xl font-semibold">通知偏好設定</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            分別設定每種事件要用「站內通知」、「Email」、「LINE」或「Discord」接收
          </p>
        </div>
        <Link href="/notifications" className="btn btn-ghost">
          回通知中心
        </Link>
      </header>

      <section className="card overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold">Email 摘要</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            把未讀通知聚合成單封 Email，避免每則通知都收到一封信。即時通知仍會照常推播。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {([
            { key: "off", label: "關閉" },
            { key: "daily", label: "每日 08:00" },
            { key: "weekly", label: "每週一 08:00" },
          ] as const).map(({ key, label }) => {
            const active = digest === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => updateDigest(key)}
                disabled={digestSaving || loading}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer hover:opacity-80 disabled:opacity-50"
                style={
                  active
                    ? {
                        background: "var(--primary-dim)",
                        color: "var(--primary)",
                        border: "1px solid var(--border-strong)",
                      }
                    : {
                        color: "var(--text-muted)",
                        border: "1px solid var(--border)",
                        background: "var(--bg-surface)",
                      }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold">訂閱項目</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {loading
                ? "載入中"
                : `站內 ${counts.inapp} 項、Email ${counts.email} 項、LINE ${counts.line} 項、Discord ${counts.discord} 項已啟用`}
              {saving ? "，儲存中" : ""}
            </p>
            {!lineLinked && (
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                LINE 通知需先至個人資料完成綁定。
              </p>
            )}
            {!discordLinked && (
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                Discord 通知需先至個人資料完成綁定。
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setAll(true)}
              disabled={!prefs || saving}
            >
              全部開啟
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAll(false)}
              disabled={!prefs || saving}
            >
              全部關閉
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-5"><SectionSkeleton lines={5} /></div>
        ) : !prefs ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            無法載入通知偏好。
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-3 px-5 py-2"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex-1" />
              <div
                className="w-12 text-center text-[11px] font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                站內
              </div>
              <div
                className="w-12 text-center text-[11px] font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                Email
              </div>
              <div
                className="w-12 text-center text-[11px] font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                LINE
              </div>
              <div
                className="w-16 text-center text-[11px] font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                Discord
              </div>
            </div>
            <ul>
              {OPTIONS.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center gap-3 px-5 py-4"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {item.label}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {item.desc}
                    </p>
                  </div>
                  <div className="flex w-12 justify-center">
                    <Switch
                      on={prefs[item.key].inapp}
                      disabled={saving}
                      onClick={() => toggle(item.key, "inapp")}
                      label={`${item.label}站內通知`}
                    />
                  </div>
                  <div className="flex w-12 justify-center">
                    <Switch
                      on={prefs[item.key].email}
                      disabled={saving}
                      onClick={() => toggle(item.key, "email")}
                      label={`${item.label} Email 通知`}
                    />
                  </div>
                  <div className="flex w-12 justify-center">
                    <Switch
                      on={prefs[item.key].line}
                      disabled={saving || !lineLinked}
                      onClick={() => toggle(item.key, "line")}
                      label={`${item.label} LINE 通知`}
                    />
                  </div>
                  <div className="flex w-16 justify-center">
                    <Switch
                      on={prefs[item.key].discord}
                      disabled={saving || !discordLinked}
                      onClick={() => toggle(item.key, "discord")}
                      label={`${item.label} Discord 通知`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">瀏覽器推播</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              用於待審、公文狀態、公告與會議提醒。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" disabled={pushBusy} onClick={enablePush}>
              啟用推播
            </button>
            <button className="btn btn-secondary btn-sm" disabled={pushBusy} onClick={testPush}>
              測試推播
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
