"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  discordApi,
  featureFlagsApi,
  lineApi,
  notificationsApi,
  apiErrorMessage,
  type FeatureFlagOut,
} from "@/lib/api";
import type { ChannelPref, NotificationPreferences } from "@/lib/types";
import { enableWebPush } from "@/lib/web-push";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const OPTION_GROUPS = [
  { id: "governance", label: "公文與法規", desc: "簽核、起草與法規流程的提醒" },
  { id: "schedule", label: "會議與行程", desc: "受邀會議、會議紀錄與行程異動" },
  { id: "campus", label: "校園服務", desc: "陳情、學餐、商品、問卷與公告" },
  { id: "personal", label: "工作與系統", desc: "個人工作與帳號、系統安全提醒" },
] as const;

type OptionGroup = (typeof OPTION_GROUPS)[number]["id"];

type NotificationOption = {
  key: keyof NotificationPreferences;
  label: string;
  desc: string;
  group: OptionGroup;
  permissions?: readonly string[];
};

const OPTIONS: NotificationOption[] = [
  {
    key: "document_pending",
    label: "公文待審",
    desc: "有公文需要您審核或處理時提醒",
    group: "governance",
    permissions: ["document:approve"],
  },
  {
    key: "document_approved",
    label: "公文核准",
    desc: "您送出的公文通過審核時提醒",
    group: "governance",
    permissions: ["document:draft"],
  },
  {
    key: "document_rejected",
    label: "公文退回",
    desc: "公文被退回或需要修正時提醒",
    group: "governance",
    permissions: ["document:draft"],
  },
  {
    key: "document_recalled",
    label: "公文撤回",
    desc: "相關公文從簽核流程撤回時提醒",
    group: "governance",
    permissions: ["document:draft"],
  },
  {
    key: "regulation_review_assigned",
    label: "法規審議",
    desc: "法規排入議程或需要審議時提醒",
    group: "governance",
    permissions: [
      "regulation:schedule",
      "regulation:council_approve",
      "regulation:admin",
    ],
  },
  {
    key: "regulation_publish_ready",
    label: "法規待公布",
    desc: "法規完成議會核定等待公布時提醒",
    group: "governance",
    permissions: ["regulation:president_publish", "regulation:admin"],
  },
  {
    key: "regulation_published",
    label: "法規公布",
    desc: "法規發布、修正或廢止時提醒",
    group: "governance",
  },
  {
    key: "meeting_invited",
    label: "會議邀請",
    desc: "被列入會議名冊或議程確認時提醒",
    group: "schedule",
  },
  {
    key: "meeting_today",
    label: "今日會議",
    desc: "會議即將開始、報到與場控提醒",
    group: "schedule",
  },
  {
    key: "meeting_minutes_ready",
    label: "會議紀錄",
    desc: "會議紀錄完成或轉成公文時提醒",
    group: "schedule",
  },
  {
    key: "calendar_event_invited",
    label: "行事曆邀請",
    desc: "活動、彩排、跨校會議與一般行程邀請",
    group: "schedule",
  },
  {
    key: "calendar_event_updated",
    label: "行事曆異動",
    desc: "行程時間、地點、參與者或準備事項變更",
    group: "schedule",
  },
  {
    key: "petition_received",
    label: "新陳情",
    desc: "負責的陳情案件收到新送件時提醒",
    group: "campus",
    permissions: [
      "petition:view_org",
      "petition:assign",
      "petition:handle",
      "petition:transfer",
      "petition:admin",
    ],
  },
  {
    key: "petition_updated",
    label: "陳情更新",
    desc: "負責的陳情案件有回覆、補件或狀態變更時提醒",
    group: "campus",
    permissions: [
      "petition:view_org",
      "petition:assign",
      "petition:handle",
      "petition:transfer",
      "petition:admin",
    ],
  },
  {
    key: "petition_assigned",
    label: "陳情指派",
    desc: "陳情案件被分派給您或所屬機關時提醒",
    group: "campus",
    permissions: ["petition:handle", "petition:admin"],
  },
  {
    key: "petition_replied",
    label: "陳情回覆",
    desc: "陳情已有公開回覆或補件要求時提醒",
    group: "campus",
  },
  {
    key: "petition_status_updated",
    label: "陳情狀態",
    desc: "陳情轉派、結案或狀態改變時提醒",
    group: "campus",
  },
  {
    key: "meal_class_collecting",
    label: "學餐收單",
    desc: "班級收款、結單或訂購管理提醒",
    group: "campus",
  },
  {
    key: "meal_pickup_ready",
    label: "學餐取餐",
    desc: "取餐時段、未取餐與核銷提醒",
    group: "campus",
  },
  {
    key: "merchandise_submission_received",
    label: "新校商投稿",
    desc: "負責的校商投稿品項收到新投稿時提醒",
    group: "campus",
    permissions: ["merchandise_submission:review", "merchandise_submission:manage", "shop:manage"],
  },
  {
    key: "merchandise_submission_status",
    label: "校商投稿狀態",
    desc: "您送出的校商投稿審核狀態更新時提醒",
    group: "campus",
  },
  {
    key: "shop_order_paid",
    label: "商品訂單",
    desc: "訂單、付款、停售與取貨相關提醒",
    group: "campus",
  },
  {
    key: "survey_invitation",
    label: "問卷邀請",
    desc: "問卷開放、填答與截止提醒",
    group: "campus",
  },
  {
    key: "announcement",
    label: "公告通知",
    desc: "重要公告、緊急公告與公告更新提醒",
    group: "campus",
  },
  {
    key: "work_item_assigned",
    label: "工作指派",
    desc: "社群平台或系統建立的工作被指派給您",
    group: "personal",
  },
  {
    key: "work_item_due",
    label: "工作期限",
    desc: "工作項目即將到期或已逾期提醒",
    group: "personal",
  },
  {
    key: "system",
    label: "系統通知",
    desc: "平台維運、權限或安全相關提醒",
    group: "personal",
  },
];

const SYSTEM_EMAIL_OPTIONS = [
  {
    key: "email_scheduled_dispatch",
    label: "預約寄信",
    desc: "每 60 秒處理到期的預約郵件。關閉後，郵件會保留在排程中。",
    confirm: "確定關閉預約寄信？到期郵件會保留在排程中，不會被刪除。",
  },
] as const;

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
      className="relative inline-grid h-10 w-11 flex-shrink-0 place-items-center rounded-md transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-9 items-center rounded-full transition-colors"
        style={{ background: on ? "var(--primary)" : "var(--border-strong)" }}
      >
        <span
          className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
          style={{ transform: on ? "translateX(18px)" : "translateX(3px)" }}
        />
      </span>
    </button>
  );
}

export default function NotificationSettingsPage() {
  const confirm = useConfirm();
  const { can, canAny } = usePermissions();
  const canManageSystemEmail = can("feature_flag:admin");
  const { isModuleClosed } = useModuleStatus();
  const lineClosed = isModuleClosed("line");
  const discordClosed = isModuleClosed("discord");
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [lineLinked, setLineLinked] = useState(false);
  const [discordLinked, setDiscordLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [digest, setDigest] = useState<"off" | "daily" | "weekly">("off");
  const [digestSaving, setDigestSaving] = useState(false);
  const [pushPermission, setPushPermission] =
    useState<NotificationPermission | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [systemEmailFlags, setSystemEmailFlags] = useState<FeatureFlagOut[]>(
    [],
  );
  const [systemEmailLoading, setSystemEmailLoading] = useState(false);
  const [systemEmailSaving, setSystemEmailSaving] = useState<string | null>(
    null,
  );
  const showLine = !lineClosed && lineLinked;
  const showDiscord = !discordClosed && discordLinked;

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPushPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!canManageSystemEmail) return;
    setSystemEmailLoading(true);
    featureFlagsApi
      .list()
      .then((flags) => {
        const keys = new Set<string>(
          SYSTEM_EMAIL_OPTIONS.map((option) => option.key),
        );
        setSystemEmailFlags(flags.filter((flag) => keys.has(flag.key)));
      })
      .catch((e) => toast.error(apiErrorMessage(e, "載入系統寄信設定失敗")))
      .finally(() => setSystemEmailLoading(false));
  }, [canManageSystemEmail]);

  useEffect(() => {
    Promise.all([
      notificationsApi.getPreferences(),
      lineApi.me().catch(() => ({ linked: false })),
      discordApi.me().catch(() => ({ linked: false })),
      notificationsApi
        .getDigestFrequency()
        .catch(() => ({ frequency: "off" as const })),
      notificationsApi.listWebPushSubscriptions().catch(
        () =>
          [] as {
            id: string;
            endpoint: string;
            device_label: string | null;
            is_active: boolean;
          }[],
      ),
    ])
      .then(([nextPrefs, line, discord, digestPref, subs]) => {
        setPrefs(nextPrefs);
        setLineLinked(Boolean(line.linked));
        setPushSubscribed(Array.isArray(subs) && subs.some((s) => s.is_active));
        setDiscordLinked(Boolean(discord.linked));
        setDigest(digestPref.frequency);
      })
      .catch((e) => toast.error(apiErrorMessage(e, "載入通知偏好失敗")))
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
      toast.error(apiErrorMessage(e, "更新摘要設定失敗"));
      setDigest(prev);
    } finally {
      setDigestSaving(false);
    }
  };

  const toggleSystemEmail = async (
    flag: FeatureFlagOut,
    confirmMessage: string,
  ) => {
    if (systemEmailSaving || flag.archived_at) return;
    const next = !flag.is_globally_enabled;
    if (
      !next &&
      !(await confirm({
        title: "關閉系統寄信？",
        description: confirmMessage,
        confirmLabel: "關閉寄信",
        danger: true,
      }))
    )
      return;

    setSystemEmailSaving(flag.key);
    try {
      const updated = await featureFlagsApi.update(flag.id, {
        is_globally_enabled: next,
      });
      setSystemEmailFlags((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success(next ? "系統寄信已開啟" : "系統寄信已關閉");
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新系統寄信設定失敗"));
    } finally {
      setSystemEmailSaving(null);
    }
  };

  const visibleOptions = useMemo(
    () =>
      OPTIONS.filter(
        (option) => !option.permissions || canAny(...option.permissions),
      ),
    [canAny],
  );

  const optionGroups = useMemo(
    () =>
      OPTION_GROUPS.map((group) => ({
        ...group,
        options: visibleOptions.filter((option) => option.group === group.id),
      })).filter((group) => group.options.length > 0),
    [visibleOptions],
  );

  const counts = useMemo(() => {
    if (!prefs) return { inapp: 0, email: 0, line: 0, discord: 0 };
    return {
      inapp: visibleOptions.filter((o) => prefs[o.key].inapp).length,
      email: visibleOptions.filter((o) => prefs[o.key].email).length,
      line: visibleOptions.filter((o) => prefs[o.key].line).length,
      discord: visibleOptions.filter((o) => prefs[o.key].discord).length,
    };
  }, [prefs, visibleOptions]);

  const update = async (next: NotificationPreferences) => {
    const prev = prefs;
    setPrefs(next);
    setSaving(true);
    try {
      const saved = await notificationsApi.updatePreferences(next);
      setPrefs(saved);
      toast.success("通知偏好已更新");
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
      setPrefs(prev);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof NotificationPreferences, channel: Channel) => {
    if (!prefs || saving) return;
    if (channel === "line" && !lineLinked) {
      toast.error("請先到帳號設定綁定 LINE");
      return;
    }
    if (channel === "discord" && !discordLinked) {
      toast.error("請先到帳號設定綁定 Discord");
      return;
    }
    update({
      ...prefs,
      [key]: { ...prefs[key], [channel]: !prefs[key][channel] },
    });
  };

  const setAll = (value: boolean) => {
    if (!prefs || saving) return;
    const next = { ...prefs };
    for (const o of visibleOptions) {
      next[o.key] = {
        ...prefs[o.key],
        inapp: value,
        email: value,
        ...(showLine ? { line: value } : {}),
        ...(showDiscord ? { discord: value } : {}),
      };
    }
    update(next);
  };

  const enablePush = async () => {
    setPushBusy(true);
    try {
      await enableWebPush();
      setPushPermission("granted");
      setPushSubscribed(true);
      toast.success("瀏覽器推播已啟用");
    } catch (e) {
      if (typeof Notification !== "undefined")
        setPushPermission(Notification.permission);
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
      toast.error(apiErrorMessage(e, "測試推播失敗"));
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">通知偏好設定</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            只顯示您目前角色可能收到的通知，並可選擇要用哪些方式接收
          </p>
        </div>
        <Link href="/notifications" className="btn btn-ghost">
          回通知中心
        </Link>
      </header>

      <section className="card overflow-hidden">
        <div
          className="px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="text-sm font-semibold">Email 摘要</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            把未讀通知聚合成單封
            Email，避免每則通知都收到一封信。即時通知仍會照常推播。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {(
            [
              { key: "off", label: "關閉" },
              { key: "daily", label: "每日 08:00" },
              { key: "weekly", label: "每週一 08:00" },
            ] as const
          ).map(({ key, label }) => {
            const active = digest === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => updateDigest(key)}
                disabled={digestSaving || loading}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-[color,background-color,border-color,opacity,box-shadow,transform] cursor-pointer hover:opacity-80 disabled:opacity-50"
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

      {canManageSystemEmail && (
        <section className="card overflow-hidden">
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <h2 className="text-sm font-semibold">系統寄信</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              僅具備 Feature Flag
              管理權限者可調整。這些是全站開關，不會改變個別使用者的通知偏好。
            </p>
          </div>
          {systemEmailLoading ? (
            <div className="p-5">
              <SectionSkeleton lines={2} />
            </div>
          ) : (
            <ul>
              {SYSTEM_EMAIL_OPTIONS.map((option) => {
                const flag = systemEmailFlags.find(
                  (item) => item.key === option.key,
                );
                const enabled = Boolean(
                  flag?.is_globally_enabled && !flag.archived_at,
                );
                return (
                  <li
                    key={option.key}
                    className="flex items-center gap-3 px-5 py-4"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {option.label}
                      </p>
                      <p
                        className="mt-1 text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {flag
                          ? option.desc
                          : "尚未完成系統 migration，暫無法調整。"}
                      </p>
                    </div>
                    <Switch
                      on={enabled}
                      disabled={
                        !flag ||
                        Boolean(flag.archived_at) ||
                        systemEmailSaving !== null
                      }
                      onClick={() => {
                        if (flag) void toggleSystemEmail(flag, option.confirm);
                      }}
                      label={`${enabled ? "關閉" : "開啟"}${option.label}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

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
                : [
                    `站內 ${counts.inapp} 項`,
                    `Email ${counts.email} 項`,
                    showLine && `LINE ${counts.line} 項`,
                    showDiscord && `Discord ${counts.discord} 項`,
                  ]
                    .filter(Boolean)
                    .join("、") + " 已啟用"}
              {saving ? "，儲存中" : ""}
            </p>
            {((!lineClosed && !lineLinked) ||
              (!discordClosed && !discordLinked)) && (
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                綁定 LINE 或 Discord 後，即可在這裡選擇要接收的通知。
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
          <div className="p-5">
            <SectionSkeleton lines={5} />
          </div>
        ) : !prefs ? (
          <div
            className="px-5 py-12 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
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
              {showLine && (
                <div
                  className="w-12 text-center text-[11px] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  LINE
                </div>
              )}
              {showDiscord && (
                <div
                  className="w-16 text-center text-[11px] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  Discord
                </div>
              )}
            </div>
            <ul>
              {optionGroups.map((group) => (
                <li key={group.id}>
                  <section aria-labelledby={`notification-group-${group.id}`}>
                    <div
                      className="px-5 py-3"
                      style={{
                        background: "var(--bg-hover)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <h3
                        id={`notification-group-${group.id}`}
                        className="text-sm font-semibold"
                      >
                        {group.label}
                      </h3>
                      <p
                        className="mt-0.5 text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {group.desc}
                      </p>
                    </div>
                    <ul>
                      {group.options.map((item) => (
                        <li
                          key={item.key}
                          className="flex items-center gap-3 px-5 py-3"
                          style={{ borderBottom: "1px solid var(--border)" }}
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-sm font-medium"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {item.label}
                            </p>
                            <p
                              className="mt-1 text-xs"
                              style={{ color: "var(--text-muted)" }}
                            >
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
                          {showLine && (
                            <div className="flex w-12 justify-center">
                              <Switch
                                on={prefs[item.key].line}
                                disabled={saving}
                                onClick={() => toggle(item.key, "line")}
                                label={`${item.label} LINE 通知`}
                              />
                            </div>
                          )}
                          {showDiscord && (
                            <div className="flex w-16 justify-center">
                              <Switch
                                on={prefs[item.key].discord}
                                disabled={saving}
                                onClick={() => toggle(item.key, "discord")}
                                label={`${item.label} Discord 通知`}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card p-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">瀏覽器推播</h2>
              {pushPermission === "granted" && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background:
                      "color-mix(in srgb, var(--success) 12%, transparent)",
                    color: "var(--success)",
                  }}
                >
                  已允許
                </span>
              )}
              {pushPermission === "denied" && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background:
                      "color-mix(in srgb, var(--danger) 12%, transparent)",
                    color: "var(--danger)",
                  }}
                >
                  已封鎖
                </span>
              )}
              {pushPermission === "default" && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background:
                      "color-mix(in srgb, var(--warning) 12%, transparent)",
                    color: "var(--warning)",
                  }}
                >
                  未設定
                </span>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              用於待審、公文狀態、公告與會議提醒。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={
                pushSubscribed
                  ? "btn btn-ghost btn-sm"
                  : "btn btn-primary btn-sm"
              }
              disabled={pushBusy || pushPermission === "denied"}
              onClick={enablePush}
            >
              {pushSubscribed ? "重新訂閱" : "啟用推播"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={pushBusy || !pushSubscribed}
              onClick={testPush}
            >
              測試推播
            </button>
          </div>
        </div>
        {pushPermission === "denied" && (
          <div
            className="rounded-lg px-4 py-3 text-xs space-y-1"
            style={{
              background: "color-mix(in srgb, var(--danger) 8%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--danger) 25%, transparent)",
              color: "var(--danger)",
            }}
          >
            <p className="font-medium">
              通知權限已被瀏覽器封鎖，無法彈出授權視窗。
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              請點擊瀏覽器網址列左側的「鎖頭」或「資訊」圖示 → 通知 →
              改為「允許」，然後重新整理頁面再點「啟用推播」。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
