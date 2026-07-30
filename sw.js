const CACHE = "eok-v33"; // 배포마다 버전 올리기
const ASSETS = [
  "./", "./index.html", "./styles.css", "./logic.js", "./sync.js", "./app.js",
  "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        // HTTP 캐시를 우회해 항상 이 배포의 실제 파일을 담는다 — 연속 배포 시
        // 브라우저 HTTP 캐시의 직전 버전이 새 캐시에 담기는 버전 스큐 방지
        await Promise.all(
          ASSETS.map(async (asset) => {
            const response = await fetch(asset, { cache: "no-store" });
            if (!response.ok) throw new Error(`fetch failed: ${asset}`);
            await cache.put(asset, response);
          }),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
