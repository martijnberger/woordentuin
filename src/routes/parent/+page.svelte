<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Language, PracticeLanguage, Snapshot, TargetLanguage, Word } from '#lib/model.ts';
  import { LANGUAGES, PRACTICE_MODES, buildPracticeStats, inPracticeSet, practiceChapters, progressKey } from '#lib/learning/index.ts';
  import type { PairStats } from '#lib/learning/index.ts';
  import { MVT_WORD_IDS } from '#lib/content/words.ts';
  import { exportBackup, importBackup, loadSnapshot, resetProgress, saveSettings, saveWords } from '#lib/storage/index.ts';

  let snapshot: Snapshot | null = null;
  let error = '';
  let notice = '';
  let busy = false;
  let language: PracticeLanguage = 'mvt';
  let addLanguage: TargetLanguage = 'de';
  let chapter = 'all';
  let editId: string | null = null;
  let draft: Word | null = null;
  let newDutch = '';
  let newTarget = '';
  let newChapter = '';
  let pasted = '';
  let backupFile: HTMLInputElement;
  const languageKeys: TargetLanguage[] = ['de', 'fr', 'es', 'en'];
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
  const compare = (value: string) => normalize(value).toLocaleLowerCase();
  const makeId = () => crypto.randomUUID();
  $: chapters = snapshot ? practiceChapters(snapshot.words, language) : [];
  $: visible = snapshot ? snapshot.words.filter((word) => (chapter === 'all' || word.chapter === chapter) && inPracticeSet(word, language)) : [];
  $: practiceStats = snapshot ? buildPracticeStats(snapshot.words, snapshot.progress, snapshot.exposures, { ...snapshot.settings, language, chapter }) : [];
  $: weakWords = practiceStats.filter((item) => item.label === 'Extra oefenen' || (item.dueAt !== null && item.dueAt <= Date.now()));
  $: pairLanguage = language === 'mvt' ? addLanguage : language === 'fr-3vwo' ? 'fr' : language;
  $: preview = makePreview(pasted, snapshot?.words.filter((word) => inPracticeSet(word, pairLanguage)) ?? [], pairLanguage);

  function makePreview(input: string, words: Word[], target: TargetLanguage) {
    const rows = input.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim()).map(({ line, number }) => {
      const columns = line.split('\t');
      const nl = normalize(columns[0] ?? '');
      const translation = normalize(columns[1] ?? '');
      const issues: string[] = [];
      if (columns.length !== 2 || !nl || !translation) issues.push('Gebruik twee gevulde kolommen, gescheiden door een tab.');
      return { line: number, nl, translation, issues };
    });
    for (const row of rows) {
      if (!row.nl || !row.translation) continue;
      const candidates = [
        ...words.map((word) => ({ nl: word.forms.nl ?? '', translation: word.forms[target] ?? '', nlAlternatives: word.alternatives?.nl ?? [], targetAlternatives: word.alternatives?.[target] ?? [] })),
        ...rows.filter((other) => other !== row).map((other) => ({ ...other, nlAlternatives: [] as string[], targetAlternatives: [] as string[] }))
      ];
      if (candidates.some((other) => compare(other.nl) === compare(row.nl) && compare(other.translation) === compare(row.translation))) row.issues.push('Dit woordenpaar bestaat al.');
      else if (candidates.some((other) => {
        if (!other.nl || !other.translation) return false;
        const matches = (value: string, form: string, alternatives: string[]) => [form, ...alternatives, ...form.split(/,|\//)].some((part) => compare(part) === compare(value));
        return matches(row.nl, other.nl, other.nlAlternatives) || matches(row.translation, other.translation, other.targetAlternatives);
      })) row.issues.push('Dubbelzinnige vertaling; controleer dit paar.');
    }
    return rows;
  }
  async function perform(work: () => Promise<void>) {
    busy = true; error = ''; notice = '';
    try { await work(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Er ging iets mis. Probeer het opnieuw.'; }
    finally { busy = false; }
  }
  onMount(() => { void perform(async () => { snapshot = await loadSnapshot(); language = snapshot.settings.language; chapter = snapshot.settings.chapter; }); });
  async function updateSettings(nextLanguage: PracticeLanguage, nextChapter: string) {
    if (!snapshot) return;
    const previous = snapshot.settings;
    if (nextLanguage !== language && !practiceChapters(snapshot.words, nextLanguage).includes(nextChapter)) nextChapter = 'all';
    language = nextLanguage;
    chapter = nextChapter;
    await perform(async () => { try { await saveSettings({ ...previous, language, chapter }); snapshot = await loadSnapshot(); notice = 'Keuze opgeslagen op dit apparaat.'; } catch (cause) { language = previous.language; chapter = previous.chapter; throw cause; } });
  }
  function edit(word: Word) { editId = word.id; draft = structuredClone(word); }
  async function commitDraft() {
    if (!snapshot || !draft) return;
    const word = structuredClone(draft);
    word.chapter = normalize(word.chapter);
    const old = snapshot.words.find((item) => item.id === word.id)!;
    for (const key of Object.keys(word.forms) as Language[]) {
      const value = normalize(word.forms[key] ?? '');
      if (value) word.forms[key] = value; else delete word.forms[key];
      if (value !== (old.forms[key] ?? '')) {
        if (!word.alternatives) word.alternatives = {};
        const parts = value.split(/,\s*|\//).map(normalize).filter(Boolean);
        if (parts.length > 1) word.alternatives[key] = [...new Set(parts)];
        else delete word.alternatives[key];
      }
    }
    await perform(async () => { snapshot = await saveWords(snapshot!.words.map((item) => item.id === word.id ? word : item)); editId = null; draft = null; notice = 'Woord opgeslagen.'; });
  }
  async function toggle(word: Word, field: 'enabled' | 'reviewed') {
    if (!snapshot) return;
    await perform(async () => { snapshot = await saveWords(snapshot!.words.map((item) => item.id === word.id ? { ...item, [field]: !item[field] } : item)); notice = 'Wijziging opgeslagen.'; });
  }
  async function addPairs(pairs: { nl: string; translation: string }[]) {
    if (!snapshot) return;
    const targetChapter = normalize(newChapter || (chapter === 'all' ? '' : chapter));
    if (!targetChapter) { error = 'Vul eerst een hoofdstuk in.'; return; }
    const rows = pairs.map((pair) => `${pair.nl}\t${pair.translation}`).join('\n');
    const result = makePreview(rows, snapshot.words.filter((word) => inPracticeSet(word, pairLanguage)), pairLanguage);
    if (!result.length || result.some((row) => row.issues.length)) { error = result.flatMap((row) => row.issues).join(' ') || 'Vul beide woorden in.'; return; }
    const added: Word[] = result.map((row) => ({ id: makeId(), chapter: targetChapter, partOfSpeech: 'other', forms: { nl: row.nl, [pairLanguage]: row.translation }, revision: 1, reviewed: false, enabled: true }));
    await perform(async () => { snapshot = await saveWords([...snapshot!.words, ...added]); newDutch = ''; newTarget = ''; pasted = ''; notice = `${added.length} ${added.length === 1 ? 'woordenpaar' : 'woordenparen'} toegevoegd. Controleer en markeer als nagekeken voordat je ermee speelt.`; });
  }
  async function download() {
    await perform(async () => { const json = await exportBackup(); const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'woordentuin-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notice = 'Reservekopie gedownload.'; });
  }
  async function restore(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm('Deze reservekopie vervangt alle woorden, voortgang en de huidige sessie op dit apparaat. Doorgaan?')) { input.value = ''; return; }
    await perform(async () => { snapshot = await importBackup(await file.text()); language = snapshot.settings.language; chapter = snapshot.settings.chapter; editId = null; draft = null; notice = 'Reservekopie teruggezet.'; });
    input.value = '';
  }
  async function reset() {
    if (!confirm('Alle oefenvoortgang en de huidige sessie op dit apparaat wissen? Je woorden blijven bewaard.')) return;
    await perform(async () => { snapshot = await resetProgress(); notice = 'De voortgang is gewist.'; });
  }
  function status(word: Word, target: TargetLanguage): string {
    return practiceStats.find((item) => item.word.id === word.id && item.language === target)?.label ?? 'Nog weinig geoefend';
  }
  function date(at: number | null): string {
    return at === null ? 'Nog niet bekend' : new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(at);
  }
  function average(value: number | null): string {
    return value === null ? '—' : value.toLocaleString('nl-NL', { maximumFractionDigits: 1 });
  }
  function accuracy(item: PairStats): string {
    return item.qualifyingCount === 0 ? 'Nog geen betekenisvolle eerste pogingen' : `${Math.round(item.firstTryCorrect / item.qualifyingCount * 100)}% (${item.firstTryCorrect}/${item.qualifyingCount})`;
  }
  function speed(value: PairStats['speed']): string {
    return { fast: 'Vlot ten opzichte van eigen vergelijkbare pogingen', hesitant: 'Meer bedenktijd dan bij eigen vergelijkbare pogingen', typical: 'Vergelijkbaar met eigen pogingen', unknown: 'Nog onvoldoende vergelijkbare tijdmetingen' }[value];
  }
</script>

<svelte:head><title>Voor ouders · Woordentuin</title><meta name="description" content="Beheer woorden en bekijk de voortgang op dit apparaat." /></svelte:head>
<div class="parent-page">
  <header class="top"><a class="back" href={resolve('/')}>← Terug naar de tuin</a><span>Woordentuin · voor ouders</span></header>
  <main>
    <div class="intro"><p class="eyebrow">Een kijkje achter de schermen</p><h1>De woorden groeien mee.</h1><p>Beheer de woorden en bekijk wat extra aandacht kan gebruiken. Alles blijft op dit apparaat; een andere browser of installatie heeft eigen gegevens.</p></div>
    {#if error}<div class="message error" role="alert">{error}</div>{/if}
    {#if notice}<div class="message" role="status">{notice}</div>{/if}
    {#if snapshot}
      <section class="panel filters" aria-labelledby="filter-title">
        <div><p class="eyebrow">Samen kiezen</p><h2 id="filter-title">Taal en hoofdstuk</h2><p>Deze keuze geldt ook voor het spelen.</p></div>
        <div class="filter-fields">
          <label>Taal<select value={language} on:change={(event) => updateSettings(event.currentTarget.value as PracticeLanguage, chapter)} disabled={busy}>{#each Object.entries(PRACTICE_MODES) as [key, label]}<option value={key}>{label}</option>{/each}</select></label>
          <label>{language === 'fr-3vwo' ? 'Onderdeel' : 'Hoofdstuk'}<select value={chapter} on:change={(event) => updateSettings(language, event.currentTarget.value)} disabled={busy}><option value="all">{language === 'fr-3vwo' ? 'Alle onderdelen' : 'Alle hoofdstukken'}</option>{#each chapters as item}<option value={item}>{item}</option>{/each}</select></label>
        </div>
      </section>
      <section class="panel" aria-labelledby="attention-title"><div class="heading"><div><p class="eyebrow">Oefenen helpt</p><h2 id="attention-title">Woorden om nog eens te bekijken</h2></div><span class="count">{weakWords.length}</span></div><p>Herkenning: recente fouten of hulp, of een geplande herhaling. Dit is geen cijfer.</p>{#if weakWords.length}<ul class="weak-list">{#each weakWords as item}<li><strong lang="nl">{item.word.forms.nl}</strong><span lang={item.language}>{item.word.forms[item.language]}</span><small>{LANGUAGES[item.language]} · {item.label} · recent {item.mistakes} fout · {item.hints}× hulp · {item.reason}</small></li>{/each}</ul>{:else}<p class="empty">Nog geen woorden die extra aandacht vragen voor deze keuze.</p>{/if}</section>
      <section class="panel" aria-labelledby="stats-title">
        <h2 id="stats-title">Herkenning tijdens het verbinden</h2>
        <p>Dit overzicht meet herkenning, niet zelfstandig vertalen of spellen. Alle voortgang blijft op dit apparaat. MVT toont alleen Frans, Duits en Spaans; Engels blijft apart beschikbaar.</p>
        <details>
          <summary>Oefenoverzicht bekijken ({practiceStats.length} woordenparen)</summary>
          <p>Per woordenpaar tellen maximaal de laatste tien bordbeurten mee. Eerste-pogingpercentages gebruiken alleen betekenisvolle pogingen: een eerste keuze uit minstens drie opties, of een fout of hint. Een verbetering op hetzelfde bord is geen nieuw onafhankelijk meetpunt. Oudere gegevens zonder bordcontext krijgen geen verzonnen tijd of volgorde.</p>
          {#if practiceStats.length}
              <table class="stats-table">
                <caption>Huidige taal- en hoofdstukkeuze · recente bordbeurten</caption>
                <thead><tr><th scope="col">Woordenpaar</th><th scope="col">Eerste poging goed</th><th scope="col">Bordbeurten</th><th scope="col">Recent fout / hint</th><th scope="col">Schone antwoordtijd</th><th scope="col">Gemiddelde volgorde</th><th scope="col">Oefenadvies</th><th scope="col">Laatste / volgende oefening</th></tr></thead>
                <tbody>{#each practiceStats as item}
                  <tr>
                    <th scope="row"><span lang="nl">{item.word.forms.nl}</span><br /><span lang={item.language}>{item.word.forms[item.language]}</span><br /><small>{LANGUAGES[item.language]}</small></th>
                    <td data-label="Eerste poging goed">{accuracy(item)}<br /><small>{item.qualifyingCount} betekenisvolle bordbeurten</small></td>
                    <td data-label="Bordbeurten">{item.sampleCount} / maximaal 10</td>
                    <td data-label="Recent fout / hint">{item.mistakes} fout / {item.hints}× hint</td>
                    <td data-label="Schone antwoordtijd">{item.responseMs === null ? 'Onbekend' : `${average(item.responseMs / 1000)} s`}<br /><small>{speed(item.speed)}</small></td>
                    <td data-label="Gemiddelde volgorde">Gekozen: {average(item.averageSelectionOrder)}<br />Verbonden: {average(item.averageMatchOrder)}<br /><small>Bordgrootte: {average(item.averageBoardSize)} paren</small></td>
                    <td data-label="Oefenadvies"><strong>{item.label}</strong><br />{item.reason}</td>
                    <td data-label="Laatste / volgende oefening">Laatst: {date(item.lastPracticedAt)}<br />Volgende: {date(item.dueAt)}</td>
                  </tr>
                {/each}</tbody>
              </table>
          {:else}<p class="empty">Geen oefenbare woordenparen voor deze keuze.</p>{/if}
        </details>
      </section>
      {#if language === 'mvt'}
        <section class="panel" aria-labelledby="book-title"><p class="eyebrow">Boekoverzicht</p><h2 id="book-title">Alle MVT-boekwoorden</h2><p>De overgenomen boekvormen zijn niet automatisch taalkundig gecontroleerd. Bij enkele afgesneden Nederlandse woorden is de betekenis aangevuld; bijzonderheden staan in de notities. Een streepje betekent dat de vorm ontbreekt.</p>
          <table class="book-table"><thead><tr><th scope="col">Nederlands</th><th scope="col">Engels</th><th scope="col">Frans</th><th scope="col">Duits</th><th scope="col">Spaans</th><th scope="col">Notitie</th></tr></thead><tbody>{#each snapshot.words.filter((word) => MVT_WORD_IDS.has(word.id)) as word (word.id)}<tr><th scope="row" data-label="Nederlands" lang="nl">{word.forms.nl || '—'}</th>{#each ['en', 'fr', 'de', 'es'] as code}{@const key = code as TargetLanguage}<td data-label={LANGUAGES[key]} lang={key}>{word.forms[key] || '—'}</td>{/each}<td data-label="Notitie">{word.note || '—'}</td></tr>{/each}</tbody></table>
        </section>
      {/if}
      <section class="panel" aria-labelledby="words-title"><div class="heading"><div><p class="eyebrow">De woordenlijst</p><h2 id="words-title">{language === 'mvt' ? 'MVT-woorden beheren' : 'Woorden beheren'}</h2></div><span class="count">{visible.length}</span></div><p>{language === 'mvt' ? 'Alleen actieve, voor oefenen vrijgegeven woorden komen in een spel. Vrijgegeven betekent niet taalkundig gecontroleerd.' : 'Alleen actieve én nagekeken woorden komen in een spel. Nieuwe woorden moet je zelf nakijken.'}</p>{#if language === 'mvt'}<p>Nederlands is de basis. Kies alle hoofdstukken om alle boekwoorden te beheren.</p>{/if}
        {#each visible as word (word.id)}<article class="word-row">
          {#if editId === word.id && draft}<div class="edit-form"><label>Hoofdstuk<input bind:value={draft.chapter} /></label><label>Nederlands<input bind:value={draft.forms.nl} /></label>{#each languageKeys as key}<label>{LANGUAGES[key]}<input value={draft.forms[key] ?? ''} on:input={(event) => { if (draft) draft.forms[key] = event.currentTarget.value; }} /></label>{/each}<label>Woordsoort<select bind:value={draft.partOfSpeech}><option value="other">Overig</option><option value="noun">Zelfstandig naamwoord</option><option value="verb">Werkwoord</option><option value="adjective">Bijvoeglijk naamwoord</option></select></label><label>Context<input bind:value={draft.context} /></label><label>Notitie<input bind:value={draft.note} /></label><div class="actions"><button class="primary" on:click={commitDraft} disabled={busy}>Bewaren</button><button on:click={() => { editId = null; draft = null; }}>Annuleren</button></div></div>
          {:else}<div class="word-main"><div><strong lang="nl">{word.forms.nl || 'Nederlands ontbreekt'}</strong>{#if language === 'mvt'}<dl class="book-forms">{#each languageKeys as key}<div><dt>{LANGUAGES[key]}</dt><dd lang={key}>{word.forms[key] || '—'}</dd></div>{/each}</dl>{#if word.note}<p class="book-note">{word.note}</p>{/if}{:else}<span class="translation" lang={pairLanguage}>{word.forms[pairLanguage] || 'Vertaling ontbreekt'}</span>{/if}<small>{word.chapter}{#if language !== 'mvt'} · {status(word, pairLanguage)}{/if}</small></div><div class="word-actions"><button on:click={() => edit(word)} disabled={busy}>Bewerken</button><button aria-pressed={word.enabled} on:click={() => toggle(word, 'enabled')} disabled={busy}>{word.enabled ? 'Actief' : 'Inactief'}</button><button aria-pressed={word.reviewed} on:click={() => toggle(word, 'reviewed')} disabled={busy}>{language === 'mvt' ? (word.reviewed ? 'Vrijgegeven voor oefenen' : 'Niet vrijgegeven') : (word.reviewed ? 'Nagekeken' : 'Nog nakijken')}</button></div></div>{/if}
          {#each language === 'mvt' ? languageKeys.filter((key) => key !== 'en' && !!word.forms[key]) : [pairLanguage] as target}{#if snapshot.progress[progressKey(word.id, target, 'recall')]}<p class="recall">{language === 'mvt' ? `${LANGUAGES[target]} · ` : ''}Historisch archief, zelf gemeld (geen toets): {snapshot.progress[progressKey(word.id, target, 'recall')].successes}× geweten · {snapshot.progress[progressKey(word.id, target, 'recall')].mistakes}× nog oefenen. Er worden geen nieuwe zelfbeoordelingen gevraagd.</p>{/if}{/each}
        </article>{:else}<p class="empty">Geen woorden voor deze taal en dit hoofdstuk.</p>{/each}
      </section>
      {#if language !== 'fr-3vwo'}
      <section class="panel" aria-labelledby="add-title"><p class="eyebrow">Een eigen lijst</p><h2 id="add-title">Woorden toevoegen</h2><p>Voeg een paar toe of plak twee kolommen uit een spreadsheet: Nederlands en daarna de vertaling, met een tab ertussen. Eigen woorden verschijnen in de afzonderlijke taal, niet in het MVT-boek.</p>{#if language === 'mvt'}<label>Doeltaal voor nieuwe woorden<select bind:value={addLanguage}>{#each languageKeys as key}<option value={key}>{LANGUAGES[key]}</option>{/each}</select></label>{/if}<label>Hoofdstuk voor nieuwe woorden<input bind:value={newChapter} placeholder={chapter === 'all' ? 'Bijvoorbeeld hoofdstuk 1' : chapter} /></label><div class="pair-fields"><label>Nederlands<input bind:value={newDutch} /></label><label>{LANGUAGES[pairLanguage]}<input bind:value={newTarget} /></label></div><button class="primary" disabled={busy} on:click={() => addPairs([{ nl: newDutch, translation: newTarget }])}>Woordenpaar toevoegen</button><div class="import"><label>Plak je lijst<textarea bind:value={pasted} rows="5" placeholder={'huis\tHaus\nboom\tBaum'}></textarea></label>{#if preview.length}<h3>Voorbeeld · {preview.length} regels</h3><ul class="preview">{#each preview as row}<li><strong>Regel {row.line}:</strong> {row.nl || 'ontbreekt'} → {row.translation || 'ontbreekt'}{#each row.issues as issue}<span class="issue">{issue}</span>{/each}</li>{/each}</ul><button class="primary" disabled={busy || preview.some((row) => row.issues.length > 0)} on:click={() => addPairs(preview)}>Lijst toevoegen</button>{/if}</div></section>
      {/if}
      <section class="panel backup" aria-labelledby="backup-title"><p class="eyebrow">Goed om te bewaren</p><h2 id="backup-title">Reservekopie &amp; voortgang</h2><p>Bewaar af en toe een reservekopie buiten deze browser. Terugzetten vervangt de gegevens op dit apparaat. Oefenvoortgang wissen laat je woorden staan.</p><div class="actions"><button on:click={download} disabled={busy}>Reservekopie downloaden</button><button on:click={() => backupFile.click()} disabled={busy}>Reservekopie terugzetten</button><input class="file" bind:this={backupFile} type="file" accept="application/json,.json" on:change={restore} /><button class="danger" on:click={reset} disabled={busy}>Voortgang wissen</button></div></section>
    {:else if !error}<p>Gegevens laden…</p>{/if}
  </main>
</div>

<style>
  summary{cursor:pointer;font-weight:700;color:#315b40;padding:1rem 0}summary:focus-visible{outline:3px solid #a18ad0;outline-offset:2px}.stats-table{width:100%;table-layout:fixed;overflow-wrap:anywhere;border-collapse:collapse;font-size:.85rem}.stats-table caption{text-align:left;padding:.75rem 0;color:#53675a}.stats-table th,.stats-table td{text-align:left;vertical-align:top;padding:.75rem .6rem;border-bottom:1px solid #dfe7d9}.stats-table small{color:#617269}
  @media(max-width:800px){.stats-table,.stats-table caption,.stats-table tbody,.stats-table tr,.stats-table th,.stats-table td{display:block}.stats-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.stats-table tr{padding:1rem 0;border-bottom:1px solid #dfe7d9}.stats-table th,.stats-table td{border:0;padding:.35rem 0}.stats-table td::before{content:attr(data-label);display:block;font-weight:700;color:#315b40}}
  .book-table{width:100%;border-collapse:collapse;table-layout:fixed;overflow-wrap:anywhere;font-size:.85rem}.book-table th,.book-table td{text-align:left;vertical-align:top;padding:.6rem .35rem;border-bottom:1px solid #e6ebe2}.book-table th:last-child{width:25%}.book-forms{display:flex;flex-wrap:wrap;gap:.4rem 1rem;margin:.5rem 0}.book-forms div{display:flex;gap:.3rem}.book-forms dt{font-size:.8rem;font-weight:700;color:#617269}.book-forms dd{margin:0}.book-note{font-size:.85rem;margin:.4rem 0}.word-main>div:first-child{min-width:0;overflow-wrap:anywhere}@media(max-width:700px){.book-table,.book-table tbody,.book-table tr,.book-table th,.book-table td{display:block}.book-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.book-table tr{padding:.75rem 0;border-bottom:1px solid #e6ebe2}.book-table th,.book-table td{display:grid;grid-template-columns:minmax(5.5rem,auto) 1fr;gap:.6rem;border:0;padding:.2rem 0}.book-table th::before,.book-table td::before{content:attr(data-label);font-weight:700;color:#617269}.book-table th:last-child{width:auto}}
  .parent-page{min-height:100vh;padding:1.25rem max(1.1rem,env(safe-area-inset-left)) 5rem;color:#253b30;background:#f7f4ea;font-family:system-ui,sans-serif}.top,main{max-width:960px;margin:auto}.top{display:flex;justify-content:space-between;gap:1rem;align-items:center;font-size:.82rem;color:#617269}.back{color:#315d43;font-weight:700}.intro{max-width:700px;padding:3.5rem 0 2rem}.eyebrow{font-size:.72rem!important;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#6b806a;margin:0 0 .65rem}h1,h2,h3{font-family:Georgia,serif;line-height:1.12;margin:0;color:#203d2f}h1{font-size:clamp(2.8rem,7vw,5rem);letter-spacing:-.04em}h2{font-size:clamp(1.6rem,3vw,2.2rem)}h3{font-size:1.25rem}p{line-height:1.55;color:#53675a}.panel{background:#fffefa;border:1px solid #dfe7d9;border-radius:24px;padding:clamp(1.25rem,3vw,2rem);margin-bottom:1rem;box-shadow:0 5px 20px #29433109}.filters{background:#e9f0e3;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.filter-fields,.pair-fields,.actions,.word-actions{display:flex;gap:.6rem;flex-wrap:wrap}.filter-fields label,.pair-fields label{flex:1;min-width:140px}.heading{display:flex;justify-content:space-between;align-items:center;gap:1rem}.count{background:#edf2e7;border-radius:50%;min-width:2.5rem;height:2.5rem;display:grid;place-items:center;font-weight:700}.weak-list,.preview{list-style:none;margin:1rem 0;padding:0}.weak-list li{display:grid;grid-template-columns:1fr 1fr;gap:.3rem;padding:.8rem 0;border-top:1px solid #e6ebe2}.weak-list small{grid-column:1/-1;color:#6b7d70}.empty{padding:1rem;background:#f5f7f0;border-radius:12px}.word-row{padding:1rem 0;border-top:1px solid #e6ebe2}.word-main{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.word-main strong,.translation,.word-main small{display:block}.word-main strong{font-size:1.1rem}.translation{margin:.2rem 0;color:#526b59}.word-main small{color:#738477}.recall{font-size:.85rem;color:#716585;margin:.75rem 0 0}.word-actions button[aria-pressed=true]{background:#e5f0df;color:#28553a;border-color:#bdd5bb}.edit-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.8rem}.edit-form .actions{grid-column:1/-1}label{display:block;font-weight:700;font-size:.85rem;color:#3c5645;margin:.4rem 0}input,select,textarea{box-sizing:border-box;display:block;width:100%;margin-top:.4rem;padding:.75rem;border:1px solid #b8c9b9;border-radius:10px;background:#fff;color:#243c2f;font:inherit;min-height:48px}textarea{resize:vertical}button{font:inherit;font-weight:700;min-height:44px;padding:.65rem 1rem;border:1px solid #c5d4c5;background:#fffefa;border-radius:10px;color:#315b40;cursor:pointer}button.primary{background:#315f40;color:white;border-color:#315f40}button.danger{color:#974a3a;border-color:#dfbcb1}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #a18ad0;outline-offset:2px}.import{margin-top:1.5rem;padding-top:1rem;border-top:1px solid #e6ebe2}.preview li{padding:.55rem 0;border-bottom:1px solid #e6ebe2}.issue{display:block;color:#a04936;font-size:.88rem}.message{padding:1rem;border-radius:12px;background:#e1efdf;color:#245338;margin-bottom:1rem}.message.error{background:#fbe8df;color:#813a2c}.file{display:none}.backup{background:#f3edf7}@media(max-width:560px){.top span{display:none}.intro{padding-top:2rem}.word-actions button{font-size:.8rem;padding:.55rem}.weak-list li{grid-template-columns:1fr 1fr}}
</style>
