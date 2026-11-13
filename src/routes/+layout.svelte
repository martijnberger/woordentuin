<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { activateUpdate, initializeOffline } from '#lib/offline.ts';

  let { children } = $props();
  let status = $state({ ready: false, updateAvailable: false, online: true });
  let updateError = $state('');
  let updating = $state(false);

  onMount(() => initializeOffline((value) => { status = value; }));

  async function update() {
    updating = true;
    updateError = '';
    try { await activateUpdate(); }
    catch (error) { updateError = error instanceof Error ? error.message : 'Bijwerken is niet gelukt.'; updating = false; }
  }
</script>

{@render children()}
<div class="offline-status" role="status" aria-live="polite">
  {#if status.ready}
    <span>{status.online ? 'Klaar voor offline oefenen' : 'Offline beschikbaar'}</span>
  {:else if !status.online}
    <span>Offline oefenen is nog niet beschikbaar. Open de app eerst met internet.</span>
  {:else}
    <span>Offline oefenen wordt voorbereid</span>
  {/if}
  {#if status.updateAvailable && !page.url.pathname.replace(/\/$/, '').endsWith('/play')}
    <button type="button" onclick={update} disabled={updating}>Nieuwe versie laden</button>
  {/if}
  {#if updateError}<span>{updateError}</span>{/if}
</div>

<style>
  .offline-status { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: .75rem; padding: 1rem 1.25rem calc(1rem + env(safe-area-inset-bottom)); color: #526458; font-size: .8rem; text-align: center; }
  .offline-status button { min-height: 44px; padding: .4rem .8rem; border: 1px solid currentColor; border-radius: .5rem; background: transparent; color: inherit; cursor: pointer; font: inherit; }
</style>
