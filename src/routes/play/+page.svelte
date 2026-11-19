<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { resolve } from '$app/paths';
  import { LANGUAGES, PRACTICE_MODES, createSession, transition } from '#lib/learning/index.ts';
  import type { Action } from '#lib/learning/index.ts';
  import { acquirePlayLock, loadSnapshot, saveSession } from '#lib/storage/index.ts';
  import type { Exposure, Session, Snapshot, Word } from '#lib/model.ts';
  import { BoardTiming } from '#lib/play/timing.ts';

  let snapshot = $state<Snapshot | null>(null);
  let session = $state<Session | null>(null);
  let busy = $state(true);
  let error = $state('');
  let paused = $state(false);
  let migrationNotice = $state<string | null>(null);
  let announcement = $state('');
  let heading = $state<HTMLElement>();
  let release: (() => void) | undefined;
  let disposed = false;
  let interruptions = 0;
  const timing = new BoardTiming();
  type PendingWrite = { session: Session; exposures: Exposure[]; resetTiming: boolean; interruption: number };
  let pendingWrite = $state<PendingWrite | null>(null);
  let board = $derived(session?.boards[session.boardIndex]);
  let boardDone = $derived(!!board && board.left.every((id) => board.matched.includes(id)));
  let blocked = $derived(busy || paused || !!pendingWrite);
  let wordMap = $derived(new Map((session?.words ?? []).map((word) => [word.id, word])));
  function releaseLock() { release?.(); release = undefined; }

  function message(reason: unknown) { return reason instanceof Error ? reason.message : 'Er ging iets mis bij het bewaren.'; }
  function text(id: string, side: 'left' | 'right') {
    const word = wordMap.get(id);
    return word?.forms[side === 'left' ? 'nl' : session!.wordLanguages[id]] ?? '';
  }
  function context(word: Word | undefined) { return word?.context ? ` · ${word.context}` : ''; }
  async function focusHeading() { await tick(); heading?.focus(); }
  function foreground() { return !document.hidden && document.hasFocus(); }
  function resumeTiming() {
    if (!disposed && !busy && !paused && !pendingWrite && session?.phase === 'match' && !boardDone) timing.resume();
  }
  async function finishInteraction(newBoardInterruption: number | null = null) {
    if (disposed) { releaseLock(); return; }
    busy = false;
    // Do not include saving, feedback rendering or the board transition in active time.
    await tick();
    if (newBoardInterruption !== null) timing.start(foreground() && interruptions === newBoardInterruption);
    resumeTiming();
  }
  async function persistPending(): Promise<number | null> {
    if (!pendingWrite) return null;
    const pending = $state.snapshot(pendingWrite);
    const before = session;
    const saved = await saveSession({ ...pending.session, selection: null }, pending.exposures);
    if (disposed) return null;
    snapshot = saved;
    // Selection is transient; resolved attempts and anchor history are saved atomically.
    session = saved.session ? { ...saved.session, selection: pending.session.selection } : pending.session;
    pendingWrite = null;
    announcement = session.feedback;
    if (!before || session.phase !== before.phase || session.boardIndex !== before.boardIndex) await focusHeading();
    return pending.resetTiming ? pending.interruption : null;
  }
  async function start() {
    let newBoardInterruption: number | null = null;
    try {
      const unlock = await acquirePlayLock();
      if (disposed) { unlock(); return; }
      release = unlock;
      const data = await loadSnapshot();
      if (disposed) return;
      snapshot = data;
      // A new save clears this storage notice; retain its explanation on this page.
      migrationNotice = data.notice;
      if (data.session && (data.session.phase !== 'results' || data.notice !== null)) {
        session = { ...data.session, selection: null };
        timing.start(false);
      } else {
        const fresh = createSession(data.words, data.progress, data.settings, data.exposures);
        pendingWrite = { session: fresh, exposures: [], resetTiming: true, interruption: interruptions };
        newBoardInterruption = await persistPending();
      }
      if (typeof navigator.storage?.persist === 'function') void navigator.storage.persist().catch(() => {});
    } catch (reason) {
      timing.invalidate();
      if (!disposed) error = message(reason);
    } finally { await finishInteraction(newBoardInterruption); }
  }
  onMount(() => {
    paused = !foreground();
    const interrupt = () => { interruptions++; timing.invalidate(); paused = true; };
    const visibility = () => { if (document.hidden) interrupt(); else { paused = !foreground(); resumeTiming(); } };
    const focus = () => { paused = !foreground(); resumeTiming(); };
    const restorePage = (event: PageTransitionEvent) => {
      if (event.persisted) { interrupt(); paused = !foreground(); }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', interrupt);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('pageshow', restorePage);
    void start();
    return () => {
      disposed = true;
      timing.invalidate();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('pageshow', restorePage);
      if (!busy) releaseLock();
    };
  });
  async function act(action: Action) {
    if (!session || blocked) return;
    const before = session;
    // Read the click's time before pausing for transition/render/storage work.
    if (action.type === 'select') {
      if (before.selection && before.selection.side !== action.side) action = { ...action, timing: timing.evidence(before.selection.wordId) };
      else if (!before.selection || before.selection.wordId !== action.wordId) timing.select(action.wordId);
    } else if (action.type === 'hint' && before.selection) action = { ...action, timing: timing.evidence(before.selection.wordId) };
    timing.pause();
    busy = true;
    error = '';
    let newBoardInterruption: number | null = null;
    try {
      const result = transition($state.snapshot(before), action);
      if (result.session.version === before.version && result.exposures.length === 0) {
        session = result.session;
        announcement = session.feedback;
      } else {
        pendingWrite = {
          session: result.session,
          exposures: result.exposures,
          resetTiming: result.session.phase === 'match' && (before.phase !== 'match' || result.session.boardIndex !== before.boardIndex),
          interruption: interruptions
        };
        newBoardInterruption = await persistPending();
      }
    } catch (reason) {
      timing.invalidate();
      error = `Niet opgeslagen. Bewaar je antwoord opnieuw om verder te gaan. ${message(reason)}`;
    } finally { await finishInteraction(newBoardInterruption); }
  }
  async function retrySave() {
    if (!pendingWrite || busy || paused) return;
    busy = true; error = '';
    let newBoardInterruption: number | null = null;
    try { newBoardInterruption = await persistPending(); }
    catch (reason) { timing.invalidate(); error = `Niet opgeslagen. ${message(reason)}`; }
    finally { await finishInteraction(newBoardInterruption); }
  }
  async function anotherRound() {
    if (!snapshot || blocked) return;
    timing.pause();
    busy = true; error = '';
    let newBoardInterruption: number | null = null;
    try {
      const data = $state.snapshot(snapshot);
      const fresh = createSession(data.words, data.progress, data.settings, data.exposures);
      pendingWrite = { session: fresh, exposures: [], resetTiming: true, interruption: interruptions };
      newBoardInterruption = await persistPending();
    } catch (reason) {
      timing.invalidate();
      error = `De nieuwe ronde is niet gestart. ${message(reason)}`;
    } finally { await finishInteraction(newBoardInterruption); }
  }
</script>
<svelte:head><title>Oefenen — Woordentuin</title></svelte:head>
<div class="shell play-shell">
  <header class="site-header"><a class="brand" href={resolve('/')} aria-disabled={!!pendingWrite} onclick={(event) => { if (pendingWrite) event.preventDefault(); }} aria-label="Woordentuin, naar start"><span class="brand-mark" aria-hidden="true">✳</span><span>woordentuin</span></a><a class="quiet-link" href={resolve('/')} aria-disabled={!!pendingWrite} onclick={(event) => { if (pendingWrite) event.preventDefault(); }}>Bewaar & sluit <span aria-hidden="true">×</span></a></header>
  <main class="play-main">
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    {#if migrationNotice}<div class="notice" role="status">{migrationNotice}</div>{/if}
    {#if pendingWrite && !busy}<div class="notice" role="status"><p>Je antwoord staat klaar om te bewaren. Bewaar het opnieuw voordat je verder oefent.</p><button class="button secondary" disabled={paused} onclick={retrySave}>Opnieuw bewaren</button></div>{/if}
    {#if paused}<div class="notice" role="status">Even gepauzeerd. Ga verder wanneer je terug bent.</div>{/if}
    {#if busy && !session}<p class="loading" role="status">Je ronde wordt klaargezet…</p>
    {:else if !session}<section class="play-card"><h1>Je ronde kon niet worden geopend.</h1><p>Je gegevens blijven op dit apparaat staan.</p><a class="button secondary" href={resolve('/')}>Terug naar start</a></section>
    {:else}
      <div class="play-topline"><span class="eyebrow">{PRACTICE_MODES[session.settings.language]} {session.settings.chapter !== 'all' ? ` / ${session.settings.chapter}` : ''}</span><span class="play-status">{session.phase === 'intro' ? 'ONTDEKKEN' : session.phase === 'match' ? `VERBINDEN · ${session.boardIndex + 1} / ${session.boards.length}` : 'AFGEROND'}</span></div>
      {#if session.phase === 'intro'}
        <section class="play-card intro-card"><p class="eyebrow">EERST EVEN KIJKEN</p><h1 tabindex="-1" bind:this={heading}>Dit zijn je nieuwe woorden.</h1><p class="lead">Neem rustig de tijd. Straks mag je ze met elkaar verbinden.</p><div class="intro-words">{#each session.newWordIds as id}{@const word = wordMap.get(id)}{@const target = session.wordLanguages[id]}{#if word}<div class="intro-word"><span lang="nl">{word.forms.nl}</span><span class="word-arrow" aria-hidden="true">→</span><strong lang={target}>{word.forms[target]}</strong>{#if session.settings.language === 'mvt'}<small>{LANGUAGES[target]}</small>{/if}{#if word.context}<small>{word.context}</small>{/if}</div>{/if}{/each}</div><button class="button primary wide" disabled={blocked} onclick={() => act({ type: 'begin' })}>Ik ben er klaar voor <span aria-hidden="true">→</span></button></section>
      {:else if session.phase === 'match' && board}
        <section class="board-section"><div class="board-heading"><div><p class="eyebrow">MAAK DE GOEDE COMBINATIES</p><h1 tabindex="-1" bind:this={heading}>{session.settings.language === 'fr-3vwo' ? 'Welke vertalingen horen bij elkaar?' : 'Welke woorden horen bij elkaar?'}</h1><p class="lead">Kies een kaart en daarna de vertaling.</p></div><div class="round-number" aria-hidden="true">{String(session.boardIndex + 1).padStart(2, '0')}</div></div>
          <div class="board-labels"><span>NEDERLANDS</span><span>{session.settings.language === 'mvt' ? 'VERTALINGEN' : LANGUAGES[session.settings.language === 'fr-3vwo' ? 'fr' : session.settings.language].toUpperCase()}</span></div>
          <div class="board-grid">{#each ['left', 'right'] as sideValue}{@const side = sideValue as 'left' | 'right'}<div class="tile-column">{#each board[side] as id (id)}{@const matched = board.matched.includes(id)}{@const selected = session.selection?.side === side && session.selection.wordId === id}{@const word = wordMap.get(id)}{@const target = session.wordLanguages[id]}<button class:matched class:selected class="word-tile" disabled={blocked || matched || boardDone} aria-pressed={selected} aria-label={`${text(id, side)}${side === 'right' && session.settings.language === 'mvt' ? `, ${LANGUAGES[target]}` : ''}${context(word)}${matched ? ', verbonden' : selected ? ', geselecteerd' : ''}`} onclick={() => act({ type: 'select', side, wordId: id })}><span lang={side === 'left' ? 'nl' : target}>{text(id, side)}</span>{#if side === 'right' && session.settings.language === 'mvt'}<small>{LANGUAGES[target]}</small>{/if}{#if word?.context}<small>{word.context}</small>{/if}{#if matched}<span class="tile-check" aria-hidden="true">✓</span>{/if}</button>{/each}</div>{/each}</div>
          <div class="feedback-area"><p class="feedback" aria-live="polite" aria-atomic="true">{announcement || (boardDone ? 'Mooi gedaan! Alle woorden zijn verbonden.' : 'Je mag op je eigen tempo oefenen.')}</p>{#if boardDone}<button class="button primary wide" disabled={blocked} onclick={() => act({ type: 'next-board' })}>Verder <span aria-hidden="true">→</span></button>{:else}<button class="button help-button" disabled={blocked || !session.selection} onclick={() => act({ type: 'hint' })}><span aria-hidden="true">✦</span> Geef me een hint</button><p class="muted small">{session.selection ? 'Een hint helpt je de vertaling te vinden.' : 'Kies eerst een woord voor een hint.'}</p>{/if}</div>
        </section>
      {:else if session.phase === 'results' && session.words.length > 0}
        <section class="play-card results-card"><p class="eyebrow">RONDE AFGEROND</p><h1 tabindex="-1" bind:this={heading}>Goed geoefend!</h1><p class="lead">Je voortgang is bewaard op dit apparaat.</p><button class="button primary wide" disabled={blocked} onclick={anotherRound}>Nog een ronde <span aria-hidden="true">→</span></button><a class="button secondary wide" href={resolve('/')}>Stoppen</a></section>
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
