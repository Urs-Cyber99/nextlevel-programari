// Service worker: face site-ul instalabil și rapid. Programările (/api) nu se pun niciodată în cache.
const VERSION = "nl-v2";
const SHELL = ["/", "/index.html", "/admin.html", "/anulare.html", "/manifest.webmanifest", "/manifest-admin.webmanifest",
  "/icons/icon-192.png", "/icons/admin-192.png", "/img/salon-hero.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return; // mereu de pe server

  // pagini: întâi rețeaua (ca să fie mereu la zi), cache doar dacă nu e net
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = url.pathname.startsWith("/admin") ? "/admin.html" : url.pathname.startsWith("/a/") ? "/anulare.html" : "/index.html";
        return (await caches.match(fallback)) || new Response("Ești offline. Încearcă din nou când ai internet.", { headers: { "content-type": "text/plain; charset=utf-8" } });
      })
    );
    return;
  }

  // poze, iconițe, fonturi: din cache, actualizate în fundal
  if (url.origin === location.origin || url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com")) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const cached = await c.match(req);
        const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
