import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, eligibleWords, progressKey, transition } from '../learning';
import { legacySeedWords, MVT_WORD_IDS, seedWords } from '../content/words';
import { french3VwoWords } from '../content/french-3vwo';
import type { Exposure, Session, Word } from '../model';
import { acquirePlayLock, clearSession, exportBackup, importBackup, loadSnapshot, resetProgress, saveSession, saveSettings, saveWords } from './index';

let locked = false;
const locks = { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
  if (locked) return callback(null);
  locked = true;
  try { await callback({}); } finally { locked = false; }
} };
const word: Word = { id: 'test-word', chapter: 'Test', partOfSpeech: 'noun', forms: { nl: 'huis', de: 'Haus' }, revision: 1, enabled: true, reviewed: true };
function legacySession(session: Session) {
  return {
    ...session, recallWordIds: session.words.map((item) => item.id), recallIndex: 0,
    boards: session.boards.map(({ attempts: _attempts, selected: _selected, ...board }) => board)
  };
}
beforeEach(async () => { locked = false; vi.stubGlobal('navigator', { locks }); await deleteDB('woordentuin'); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('lokale opslag', () => {
  it('preserves the chosen language across snapshot loads', async () => {
    const first = await loadSnapshot();
    await saveSettings({ ...first.settings, language: 'fr' });
    expect((await loadSnapshot()).settings.language).toBe('fr');
  });
  it('adds 3 VWO to a version 3 backup without changing an active regular French round', async () => {
    const french: Word = { ...word, forms: { nl: 'huis', fr: 'la maison' } };
    const initial = await loadSnapshot();
    const settings = { ...initial.settings, language: 'fr' as const };
    const session = createSession([french], {}, settings, [], 1000, () => 0.5);
    const v3 = { ...initial, schemaVersion: 3, words: [french], settings, session };
    const restored = await importBackup(JSON.stringify(v3));
    expect(restored.session).toEqual(session);
    expect(eligibleWords(restored.words, settings)).toEqual([french]);
    expect(eligibleWords(restored.words, { ...settings, language: 'fr-3vwo', chapter: 'Apprendre 10 · Kloktijden' }))
      .toContainEqual(expect.objectContaining({ forms: { nl: 'Het is half zes.', fr: 'Il est cinq heures et demie.' } }));
    expect(await loadSnapshot()).toEqual(restored);
  });
  it('commits events and session atomically, rejects stale versions and never double counts event IDs', async () => {
    const initial = await loadSnapshot();
    await saveWords([word]);
    const session = createSession([word], {}, { ...initial.settings, language: 'de' }, [], 1000, () => 0.5);
    await saveSession(session);
    const event: Exposure = { id: 'one', sessionId: session.id, wordId: word.id, language: 'de', mode: 'match', outcome: 'incorrect', choicesRemaining: 3, at: 2000, revision: 1, context: null };
    const next = { ...session, version: 1 };
    const saved = await saveSession(next, [event, event]);
    expect(saved.exposures).toHaveLength(1);
    expect(saved.progress[progressKey(word.id, 'de', 'match')].mistakes).toBe(1);
    await expect(saveSession(next, [event])).rejects.toThrow();
    expect((await loadSnapshot()).exposures).toHaveLength(1);
    await expect(saveSession({ ...next, version: 2 }, [{ ...event, outcome: 'correct' }])).rejects.toThrow();
    expect((await loadSnapshot()).session?.version).toBe(1);
  });
  it('invalidates only materially changed word progress and preserves unrelated progress', async () => {
    const initial = await loadSnapshot();
    const other = { ...word, id: 'other', forms: { nl: 'boom', de: 'Baum' } };
    await saveWords([word, other]);
    const session = createSession([word, other], {}, { ...initial.settings, language: 'de' }, [], 1000, () => 0.5);
    await saveSession(session);
    const events: Exposure[] = [word, other].map((item) => ({ id: item.id, sessionId: session.id, wordId: item.id, language: 'de', mode: 'match', outcome: 'incorrect', choicesRemaining: 3, at: 2000, revision: 1, context: null }));
    await saveSession({ ...session, version: 1 }, events);
    const metadataOnly = await saveWords([{ ...word, chapter: 'Andere naam' }, other]);
    expect(Object.keys(metadataOnly.progress)).toHaveLength(2);
    const changed = await saveWords([{ ...word, forms: { nl: 'woning', de: 'Haus' } }, other]);
    expect(changed.words[0].revision).toBe(2);
    expect(changed.progress[progressKey(word.id, 'de', 'match')]).toBeUndefined();
    expect(changed.progress[progressKey(other.id, 'de', 'match')]).toBeDefined();
    expect(changed.session).toBeNull();
  });
  it('fully rejects malformed backups without replacing existing data', async () => {
    await loadSnapshot();
    await saveWords([word]);
    const before = await exportBackup();
    const invalid = JSON.parse(before);
    invalid.progress.bad = { key: 'bad' };
    await expect(importBackup(JSON.stringify(invalid))).rejects.toThrow();
    await expect(importBackup('{')).rejects.toThrow();
    expect(await exportBackup()).toBe(before);
  });
  it('rejects unplayable active sessions and oversized exposure choices without replacing data', async () => {
    const initial = await loadSnapshot();
    await saveWords([word]);
    await saveSession(createSession([word], {}, { ...initial.settings, language: 'de' }, [], 1000, () => 0.5));
    const before = await exportBackup();
    const badMatch = JSON.parse(before);
    badMatch.session.phase = 'match';
    badMatch.session.boardIndex = badMatch.session.boards.length;
    const badRecall = JSON.parse(before);
    badRecall.session.phase = 'recall';
    badRecall.session.recallIndex = 0;
    const emptyBoard = JSON.parse(before);
    emptyBoard.session.boards[0].left = [];
    emptyBoard.session.boards[0].right = [];
    const missingTranslation = JSON.parse(before);
    delete missingTranslation.session.words[0].forms.de;
    const badChoices = JSON.parse(before);
    badChoices.exposures.push({ id: 'bad', sessionId: badChoices.session.id, wordId: word.id, language: 'de', mode: 'match', outcome: 'incorrect', choicesRemaining: 7, at: 2000, revision: 1, context: null });
    for (const invalid of [badMatch, badRecall, emptyBoard, missingTranslation, badChoices]) {
      await expect(importBackup(JSON.stringify(invalid))).rejects.toThrow();
      expect(await exportBackup()).toBe(before);
    }
  });
  it('restores a complete backup including its selection and resets progress without deleting words', async () => {
    const first = await loadSnapshot();
    await saveWords([word]);
    const session = createSession([word], {}, { ...first.settings, language: 'de' }, [], 1000, () => 0.5);
    await saveSession(session);
    const backup = JSON.parse(await exportBackup());
    backup.session.selection = { side: 'left', wordId: word.id };
    await clearSession();
    expect((await importBackup(JSON.stringify(backup))).session?.selection).toEqual(backup.session.selection);
    const reset = await resetProgress();
    expect(reset.words).toHaveLength(1);
    expect(reset.session).toBeNull();
    expect(reset.progress).toEqual({});
  });
  it('migrates stored and backed-up schema 1 snapshots while preserving edits, additions and unaffected progress', async () => {
    const initial = await loadSnapshot();
    const revised = legacySeedWords.find((item) => item.reviewed && item.forms.nl && item.forms.de && seedWords.find((seed) => seed.id === item.id)!.revision > item.revision)!;
    const editedOriginal = legacySeedWords.find((item) => item.id !== revised.id && item.reviewed && item.forms.nl && item.forms.de)!;
    const edited = { ...structuredClone(editedOriginal), note: 'Ouderlijke wijziging', enabled: false };
    const kept = { ...word, id: 'imported' };
    const settings = { ...initial.settings, language: 'de' as const };
    const session = createSession([kept], {}, settings, [], 1000, () => 0.5);
    const { wordLanguages: _wordLanguages, ...oldSession } = legacySession(session);
    const key = progressKey(kept.id, 'de', 'match');
    const progress = { key, wordId: kept.id, language: 'de', mode: 'match', revision: 1, stage: 2, dueAt: 3000, lastPracticedAt: 1000, lastPromotedDay: null, lastFailedDay: null, successes: 3, mistakes: 1, hints: 0 };
    const revisedKey = progressKey(revised.id, 'de', 'match');
    const oldEvent = { id: 'old-event', sessionId: 'old-session', wordId: revised.id, language: 'de', mode: 'match', outcome: 'correct', choicesRemaining: 4, at: 1000, revision: revised.revision };
    const legacy = { schemaVersion: 1, words: [revised, edited, kept], settings, session: oldSession, progress: { [key]: progress, [revisedKey]: { ...progress, key: revisedKey, wordId: revised.id, revision: revised.revision } }, exposures: [oldEvent] };
    const database = await openDB('woordentuin', 1);
    await database.put('state', legacy, 'snapshot');
    database.close();
    const migrated = await loadSnapshot();
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.words).toHaveLength(3 + french3VwoWords.length);
    expect(migrated.words.find((item) => item.id === revised.id)).toEqual(seedWords.find((item) => item.id === revised.id));
    expect(migrated.words.find((item) => item.id === edited.id)).toEqual(edited);
    expect(migrated.progress[key]).toEqual(progress);
    expect(migrated.progress[revisedKey]).toBeUndefined();
    expect(migrated.exposures).toEqual([]);
    expect(migrated.session?.wordLanguages).toEqual({ [kept.id]: 'de' });
    expect(await importBackup(JSON.stringify(legacy))).toEqual(migrated);
  });
  it('rejects invalid language maps and wrong-language events without changing saved data', async () => {
    const initial = await loadSnapshot();
    const session = createSession(initial.words, {}, initial.settings, [], 1000, () => 0.5);
    await saveSession(session);
    const before = await exportBackup();
    const id = session.words[0].id;
    const variants = [
      (map: Record<string, string>) => { delete map[id]; },
      (map: Record<string, string>) => { map.extra = 'de'; },
      (map: Record<string, string>) => { map[id] = 'mvt'; },
      (map: Record<string, string>) => { map[id] = 'nl'; }
    ];
    for (const change of variants) {
      const backup = JSON.parse(before);
      change(backup.session.wordLanguages);
      await expect(importBackup(JSON.stringify(backup))).rejects.toThrow();
    }
    const inconsistent = JSON.parse(before);
    inconsistent.session.settings.language = 'de';
    inconsistent.session.wordLanguages = Object.fromEntries(inconsistent.session.words.map((item: Word) => [item.id, 'de']));
    inconsistent.session.wordLanguages[id] = 'fr';
    await expect(importBackup(JSON.stringify(inconsistent))).rejects.toThrow();
    const verb = initial.words.find((item) => item.partOfSpeech === 'verb' && !item.forms.en)!;
    const missing = JSON.parse(before);
    missing.session = createSession([verb], {}, { ...initial.settings, language: 'de' }, [], 1000, () => 0.5);
    missing.session.settings.language = 'mvt';
    missing.session.wordLanguages[verb.id] = 'en';
    await expect(importBackup(JSON.stringify(missing))).rejects.toThrow();
    const wrong = (['en', 'fr', 'de', 'es'] as const).find((language) => language !== session.wordLanguages[id])!;
    const event: Exposure = { id: 'wrong', sessionId: session.id, wordId: id, language: wrong, mode: 'match', outcome: 'hint', choicesRemaining: 1, at: 2000, revision: session.words[0].revision, context: null };
    await expect(saveSession({ ...session, version: 1 }, [event])).rejects.toThrow();
    expect(await exportBackup()).toBe(before);
  });
  it('migrates English-containing active MVT sessions on load and import without losing edited words or history', async () => {
    const initial = await loadSnapshot();
    const english = { ...structuredClone(seedWords.find((item) => MVT_WORD_IDS.has(item.id) && item.reviewed && item.forms.en)!), note: 'Bewaarde ouderlijke notitie' };
    const settings = { ...initial.settings, language: 'mvt' as const };
    const session = legacySession(createSession([english], {}, { ...settings, language: 'en' }, [], 1000, () => 0.5));
    session.settings = settings;
    session.phase = 'match';
    const key = progressKey(english.id, 'en', 'match');
    const recallKey = progressKey(english.id, 'en', 'recall');
    const progress = { key, wordId: english.id, language: 'en', mode: 'match', revision: english.revision, stage: 2, dueAt: 3000, lastPracticedAt: 1000, lastPromotedDay: null, lastFailedDay: null, successes: 3, mistakes: 1, hints: 0 };
    const exposures = [
      { id: 'english-match', sessionId: session.id, wordId: english.id, language: 'en', mode: 'match', outcome: 'correct', choicesRemaining: 0, at: 1000, revision: english.revision },
      { id: 'english-recall', sessionId: 'archived-recall', wordId: english.id, language: 'en', mode: 'recall', outcome: 'correct', choicesRemaining: 1, at: 2000, revision: english.revision }
    ];
    const legacy = { schemaVersion: 2, words: [english], settings, session, progress: { [key]: progress, [recallKey]: { ...progress, key: recallKey, mode: 'recall' } }, exposures };
    const database = await openDB('woordentuin', 1);
    await database.put('state', legacy, 'snapshot');
    database.close();
    const migrated = await loadSnapshot();
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.words).toEqual([english, ...french3VwoWords]);
    expect(migrated.progress).toEqual(legacy.progress);
    expect(migrated.exposures).toEqual(exposures.map((event) => ({ ...event, context: null })));
    expect(migrated.session).toBeNull();
    expect(migrated.notice).toMatch(/Frans, Duits en Spaans/);
    expect(await importBackup(JSON.stringify(legacy))).toEqual(migrated);
    expect(JSON.parse(await exportBackup())).toEqual(migrated);
    await saveSession(createSession([english], migrated.progress, { ...settings, language: 'en' }, migrated.exposures, 3000, () => 0.5));
    expect((await loadSnapshot()).notice).toBeNull();
    await importBackup(JSON.stringify(legacy));
    expect((await resetProgress()).notice).toBeNull();
  });
  it('resumes compatible legacy boards with unknown selection order and seeds failed or hinted attempts', async () => {
    const initial = await loadSnapshot();
    const other = { ...word, id: 'other', forms: { nl: 'boom', de: 'Baum' } };
    const settings = { ...initial.settings, language: 'de' as const };
    const session = legacySession(createSession([word, other], {}, settings, [], 1000, () => 0.5));
    session.phase = 'match';
    session.boards[0].failed = [word.id];
    session.boards[0].hinted = [other.id];
    session.boards[0].matched = [other.id];
    session.selection = { side: 'left', wordId: word.id };
    const migrated = await importBackup(JSON.stringify({ schemaVersion: 2, words: [word, other], settings, session, progress: {}, exposures: [] }));
    expect(migrated.notice).toBeNull();
    expect(migrated.session?.phase).toBe('match');
    expect(migrated.session?.version).toBe(session.version);
    expect(migrated.session?.selection).toBeNull();
    expect(migrated.session?.boards[0]).toEqual({ ...session.boards[0], attempts: { [word.id]: 1, [other.id]: 1 }, selected: [] });
    expect(migrated.session).not.toHaveProperty('recallWordIds');
    expect(migrated.session).not.toHaveProperty('recallIndex');
    const selected = transition(migrated.session!, { type: 'select', side: 'left', wordId: word.id }, 2000);
    const corrected = transition(selected.session, { type: 'select', side: 'right', wordId: word.id }, 2500);
    expect(corrected.exposures[0].context).toMatchObject({ attempt: 2, assisted: true, selectionMs: null, responseMs: null });
    const saved = await saveSession(corrected.session, corrected.exposures);
    expect(saved.session?.boards[0].attempts[word.id]).toBe(2);
    expect(saved.session?.boards[0].selected).toContain(word.id);
  });
  it('converts pending legacy recall into results even with English, preserving archived evidence without fabricating events', async () => {
    const initial = await loadSnapshot();
    const english = seedWords.find((item) => MVT_WORD_IDS.has(item.id) && item.reviewed && item.forms.en)!;
    const settings = { ...initial.settings, language: 'mvt' as const };
    const session = { ...legacySession(createSession([english], {}, { ...settings, language: 'en' }, [], 1000, () => 0.5)), phase: 'recall', settings };
    const exposure = { id: 'previous-recall', sessionId: session.id, wordId: english.id, language: 'en', mode: 'recall', outcome: 'incorrect', choicesRemaining: 1, at: 2000, revision: english.revision };
    const legacy = { schemaVersion: 2, words: [english], settings, session, progress: {}, exposures: [exposure] };
    const database = await openDB('woordentuin', 1);
    await database.put('state', legacy, 'snapshot');
    database.close();
    const migrated = await loadSnapshot();
    expect(await importBackup(JSON.stringify(legacy))).toEqual(migrated);
    expect(migrated.session?.phase).toBe('results');
    expect(migrated.session?.wordLanguages[english.id]).toBe('en');
    expect(migrated.session).not.toHaveProperty('recallWordIds');
    expect(migrated.exposures).toEqual([{ ...exposure, context: null }]);
    expect(await loadSnapshot()).toEqual(migrated);
    expect(await importBackup(await exportBackup())).toEqual(migrated);
  });
  it('preserves old independent English practice and validates old MVT eligibility before discarding incompatible rounds', async () => {
    const initial = await loadSnapshot();
    const english: Word = { ...word, forms: { nl: 'huis', en: 'house' } };
    const settings = { ...initial.settings, language: 'en' as const };
    const session = legacySession(createSession([english], {}, settings, [], 1000, () => 0.5));
    const legacy = { schemaVersion: 2, words: [english], settings, session, progress: {}, exposures: [] };
    const migrated = await importBackup(JSON.stringify(legacy));
    expect(migrated.session?.wordLanguages).toEqual({ [english.id]: 'en' });
    expect(migrated.session?.phase).toBe(session.phase);
    expect(migrated.notice).toBeNull();
    const { wordLanguages: _wordLanguages, ...schemaOneSession } = session;
    expect(await importBackup(JSON.stringify({ ...legacy, schemaVersion: 1, session: schemaOneSession }))).toEqual(migrated);
    const before = await exportBackup();
    const nonMvtWord = structuredClone(legacy);
    nonMvtWord.session.settings.language = 'mvt';
    await expect(importBackup(JSON.stringify(nonMvtWord))).rejects.toThrow();
    const missingLanguage = structuredClone(legacy);
    delete missingLanguage.words[0].forms.en;
    await expect(importBackup(JSON.stringify(missingLanguage))).rejects.toThrow();
    const invalidBoard = structuredClone(legacy);
    invalidBoard.session.boards[0].left.push('unknown');
    await expect(importBackup(JSON.stringify(invalidBoard))).rejects.toThrow();
    expect(await exportBackup()).toBe(before);
    const database = await openDB('woordentuin', 1);
    await database.put('state', nonMvtWord, 'snapshot');
    await expect(loadSnapshot()).rejects.toThrow();
    expect(await database.get('state', 'snapshot')).toEqual(nonMvtWord);
    database.close();
  });
  it('round-trips contextual evidence with real assisted choices and preserves board attempt history', async () => {
    const initial = await loadSnapshot();
    await saveWords([word]);
    const session = createSession([word], {}, { ...initial.settings, language: 'de' }, [], 1000, () => 0.5);
    await saveSession(session);
    const event: Exposure = {
      id: 'assisted', sessionId: session.id, wordId: word.id, language: 'de', mode: 'match', outcome: 'hint', choicesRemaining: 1, at: 2000, revision: 1,
      context: { boardIndex: 0, boardSize: 1, attempt: 2, selectionSide: 'right', selectionOrder: 1, matchOrder: 1, assisted: true, revisit: false, selectionMs: null, responseMs: 123.5 }
    };
    const next = { ...session, version: 1, boards: session.boards.map((board, index) => index === 0 ? { ...board, hinted: [word.id], matched: [word.id], attempts: { [word.id]: 2 }, selected: [word.id] } : board) };
    const saved = await saveSession(next, [event, event]);
    expect(saved.exposures).toEqual([event]);
    expect(saved.progress[progressKey(word.id, 'de', 'match')].hints).toBe(1);
    expect(await importBackup(await exportBackup())).toEqual(saved);
    expect((await loadSnapshot()).session?.boards[0]).toEqual(next.boards[0]);
  });
  it('rejects impossible context and malformed board history atomically during saves and imports', async () => {
    const initial = await loadSnapshot();
    await saveWords([word]);
    const session = createSession([word], {}, { ...initial.settings, language: 'de' }, [], 1000, () => 0.5);
    await saveSession(session);
    const before = await exportBackup();
    const event: Exposure = {
      id: 'context', sessionId: session.id, wordId: word.id, language: 'de', mode: 'match', outcome: 'correct', choicesRemaining: 1, at: 2000, revision: 1,
      context: { boardIndex: 0, boardSize: 1, attempt: 1, selectionSide: 'left', selectionOrder: 1, matchOrder: 1, assisted: false, revisit: false, selectionMs: 100, responseMs: null }
    };
    const invalidEvents = [
      { ...event, context: undefined }, { ...event, context: {} }, { ...event, choicesRemaining: 0 }, { ...event, mode: 'recall' },
      ...[
        { boardIndex: 3 }, { boardSize: 0 }, { boardSize: 7 }, { boardSize: 2 }, { attempt: 0 }, { attempt: 2 },
        { selectionSide: 'middle' }, { selectionOrder: 0 }, { selectionOrder: 2 }, { matchOrder: null }, { matchOrder: 2 },
        { assisted: 'yes' }, { revisit: null }, { selectionMs: -1 }, { responseMs: '100' }
      ].map((context) => ({ ...event, context: { ...event.context, ...context } })),
      { ...event, outcome: 'incorrect' }, { ...event, outcome: 'hint' }
    ];
    for (const invalidEvent of invalidEvents) {
      const backup = JSON.parse(before);
      backup.exposures.push(invalidEvent);
      await expect(importBackup(JSON.stringify(backup))).rejects.toThrow();
      await expect(saveSession({ ...session, version: 1 }, [invalidEvent as Exposure])).rejects.toThrow();
      expect(await exportBackup()).toBe(before);
    }
    for (const patch of [{ attempts: { unknown: 1 } }, { attempts: { [word.id]: -1 } }, { failed: [word.id], attempts: {} }, { selected: [word.id, word.id] }, { selected: ['unknown'] }]) {
      const backup = JSON.parse(before);
      Object.assign(backup.session.boards[0], patch);
      await expect(importBackup(JSON.stringify(backup))).rejects.toThrow();
      expect(await exportBackup()).toBe(before);
    }
  });
  it('excludes parent writes while a play lock is held, and releases the lock', async () => {
    const snapshot = await loadSnapshot();
    const release = await acquirePlayLock();
    await expect(saveWords([word])).rejects.toThrow(/ander tabblad/);
    await expect(saveSettings(snapshot.settings)).rejects.toThrow(/ander tabblad/);
    release();
    await vi.waitFor(() => expect(locked).toBe(false));
    await expect(saveWords([word])).resolves.toBeDefined();
  });
});
