"use client";

const LOW_DATA_STORAGE_KEY = "hcca-low-data-mode";

type NavigatorConnection = {
  saveData?: boolean;
};

function browserSaveDataEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: NavigatorConnection;
    mozConnection?: NavigatorConnection;
    webkitConnection?: NavigatorConnection;
  }).connection
    ?? (navigator as Navigator & { mozConnection?: NavigatorConnection }).mozConnection
    ?? (navigator as Navigator & { webkitConnection?: NavigatorConnection }).webkitConnection;
  return connection?.saveData === true;
}

export function readLowDataMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(LOW_DATA_STORAGE_KEY) === "true";
}

export function writeLowDataMode(enabled: boolean) {
  localStorage.setItem(LOW_DATA_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("hcca:low-data-mode-change"));
}

export function prefersReducedNetworkUsage(): boolean {
  if (typeof window === "undefined") return false;
  return readLowDataMode() || browserSaveDataEnabled();
}

export function lowDataPreferenceLabel(): string {
  if (readLowDataMode()) return "已手動啟用";
  if (browserSaveDataEnabled()) return "瀏覽器省流量已啟用";
  return "未啟用";
}
