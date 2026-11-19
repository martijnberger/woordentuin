<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { PRACTICE_MODES, eligibleWords, practiceChapters, progressKey, targetLanguages } from '#lib/learning/index.ts';
  import { loadSnapshot, saveSettings } from '#lib/storage/index.ts';
  import type { Snapshot, PracticeLanguage } from '#lib/model.ts';

  let snapshot = $state<Snapshot | null>(null);
  let error = $state('');
  let busy = $state(false);
  let language = $state<PracticeLanguage>('mvt');
  let chapter = $state('all');
  let chapters = $derived(snapshot ? practiceChapters(snapshot.words, language) : []);
  let eligible = $derived(snapshot ? eligibleWords(snapshot.words, { ...snapshot.settings, language, chapter }) : []);
  let pairs = $derived(eligible.flatMap((word) => targetLanguages(word, { ...snapshot!.settings, language, chapter }).map((target) => ({ word, target }))));
  let due = $derived(snapshot ? pairs.filter(({ word, target }) => {
    const item = snapshot!.progress[progressKey(word.id, target, 'match')];
    return item && item.revision === word.revision && item.dueAt <= Date.now();
  }).length : 0);
  let newCount = $derived(snapshot ? pairs.filter(({ word, target }) => {
    const item = snapshot!.progress[progressKey(word.id, target, 'match')];
    return !item || item.revision !== word.revision;
  }).length : 0);
  let active = $derived(snapshot?.session && snapshot.session.phase !== 'results' ? snapshot.session : null);

  onMount(() => {
    loadSnapshot().then((data) => {
      snapshot = data;
      language = data.settings.language;
      chapter = data.settings.chapter;
    }).catch((reason) => { error = message(reason); });
  });
  function message(reason: unknown) { return reason instanceof Error ? reason.message : 'De gegevens op dit apparaat konden niet worden geopend.'; }
  async function changeSettings(nextLanguage: PracticeLanguage, nextChapter: string) {
    if (!snapshot || busy) return;
    busy = true;
    error = '';
    const previous = snapshot.settings;
    if (nextLanguage !== language && !practiceChapters(snapshot.words, nextLanguage).includes(nextChapter)) nextChapter = 'all';
    language = nextLanguage;
    chapter = nextChapter;
    try {
      const settings = { ...previous, language, chapter };
      await saveSettings(settings);
      snapshot = { ...snapshot, settings };
    } catch (reason) {
      language = previous.language;
      chapter = previous.chapter;
      error = `Instellingen niet opgeslagen. ${message(reason)}`;
    } finally { busy = false; }
  }
</script>

<svelte:head><title>Woordentuin — samen woorden laten groeien</title><meta name="description" content="Oefen je schoolwoorden op je eigen tempo." /></svelte:head>
<div class="shell home-shell">
  <header class="site-header"><a class="brand" href={resolve('/')} aria-label="Woordentuin, naar start"><span class="brand-mark" aria-hidden="true">✳</span><span>woordentuin</span></a><a class="quiet-link" href={resolve('parent/')}>Voor ouders <span aria-hidden="true">↗</span></a></header>
  <main class="home-main">
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow"><span class="eyebrow-dot"></span> EEN BEETJE OEFENEN, ELKE KEER WEER</p><h1>Woorden groeien <em>met je mee.</em></h1><p class="hero-text">Ontdek, verbind en onthoud je schoolwoorden. Helemaal op jouw tempo.</p></div>
      <div class="garden-art" aria-hidden="true"><svg viewBox="0 0 300 230" fill="none"><circle cx="150" cy="110" r="100" fill="#e4e6c9"/><path d="M32 185c48-30 169-28 236 0" stroke="#536b42" stroke-width="2"/><path d="M150 183V62M150 139c-18-4-32-18-35-34 18 0 32 10 35 26M150 116c18-5 32-19 34-35-18 1-31 11-34 27" stroke="#536b42" stroke-width="4" stroke-linecap="round"/><path d="M150 70c-20-15-14-34 0-43 14 9 20 28 0 43Z" fill="#d9b8ce"/><path d="M115 105c-19-2-29-14-30-27 17 0 28 9 30 27ZM184 81c19-2 29-14 30-27-17 0-28 9-30 27Z" fill="#9caf82"/><circle cx="76" cy="144" r="7" fill="#e9b99a"/><circle cx="225" cy="137" r="6" fill="#c8add0"/><path d="M60 172v-17m-8 8h16M226 97V83m-7 7h14" stroke="#667b54" stroke-width="2" stroke-linecap="round"/></svg></div>
    </section>
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    {#if snapshot}
      {#if snapshot.notice}<div class="notice" role="status">{snapshot.notice}</div>{/if}
      <section class="setup-card" aria-labelledby="setup-heading">
        <div class="section-heading"><div><p class="eyebrow">JOUW OEFENPLEK</p><h2 id="setup-heading">Klaar om te groeien?</h2></div><span class="step-badge" aria-hidden="true">01</span></div>
        {#if active}<div class="resume-note"><strong>Je ronde staat voor je klaar.</strong><span>Ga verder met {PRACTICE_MODES[active.settings.language]}{active.settings.chapter !== 'all' ? ` · ${active.settings.chapter}` : ''}.</span></div>{/if}
        <div class="field-grid" class:course-fields={language === 'fr-3vwo'}>
          <label>Taal<select value={language} onchange={(event) => changeSettings(event.currentTarget.value as PracticeLanguage, chapter)} disabled={busy || !!active}>{#each Object.entries(PRACTICE_MODES) as [code, label]}<option value={code}>{label}</option>{/each}</select></label>
          <label>{language === 'fr-3vwo' ? 'Onderdeel' : 'Hoofdstuk'}<select value={chapter} onchange={(event) => changeSettings(language, event.currentTarget.value)} disabled={busy || !!active}><option value="all">{language === 'fr-3vwo' ? 'Alle onderdelen' : 'Alle hoofdstukken'}</option>{#each chapters as name}<option value={name}>{name}</option>{/each}</select></label>
        </div>
        {#if language === 'mvt'}
          <p class="muted small">MVT oefent de woorden uit het boek met Nederlands als basis en Frans, Duits en Spaans door elkaar. Engels kun je apart oefenen. Per woord verschilt de beschikbare vertaling.</p>
        {:else if language === 'fr-3vwo'}
          <p class="muted small"><strong>Unité 2 · Sports et passions.</strong> Verbind Frans en Nederlands: woorden, zinnen, grammatica en kloktijden.</p>
        {/if}
        {#if active}<p class="muted small">Maak je ronde eerst af om iets anders te kiezen.</p>{:else if eligible.length === 0}<p class="muted">Er zijn nog geen gecontroleerde woorden voor deze keuze. Vraag een ouder om woorden toe te voegen of te controleren.</p>{:else}<p class="practice-note"><span aria-hidden="true">✦</span> {#if due > 0}{due} {due === 1 ? 'woordenpaar' : 'woordenparen'} klaar om te herhalen.{:else if newCount > 0}Tijd om nieuwe woorden te ontdekken.{:else}Alles is bijgewerkt. Je mag natuurlijk extra oefenen.{/if}</p>{/if}
        <a class:disabled={busy || (!active && eligible.length === 0)} aria-disabled={busy || (!active && eligible.length === 0)} tabindex={busy || (!active && eligible.length === 0) ? -1 : undefined} class="button primary wide" href={resolve('play/')}>{active ? 'Verder oefenen' : 'Oefenen'} <span aria-hidden="true">→</span></a>
        <p class="privacy-note">Je voortgang wordt op dit apparaat bewaard.</p>
      </section>
    {:else if !error}<p class="loading" role="status">Je woordentuin wordt geopend…</p>{/if}
    <div class="home-footer"><span>Groeien gaat stap voor stap.</span><span>Geen haast, geen tijdklok.</span></div>
  </main>
</div>

<style>
  .field-grid label { min-width: 0; }
  @media (max-width: 620px) {
    .course-fields { grid-template-columns: 1fr; }
  }
</style>
