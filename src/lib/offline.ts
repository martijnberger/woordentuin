type OfflineStatus = { ready: boolean; updateAvailable: boolean; online: boolean };
let registration: ServiceWorkerRegistration | undefined;

function ask(worker: ServiceWorker, type: string): Promise<Record<string, boolean>> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('De offline service reageert niet.')); }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

export function initializeOffline(onStatus: (status: OfflineStatus) => void): () => void {
  let stopped = false;
  let ready = false;
  let watched: ServiceWorker | null = null;
  const emit = () => { if (!stopped) onStatus({ ready, updateAvailable: !!registration?.waiting && !!navigator.serviceWorker?.controller, online: navigator.onLine }); };
  const refresh = async () => {
    const controller = navigator.serviceWorker?.controller;
    ready = false;
    if (controller) {
      try { ready = (await ask(controller, 'CHECK_READY')).ready === true; } catch { ready = false; }
    }
    emit();
  };
  const stateChange = () => { void refresh(); };
  const watch = () => {
    if (watched) watched.removeEventListener('statechange', stateChange);
    watched = registration?.installing ?? null;
    watched?.addEventListener('statechange', stateChange);
    void refresh();
  };
  const connectivity = () => { void refresh(); };
  window.addEventListener('online', connectivity);
  window.addEventListener('offline', connectivity);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', connectivity);
    void navigator.serviceWorker.ready.then((value) => {
      if (stopped) return;
      registration = value;
      registration.addEventListener('updatefound', watch);
      watch();
      if (navigator.onLine) void registration.update().catch(() => {});
    });
  }
  emit();
  return () => {
    stopped = true;
    window.removeEventListener('online', connectivity);
    window.removeEventListener('offline', connectivity);
    navigator.serviceWorker?.removeEventListener('controllerchange', connectivity);
    registration?.removeEventListener('updatefound', watch);
    watched?.removeEventListener('statechange', stateChange);
  };
}

export async function activateUpdate(): Promise<void> {
  const waiting = registration?.waiting;
  if (!waiting) throw new Error('Er staat geen update klaar.');
  const result = await ask(waiting, 'ACTIVATE_UPDATE');
  if (!result.ok) throw new Error('Sluit eerst de andere tabbladen van Woordentuin en probeer opnieuw.');
  await new Promise<void>((resolve) => {
    if (navigator.serviceWorker.controller === waiting) return resolve();
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
  });
  window.location.reload();
}
