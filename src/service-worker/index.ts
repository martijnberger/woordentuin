import { self as worker } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { resolve } from '$app/paths';

const prefix = 'woordentuin-precache-';
const cacheName = `${prefix}${version}`;
const files = [...new Set([...assets, ...immutable, ...prerendered].map(({ path }) => resolve(path)))];

worker.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files);
  })());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await worker.clients.claim();
  })());
});

worker.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_READY') {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      const entries = await Promise.all(files.map((file) => cache.match(file)));
      event.ports[0]?.postMessage({ ready: files.length > 0 && entries.every(Boolean) });
    })());
    return;
  }
  if (event.data?.type !== 'ACTIVATE_UPDATE') return;
  event.waitUntil((async () => {
    const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sourceId = event.source && 'id' in event.source ? event.source.id : undefined;
    if (clients.some((client) => client.id !== sourceId)) {
      event.ports[0]?.postMessage({ ok: false });
      return;
    }
    event.ports[0]?.postMessage({ ok: true });
    await worker.skipWaiting();
  })());
});

worker.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== worker.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const url = new URL(event.request.url);
    const cached = await cache.match(url.pathname) ?? (event.request.mode === 'navigate' && !url.pathname.endsWith('/') ? await cache.match(`${url.pathname}/`) : undefined);
    return cached ?? fetch(event.request);
  })());
});
