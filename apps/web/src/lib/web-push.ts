import { notificationsApi } from "@/lib/api";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export async function enableWebPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("此瀏覽器不支援 Web Push");
  }
  const config = await notificationsApi.webPushConfig();
  if (!config.enabled || !config.public_key) {
    throw new Error("後端尚未設定 VAPID key");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知權限未開啟");
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.public_key),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("瀏覽器 subscription 格式不完整");
  }
  return notificationsApi.saveWebPushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
}
