"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import MobileNavConfigurator from "@/components/layout/MobileNavConfigurator";
import NavIcon from "@/components/layout/NavIcon";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { usePermissions } from "@/hooks/usePermissions";
import { navigationProfilesApi } from "@/lib/api";
import { NAV_ID_TO_MODULE } from "@/lib/modules";
import {
  DEFAULT_NAV_PREFERENCES,
  constrainMobileHidden,
  hasSavedNavPreferences,
  isMeetingsUnlocked,
  isNavItemVisible,
  MOBILE_NAV_MAX_ITEMS,
  MOBILE_NAV_MIN_ITEMS,
  navItemsFromEntries,
  NAVIGATION_PROFILES,
  NAV_ITEMS,
  navProfileFromApi,
  orderedItems,
  readNavPreferences,
  resolveNavigationProfile,
  writeNavPreferences,
  type NavItem,
  type NavigationProfileConfig,
  type NavPreferences,
} from "@/lib/navigation";

type Surface = "desktop" | "mobile";

export default function NavigationSettingsPage() {
  const [prefs, setPrefs] = useState<NavPreferences>(() => readNavPreferences());
  const [surface, setSurface] = useState<Surface>("desktop");
  const [hasCustomPrefs, setHasCustomPrefs] = useState(false);
  const [meetingsUnlocked, setMeetingsUnlocked] = useState(false);
  const [serverProfile, setServerProfile] = useState<NavigationProfileConfig | null>(null);
  const { can, isAdmin, permissions } = usePermissions();
  const { isModuleClosed } = useModuleStatus();

  useEffect(() => {
    const syncPrefs = () => {
      setPrefs(readNavPreferences());
      setHasCustomPrefs(hasSavedNavPreferences());
      setMeetingsUnlocked(isMeetingsUnlocked());
    };
    syncPrefs();
    window.addEventListener("hcca:navigation-preferences-changed", syncPrefs);
    window.addEventListener("storage", syncPrefs);
    return () => {
      window.removeEventListener("hcca:navigation-preferences-changed", syncPrefs);
      window.removeEventListener("storage", syncPrefs);
    };
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("user_id")) return;
    let alive = true;
    navigationProfilesApi.me()
      .then((result) => {
        if (alive && result.source !== "default" && result.profile) {
          setServerProfile(navProfileFromApi(result.profile));
        }
      })
      .catch(() => {
        if (alive) setServerProfile(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const navigationProfile = useMemo(
    () => resolveNavigationProfile(permissions, isAdmin),
    [isAdmin, permissions],
  );
  const activeProfile = useMemo(() => {
    if (isAdmin || permissions.has("admin:all")) return NAVIGATION_PROFILES.default;
    return serverProfile ?? NAVIGATION_PROFILES[navigationProfile];
  }, [isAdmin, navigationProfile, permissions, serverProfile]);
  const profileItems = useMemo(() => navItemsFromEntries(activeProfile.desktopSections), [activeProfile]);
  const profileItemIds = useMemo(
    () => new Set([...profileItems.map((item) => item.id), ...activeProfile.mobileOrder]),
    [activeProfile.mobileOrder, profileItems],
  );
  const profileNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => profileItemIds.has(item.id)),
    [profileItemIds],
  );
  const hasPrefix = useMemo(
    () => (prefix: string) =>
      isAdmin
      || permissions.has("admin:all")
      || Array.from(permissions).some((permission) => permission.startsWith(prefix)),
    [isAdmin, permissions],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const orderKey = surface === "desktop" ? "desktopOrder" : "mobileOrder";
  const hiddenKey = surface === "desktop" ? "desktopHidden" : "mobileHidden";
  const defaultOrder = surface === "mobile"
    ? (activeProfile.mobileOrder.length > 0 ? activeProfile.mobileOrder : profileItems.map((item) => item.id))
    : profileItems.map((item) => item.id);
  const effectiveOrder = hasCustomPrefs ? prefs[orderKey] : defaultOrder;
  const availableItems = useMemo(
    () => orderedItems(effectiveOrder, [], profileNavItems).filter((item) => isNavItemVisible(item, {
      can,
      hasPrefix,
      isAdmin,
      navigationProfile: activeProfile.id,
      meetingsUnlocked,
      isModuleClosed: (item) => isModuleClosed(NAV_ID_TO_MODULE[item.id] ?? null),
    })),
    [activeProfile.id, can, effectiveOrder, hasPrefix, isAdmin, isModuleClosed, meetingsUnlocked, profileNavItems],
  );
  const hidden = useMemo(() => {
    let baseHidden: string[];
    if (surface === "mobile" && !hasCustomPrefs) {
      const selected = new Set(defaultOrder.slice(0, MOBILE_NAV_MIN_ITEMS));
      baseHidden = profileNavItems
        .filter((item) => !selected.has(item.id))
        .map((item) => item.id);
    } else {
      baseHidden = prefs[hiddenKey];
    }
    return new Set(surface === "mobile"
      ? constrainMobileHidden(effectiveOrder, baseHidden, availableItems)
      : baseHidden);
  }, [availableItems, defaultOrder, effectiveOrder, hasCustomPrefs, hiddenKey, prefs, profileNavItems, surface]);
  const visibleCount = availableItems.filter((item) => !hidden.has(item.id)).length;
  const mobileSlotItems = useMemo(
    () => availableItems.filter((item) => !hidden.has(item.id)).slice(0, MOBILE_NAV_MIN_ITEMS),
    [availableItems, hidden],
  );

  const updatePrefs = (next: NavPreferences, message = "導覽設定已更新") => {
    setPrefs(next);
    setHasCustomPrefs(true);
    writeNavPreferences(next);
    toast.success(message);
  };

  const setOrder = (order: string[]) => updatePrefs({ ...prefs, [orderKey]: order }, "排序已更新");

  const setMobileSlots = (slotIds: string[], message = "手機底欄設定已更新") => {
    const slotSet = new Set(slotIds);
    const nextOrder = Array.from(new Set([
      ...slotIds,
      ...effectiveOrder,
    ]));
    const nextHidden = profileNavItems
      .filter((item) => !slotSet.has(item.id))
      .map((item) => item.id);
    updatePrefs({
      ...prefs,
      mobileOrder: nextOrder,
      mobileHidden: nextHidden,
    }, message);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentOrder = availableItems.map((item) => item.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextVisibleOrder = arrayMove(currentOrder, oldIndex, newIndex);
    const availableSet = new Set(currentOrder);
    let nextIndex = 0;
    const nextOrder = effectiveOrder.map((id) => {
      if (!availableSet.has(id)) return id;
      return nextVisibleOrder[nextIndex++];
    });
    setOrder(nextOrder);
  };

  const toggle = (id: string) => {
    const current = new Set(hidden);
    if (surface === "mobile") {
      const selectedCount = availableItems.filter((item) => !hidden.has(item.id)).length;
      if (current.has(id) && selectedCount <= MOBILE_NAV_MIN_ITEMS) {
        toast.info(`手機底欄至少保留 ${MOBILE_NAV_MIN_ITEMS} 個入口`);
        return;
      }
      if (!current.has(id) && selectedCount >= MOBILE_NAV_MAX_ITEMS) {
        toast.info(`手機底欄最多選擇 ${MOBILE_NAV_MAX_ITEMS} 個入口`);
        return;
      }
    }
    if (hidden.has(id)) current.delete(id);
    else current.add(id);
    updatePrefs({ ...prefs, [hiddenKey]: Array.from(current) });
  };

  const reset = () => {
    const mobileOrder = (activeProfile.mobileOrder.length > 0
      ? activeProfile.mobileOrder
      : profileItems.map((item) => item.id)
    ).filter((id, index, order) => profileItemIds.has(id) && order.indexOf(id) === index);
    const next = {
      ...DEFAULT_NAV_PREFERENCES,
      desktopOrder: profileItems.map((item) => item.id),
      mobileOrder,
      mobileHidden: mobileOrder.slice(MOBILE_NAV_MIN_ITEMS),
    };
    updatePrefs(next, "已恢復預設導覽");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            INTERFACE
          </p>
          <h1 className="mt-1 text-xl font-semibold">介面導覽設定</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            調整左側側邊欄與手機底部欄位的顯示項目和排序
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          <RotateCcw size={15} aria-hidden={true} />
          重設預設
        </button>
      </header>

      <section className="card overflow-hidden">
        <div
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold">導覽項目</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {surface === "mobile"
                ? `固定 ${MOBILE_NAV_MIN_ITEMS} 個入口；點擊方格更換功能，拖曳可交換排序`
                : `目前顯示 ${visibleCount} 個可用項目；拖曳可排序`}
            </p>
          </div>
          <div className="inline-flex rounded-md p-1" style={{ border: "1px solid var(--border)" }}>
            <TabButton active={surface === "desktop"} onClick={() => setSurface("desktop")}>
              左側欄
            </TabButton>
            <TabButton active={surface === "mobile"} onClick={() => setSurface("mobile")}>
              手機底欄
            </TabButton>
          </div>
        </div>

        {surface === "mobile" ? (
          <div className="p-5">
            <MobileNavConfigurator
              items={availableItems}
              selectedIds={mobileSlotItems.map((item) => item.id)}
              onChange={(slotIds) => setMobileSlots(slotIds)}
            />

            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              手機底欄會依序顯示這四格；其他入口可從「更多」開啟。
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={availableItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {availableItems.map((item) => (
                  <SortableNavRow
                    key={item.id}
                    item={item}
                    visible={!hidden.has(item.id)}
                    disabled={false}
                    onToggle={() => toggle(item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded px-3 py-1.5 text-sm transition-colors"
      onClick={onClick}
      style={{
        background: active ? "var(--primary-dim)" : "transparent",
        color: active ? "var(--primary)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function SortableNavRow({
  item,
  visible,
  disabled,
  onToggle,
}: {
  item: NavItem;
  visible: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3"
    >
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        className="btn btn-ghost btn-icon cursor-grab active:cursor-grabbing"
        aria-label={`拖曳排序 ${item.label}`}
      >
        <GripVertical size={16} aria-hidden={true} />
      </button>
      <span
        className="flex h-9 w-9 items-center justify-center rounded-md"
        style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
      >
        <NavIcon iconKey={item.iconKey} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.label}</p>
        <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {item.href}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={visible}
        aria-label={`${visible ? "隱藏" : "顯示"}${item.label}`}
        disabled={disabled}
        onClick={onToggle}
        className="inline-flex h-6 w-11 items-center rounded-full transition-colors"
        style={{
          background: visible ? "var(--primary)" : "var(--border-strong)",
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full bg-white transition-transform"
          style={{ transform: visible ? "translateX(24px)" : "translateX(4px)" }}
        >
          {visible && <Check size={10} aria-hidden={true} style={{ color: "var(--primary)" }} />}
        </span>
      </button>
    </div>
  );
}
