<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { resolve } from '$app/paths';
  import { LANGUAGES, PRACTICE_MODES, createSession, transition } from '#lib/learning/index.ts';
  import type { Action } from '#lib/learning/index.ts';
  import { acquirePlayLock, loadSnapshot, saveSession } from '#lib/storage/index.ts';
  import type { Session, Snapshot, Word } from '#lib/model.ts';

  let snapshot = $state<Snapshot | null>(null);
  let session = $state<Session | null>(null);
  let busy = $state(true);
  let error = $state('');
  let paused = $state(false);
  let revealed = $state(false);
  let announcement = $state('');
  let heading = $state<HTMLElement>();
  let release: (() => void) | undefined;
  let disposed = false;
  let board = $derived(session?.boards[session.boardIndex]);
  let boardDone = $derived(!!board && board.left.every((id) => board.matched.includes(id)));
  let wordMap = $derived(new Map((session?.words ?? []).map((word) => [word.id, word])));
  let recallWord = $derived(session ? wordMap.get(session.recallWordIds[session.recallIndex]) : undefined);
  function releaseLock() { release?.(); release = undefined; }

  function message(reason: unknown) { return reason instanceof Error ? reason.message : 'Er ging iets mis bij het bewaren.'; }
  function text(id: string, side: 'left' | 'right') {
    const word = wordMap.get(id);
    return word?.forms[side === 'left' ? 'nl' : session!.wordLanguages[id]] ?? '';
  }
  function context(word: Word | undefined) { return word?.context ? ` · ${word.context}` : ''; }
  async function focusHeading() { await tick(); heading?.focus(); }
  async function start() {
    try {
      const unlock = await acquirePlayLock();
      if (disposed) { unlock(); return; }
      release = unlock;
      const data = await loadSnapshot();
      if (disposed) return;
      snapshot = data;
      if (data.session && data.session.phase !== 'results') session = { ...data.session, selection: null };
      else {
        const fresh = createSession(data.words, data.progress, data.settings);
        const saved = await saveSession(fresh);
        if (disposed) return;
        snapshot = saved;
        session = saved.session;
      }
      if (typeof navigator.storage?.persist === 'function') void navigator.storage.persist().catch(() => {});
    } catch (reason) { if (!disposed) error = message(reason); }
    finally { if (disposed) releaseLock(); else busy = false; }
  }
  onMount(() => {
    paused = document.hidden;
    const visibility = () => { paused = document.hidden; };
    document.addEventListener('visibilitychange', visibility);
    void start();
    return () => { disposed = true; document.removeEventListener('visibilitychange', visibility); if (!busy) releaseLock(); };
  });
  async function act(action: Action) {
    if (!session || busy || paused) return;
    busy = true;
    error = '';
    const before = session;
    try {
      const result = transition($state.snapshot(before), action);
      if (result.session.version === before.version && result.exposures.length === 0) {
        session = result.session;
      } else {
        const saved = await saveSession({ ...result.session, selection: null }, result.exposures);
        snapshot = saved;
        // Keep an anchor selected after a wrong answer, but never persist it.
        session = saved.session ? { ...saved.session, selection: result.session.selection } : result.session;
      }
      announcement = session.feedback;
      if (session.phase !== before.phase || session.boardIndex !== before.boardIndex || session.recallIndex !== before.recallIndex) {
        revealed = false;
        await focusHeading();
      }
    } catch (reason) {
      error = `Niet opgeslagen. Probeer het opnieuw. ${message(reason)}`;
    } finally { if (disposed) releaseLock(); else busy = false; }
  }
  async function anotherRound() {
    if (!snapshot || busy || paused) return;
    busy = true; error = '';
    try {
      const data = $state.snapshot(snapshot);
      const fresh = createSession(data.words, data.progress, data.settings);
      const saved = await saveSession(fresh);
      snapshot = saved; session = saved.session; revealed = false; announcement = '';
      await focusHeading();
    } catch (reason) { error = `De nieuwe ronde is niet gestart. ${message(reason)}`; }
    finally { if (disposed) releaseLock(); else busy = false; }
  }
</script>
<svelte:head><title>Oefenen — Woordentuin</title></svelte:head>
<div class="shell play-shell">
  <header class="site-header"><a class="brand" href={resolve('/')} aria-label="Woordentuin, naar start"><span class="brand-mark" aria-hidden="true">✳</span><span>woordentuin</span></a><a class="quiet-link" href={resolve('/')}>Bewaar & sluit <span aria-hidden="true">×</span></a></header>
  <main class="play-main">
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    {#if paused}<div class="notice" role="status">Even gepauzeerd. Ga verder wanneer je terug bent.</div>{/if}
    {#if busy && !session}<p class="loading" role="status">Je ronde wordt klaargezet…</p>
    {:else if !session}<section class="play-card"><h1>Je ronde kon niet worden geopend.</h1><p>Je gegevens blijven op dit apparaat staan.</p><a class="button secondary" href={resolve('/')}>Terug naar start</a></section>
    {:else}
      <div class="play-topline"><span class="eyebrow">{PRACTICE_MODES[session.settings.language]} {session.settings.chapter !== 'all' ? ` / ${session.settings.chapter}` : ''}</span><span class="play-status">{session.phase === 'intro' ? 'ONTDEKKEN' : session.phase === 'match' ? `VERBINDEN · ${session.boardIndex + 1} / ${session.boards.length}` : session.phase === 'recall' ? 'HERINNEREN' : 'AFGEROND'}</span></div>
      {#if session.phase === 'intro'}
        <section class="play-card intro-card"><p class="eyebrow">EERST EVEN KIJKEN</p><h1 tabindex="-1" bind:this={heading}>Dit zijn je nieuwe woorden.</h1><p class="lead">Neem rustig de tijd. Straks mag je ze met elkaar verbinden.</p><div class="intro-words">{#each session.newWordIds as id}{@const word = wordMap.get(id)}{@const target = session.wordLanguages[id]}{#if word}<div class="intro-word"><span lang="nl">{word.forms.nl}</span><span class="word-arrow" aria-hidden="true">→</span><strong lang={target}>{word.forms[target]}</strong>{#if session.settings.language === 'mvt'}<small>{LANGUAGES[target]}</small>{/if}{#if word.context}<small>{word.context}</small>{/if}</div>{/if}{/each}</div><button class="button primary wide" disabled={busy || paused} onclick={() => act({ type: 'begin' })}>Ik ben er klaar voor <span aria-hidden="true">→</span></button></section>
      {:else if session.phase === 'match' && board}
        <section class="board-section"><div class="board-heading"><div><p class="eyebrow">MAAK DE GOEDE COMBINATIES</p><h1 tabindex="-1" bind:this={heading}>Welke woorden horen bij elkaar?</h1><p class="lead">Kies een woord en daarna de vertaling.</p></div><div class="round-number" aria-hidden="true">{String(session.boardIndex + 1).padStart(2, '0')}</div></div>
          <div class="board-labels"><span>NEDERLANDS</span><span>{session.settings.language === 'mvt' ? 'VERTALINGEN' : LANGUAGES[session.settings.language].toUpperCase()}</span></div>
          <div class="board-grid">{#each ['left', 'right'] as sideValue}{@const side = sideValue as 'left' | 'right'}<div class="tile-column">{#each board[side] as id (id)}{@const matched = board.matched.includes(id)}{@const selected = session.selection?.side === side && session.selection.wordId === id}{@const word = wordMap.get(id)}{@const target = session.wordLanguages[id]}<button class:matched class:selected class="word-tile" disabled={busy || paused || matched || boardDone} aria-pressed={selected} aria-label={`${text(id, side)}${side === 'right' && session.settings.language === 'mvt' ? `, ${LANGUAGES[target]}` : ''}${context(word)}${matched ? ', verbonden' : selected ? ', geselecteerd' : ''}`} onclick={() => act({ type: 'select', side, wordId: id })}><span lang={side === 'left' ? 'nl' : target}>{text(id, side)}</span>{#if side === 'right' && session.settings.language === 'mvt'}<small>{LANGUAGES[target]}</small>{/if}{#if word?.context}<small>{word.context}</small>{/if}{#if matched}<span class="tile-check" aria-hidden="true">✓</span>{/if}</button>{/each}</div>{/each}</div>
          <div class="feedback-area"><p class="feedback" aria-live="polite" aria-atomic="true">{announcement || (boardDone ? 'Mooi gedaan! Alle woorden zijn verbonden.' : 'Je mag op je eigen tempo oefenen.')}</p>{#if boardDone}<button class="button primary wide" disabled={busy || paused} onclick={() => act({ type: 'next-board' })}>Verder <span aria-hidden="true">→</span></button>{:else}<button class="button help-button" disabled={busy || paused || !session.selection} onclick={() => act({ type: 'hint' })}><span aria-hidden="true">✦</span> Geef me een hint</button><p class="muted small">{session.selection ? 'Een hint helpt je de vertaling te vinden.' : 'Kies eerst een woord voor een hint.'}</p>{/if}</div>
        </section>
      {:else if session.phase === 'recall' && recallWord}
        {@const target = session.wordLanguages[recallWord.id]}
        <section class="play-card recall-card"><p class="eyebrow">NOG EVEN ZELF BEDENKEN</p><h1 tabindex="-1" bind:this={heading}>Weet jij de vertaling?</h1><p class="lead">Denk aan het woord of zeg het hardop. Kijk daarna of je het wist.</p><div class="recall-prompt"><span class="eyebrow">NEDERLANDS → {LANGUAGES[target].toUpperCase()}</span><strong lang="nl">{recallWord.forms.nl}</strong>{#if recallWord.context}<small>{recallWord.context}</small>{/if}</div>{#if revealed}<div class="reveal-answer"><span class="eyebrow">{LANGUAGES[target].toUpperCase()}</span><strong lang={target}>{recallWord.forms[target]}</strong>{#if recallWord.alternatives?.[target]?.length}<small>Ook goed: {recallWord.alternatives[target]?.join(', ')}</small>{/if}</div><p class="self-report">Had je het zelf bedacht? Jij mag kiezen.</p><div class="answer-actions"><button class="button secondary" disabled={busy || paused} onclick={() => act({ type: 'recall', known: false })}>Nog eens oefenen</button><button class="button primary" disabled={busy || paused} onclick={() => act({ type: 'recall', known: true })}>Ik wist het <span aria-hidden="true">✓</span></button></div>{:else}<button class="button primary wide" disabled={busy || paused} onclick={() => { revealed = true; }}>Laat de vertaling zien <span aria-hidden="true">→</span></button>{/if}<button class="text-button" disabled={busy || paused} onclick={() => act({ type: 'skip-recall' })}>Terugvragen overslaan</button><p class="muted small">Dit is wat je zelf aangeeft, geen toets.</p></section>
      {:else if session.phase === 'results' && session.words.length > 0}
        <section class="play-card results-card"><div class="result-flower" aria-hidden="true">✳</div><p class="eyebrow">RONDE AFGEROND</p><h1 tabindex="-1" bind:this={heading}>Goed geoefend!</h1><p class="lead">Elk woord dat je tegenkomt, helpt je een stapje verder.</p><div class="result-stats"><div><strong>{session.completedPairs}</strong><span>verbonden paren</span></div><div><strong>{session.mistakes}</strong><span>keer opnieuw geprobeerd</span></div><div><strong>{session.hints}</strong><span>hints gebruikt</span></div></div><p class="muted small">Je voortgang is bewaard op dit apparaat. Zelf aangegeven antwoorden zijn geen toetsresultaat.</p><button class="button primary wide" disabled={busy || paused} onclick={anotherRound}>Nog een ronde <span aria-hidden="true">→</span></button><a class="button secondary wide" href={resolve('/')}>Terug naar start</a></section>
      {:else}<section class="play-card"><h1>Geen woorden om te oefenen</h1><p>Kies een ander hoofdstuk of vraag een ouder om woorden toe te voegen.</p><a class="button secondary" href={resolve('/')}>Terug naar start</a></section>{/if}
    {/if}
  </main>
</div>

<style>
  @media (max-width: 620px) {
    .site-header { height: 56px; }
    .play-main { padding-top: 14px; }
    .play-topline { margin-bottom: 14px; }
    .board-heading h1 { font-size: 1.65rem; margin-bottom: 8px; }
    .board-heading .eyebrow { margin-bottom: 8px; }
    .board-heading .lead { font-size: .9rem; line-height: 1.4; margin-bottom: 14px; }
    .round-number { width: 40px; height: 40px; }
    .board-grid { gap: 10px; }
    .tile-column { gap: 8px; }
    .word-tile { min-height: 56px; padding: 8px 22px 8px 10px; }
    .word-tile small { font-size: .72rem; }
    .feedback-area { margin-top: 14px; }
    .feedback { margin-bottom: 8px; }
  }
</style>
