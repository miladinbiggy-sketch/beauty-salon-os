/* Beauty Salon OS — 顾客端 Service Worker
 * 策略：app shell（同源静态资源）缓存优先 + 后台更新；
 * API 请求一律网络直通，绝不缓存（预约数据必须实时）。 */
const CACHE = "salon-customer-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API 与非 GET 请求：网络优先，不缓存
  if (event.request.method !== "GET" || url.pathname.includes("/public/") || url.pathname.includes("/v1/")) {
    return;
  }
  // 同源静态资源：缓存优先，后台刷新
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
