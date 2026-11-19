import { self as worker } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { resolve } from '$app/paths';

const prefix = 'woordentuin-precache-';
const cacheName = `${prefix}${version}`;
const files = [...new Set([...assets, ...immutable, ...prerendered].map(({ path }) => resolve(path)))];
const scope = new URL(worker.registration.scope);
const immutablePath = `${scope.pathname}_app/immutable/`;

worker.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files);
  })());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Open tabs may still import modules from their original build after the takeover.
    if (!clients.some((client) => client.url.startsWith(scope.href))) {
      const names = await caches.keys();
      for (const name of names.slice(0, names.indexOf(cacheName))) {
        if (name.startsWith(prefix)) await caches.delete(name);
      }
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
    await worker.skipWaiting();
    event.ports[0]?.postMessage({ ok: true });
  })());
});

worker.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== worker.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const url = new URL(event.request.url);
    const cached = await cache.match(url.pathname) ?? (event.request.mode === 'navigate' && !url.pathname.endsWith('/') ? await cache.match(`${url.pathname}/`) : undefined);
    if (!cached && url.pathname.startsWith(immutablePath)) {
      for (const name of await caches.keys()) {
        if (!name.startsWith(prefix) || name === cacheName) continue;
        const previous = await caches.match(url.pathname, { cacheName: name });
        if (previous) return previous;
      }
    }
    return cached ?? fetch(event.request);
  })());
});
