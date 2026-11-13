// Network-first for the app shell, falling back to cache so it opens offline.
// API calls to Anthropic are never cached.
const CACHE = "thinkingout-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Something shared into the app from another app's share sheet (Android).
  // Park it in a cache the page picks up, then open a new capture.
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname.endsWith("/share-target")) {
    e.respondWith(
      (async () => {
        const form = await e.request.formData();
        const inbox = await caches.open("share-inbox");
        let n = 0;
        for (const file of form.getAll("images")) {
          if (file instanceof File && file.type.startsWith("image/")) {
            await inbox.put(new URL(`shared-image-${Date.now()}-${n++}`, self.registration.scope).href, new Response(file, { headers: { "Content-Type": file.type } }));
          }
        }
        const text = [form.get("title"), form.get("text"), form.get("url")].filter((v) => typeof v === "string" && v.trim()).join("\n");
        if (text) await inbox.put(new URL("shared-text", self.registration.scope).href, new Response(text));
        return Response.redirect(new URL("./#/talk?shared=1", self.registration.scope).href, 303);
      })(),
    );
    return;
  }

  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./"))),
  );
});
