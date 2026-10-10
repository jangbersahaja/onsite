self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "OnSITE update", {
      body: payload.body || "There is new outlet activity.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/manage" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || "/manage",
    self.location.origin,
  );
  if (targetUrl.origin !== self.location.origin) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const client = clients.find(
          (candidate) => new URL(candidate.url).origin === self.location.origin,
        );
        if (client) {
          return client
            .navigate(targetUrl.href)
            .then((windowClient) => windowClient?.focus());
        }
        return self.clients.openWindow(targetUrl.href);
      }),
  );
});
