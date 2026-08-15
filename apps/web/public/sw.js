const STATIC_CACHE = "hcca-static-v4";
const PUBLIC_PAGE_CACHE = "hcca-public-pages-v1";
const PRIVATE_API_CACHE = "hcca-private-api-v1";
const PRIVATE_API_META_CACHE = "hcca-private-api-meta-v1";
const CACHE_PREFIX = "hcca-";
const PRIVATE_API_MAX_AGE_MS = 30_000;
const PRECACHE_URLS = ["/offline.html", "/manifest.webmanifest"];
const PRIVATE_API_PATHS = new Set([
  "/api/dashboard/composite",
  "/api/tasks",
  "/api/announcements",
]);
const clientUserKeys = new Map();

// These are the only HTML routes that may enter the Service Worker cache. The
// request must also be an unauthenticated, full-page navigation below.
const PUBLIC_NAVIGATION_PREFIXES = [
  "/",
  "/about",
  "/contact",
  "/links",
  "/news",
  "/officers",
  "/pages",
  "/public",
  "/system-info",
  "/live/elections",
];
const PUBLIC_NAVIGATION_EXACT_PATHS = new Set([
  "/announcements",
  "/documents",
  "/legal",
  "/partner-map",
  "/petitions",
  "/petitions/new",
  "/petitions/public",
  "/petitions/share",
  "/regulations",
  "/surveys",
]);

function isPathInList(pathname, prefixes) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isStaticNextAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

function isPublicNavigation(request, url) {
  if (request.mode !== "navigate" || url.origin !== self.location.origin || url.search) return false;
  if (request.headers.get("RSC") === "1" || request.headers.get("Next-Router-Prefetch") === "1") {
    return false;
  }
  // A cookie can represent an authenticated session even when the current
  // page itself is public. Never cache a response from such a request.
  if (request.headers.get("cookie") || request.headers.get("authorization")) return false;
  if (PUBLIC_NAVIGATION_EXACT_PATHS.has(url.pathname)) return true;
  if (isPathInList(url.pathname, PUBLIC_NAVIGATION_PREFIXES)) return true;
  if (url.pathname.startsWith("/announcements/")
    && !url.pathname.endsWith("/new")
    && !url.pathname.includes("/edit")) return true;
  if (url.pathname.startsWith("/documents/")
    && !url.pathname.endsWith("/new")
    && !url.pathname.includes("/delegations")
    && !url.pathname.includes("/edit")) return true;
  if (url.pathname.startsWith("/regulations/")
    && !["/new", "/pending", "/archived"].some((suffix) => url.pathname.endsWith(suffix))
    && !url.pathname.includes("/edit")
    && !url.pathname.includes("/amendment")) return true;
  if (url.pathname.startsWith("/surveys/")
    && !url.pathname.endsWith("/new")
    && !url.pathname.includes("/edit")) return true;
  if (url.pathname.startsWith("/petitions/public/")) return true;
  return url.pathname.startsWith("/partner-map/")
    && !url.pathname.startsWith("/partner-map/admin")
    && !url.pathname.startsWith("/partner-map/my-businesses");
}

function isCacheableResponse(response) {
  const cacheControl = response.headers.get("Cache-Control") || "";
  const contentType = response.headers.get("Content-Type") || "";
  return response.ok
    && response.type === "basic"
    && contentType.includes("text/html")
    && !/(?:private|no-store)/i.test(cacheControl);
}

function isCacheableStaticAsset(response) {
  const cacheControl = response.headers.get("Cache-Control") || "";
  return response.ok
    && response.type === "basic"
    && !/(?:private|no-store)/i.test(cacheControl);
}

async function cacheResponse(cacheName, request, response) {
  if (!isCacheableResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

async function cacheStaticAsset(request, response) {
  if (!isCacheableStaticAsset(response)) return;
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(request, response.clone());
}

async function clearPrivateCaches() {
  clientUserKeys.clear();
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, PUBLIC_PAGE_CACHE].includes(key))
      .map((key) => caches.delete(key)),
  );
}

function privateApiCacheKey(request, userId) {
  const headers = new Headers(request.headers);
  headers.set("X-HCCA-Cache-User", userId);
  return new Request(request, { headers });
}

async function networkFirstPrivateApi(request, userId) {
  const cache = await caches.open(PRIVATE_API_CACHE);
  const metadata = await caches.open(PRIVATE_API_META_CACHE);
  const cacheKey = privateApiCacheKey(request, userId);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(cacheKey, response.clone());
      await metadata.put(cacheKey, new Response(String(Date.now())));
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    const timestamp = await metadata.match(cacheKey);
    const cachedAt = Number(timestamp ? await timestamp.text() : 0);
    if (cached && cachedAt && Date.now() - cachedAt <= PRIVATE_API_MAX_AGE_MS) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, PUBLIC_PAGE_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_CACHE_USER" && event.source?.id && event.data.userId) {
    clientUserKeys.set(event.source.id, String(event.data.userId));
  }
  if (event.data?.type === "CLEAR_PRIVATE_CACHES") {
    event.waitUntil(clearPrivateCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (PRIVATE_API_PATHS.has(url.pathname)) {
    const userId = clientUserKeys.get(event.clientId);
    const requestUserId = request.headers.get("X-HCCA-Cache-User");
    if (userId && requestUserId === userId) {
      event.respondWith(networkFirstPrivateApi(request, userId));
    } else {
      event.respondWith(fetch(request));
    }
    return;
  }

  if (isStaticNextAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        await cacheStaticAsset(request, response);
        return response;
      }),
    );
    return;
  }

  if (isPublicNavigation(request, url)) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          await cacheResponse(PUBLIC_PAGE_CACHE, request, response);
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(PUBLIC_PAGE_CACHE);
          const cached = await cache.match(request);
          return cached || caches.match("/offline.html");
        }),
    );
    return;
  }

  // Navigations outside the explicit public allow-list are never read from or
  // written to a cache. When offline, show a dedicated static page instead of
  // leaking a previously rendered authenticated HTML/RSC response.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  }
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  const title = data.title || "HCCA 通知";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url || data.link || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/notifications";
  event.waitUntil(clients.openWindow(url));
});
