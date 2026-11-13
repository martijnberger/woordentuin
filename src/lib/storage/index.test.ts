import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, progressKey } from '../learning';
import type { Exposure, Word } from '../model';
import { acquirePlayLock, clearSession, exportBackup, importBackup, loadSnapshot, resetProgress, saveSession, saveSettings, saveWords } from './index';

let locked = false;
const locks = { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
  if (locked) return callback(null);
  locked = true;
  try { await callback({}); } finally { locked = false; }
} };
const word: Word = { id: 'test-word', chapter: 'Test', partOfSpeech: 'noun', forms: { nl: 'huis', de: 'Haus' }, revision: 1, enabled: true, reviewed: true };
beforeEach(async () => { locked = false; vi.stubGlobal('navigator', { locks }); await deleteDB('woordentuin'); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('lokale opslag', () => {
  it('seeds only once and preserves settings', async () => {
    const first = await loadSnapshot();
    expect(first.words.length).toBeGreaterThan(0);
    await saveSettings({ ...first.settings, language: 'fr' });
    expect((await loadSnapshot()).settings.language).toBe('fr');
  });
  it('commits events and session atomically, rejects stale versions and never double counts event IDs', async () => {
    const initial = await loadSnapshot();
    await saveWords([word]);
    const session = createSession([word], {}, initial.settings, 1000, () => 0.5);
    await saveSession(session);
    const event: Exposure = { id: 'one', sessionId: session.id, wordId: word.id, language: 'de', mode: 'match', outcome: 'incorrect', choicesRemaining: 3, at: 2000, revision: 1 };
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
    const session = createSession([word, other], {}, initial.settings, 1000, () => 0.5);
    await saveSession(session);
    const events: Exposure[] = [word, other].map((item) => ({ id: item.id, sessionId: session.id, wordId: item.id, language: 'de', mode: 'match', outcome: 'incorrect', choicesRemaining: 3, at: 2000, revision: 1 }));
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
    await saveSession(createSession([word], {}, initial.settings, 1000, () => 0.5));
    const before = await exportBackup();
    const badMatch = JSON.parse(before);
    badMatch.session.phase = 'match';
    badMatch.session.boardIndex = badMatch.session.boards.length;
    const badRecall = JSON.parse(before);
    badRecall.session.phase = 'recall';
    badRecall.session.recallIndex = badRecall.session.recallWordIds.length;
    const emptyBoard = JSON.parse(before);
    emptyBoard.session.boards[0].left = [];
    emptyBoard.session.boards[0].right = [];
    const missingTranslation = JSON.parse(before);
    delete missingTranslation.session.words[0].forms.de;
    const badChoices = JSON.parse(before);
    badChoices.exposures.push({ id: 'bad', sessionId: badChoices.session.id, wordId: word.id, language: 'de', mode: 'match', outcome: 'incorrect', choicesRemaining: 5, at: 2000, revision: 1 });
    for (const invalid of [badMatch, badRecall, emptyBoard, missingTranslation, badChoices]) {
      await expect(importBackup(JSON.stringify(invalid))).rejects.toThrow();
      expect(await exportBackup()).toBe(before);
    }
  });
  it('restores a complete backup, clears transient selection, and resets progress without deleting words', async () => {
    const first = await loadSnapshot();
    await saveWords([word]);
    const session = createSession([word], {}, first.settings, 1000, () => 0.5);
    await saveSession(session);
    const backup = JSON.parse(await exportBackup());
    backup.session.selection = { side: 'left', wordId: word.id };
    await clearSession();
    expect((await importBackup(JSON.stringify(backup))).session?.selection).toBeNull();
    const reset = await resetProgress();
    expect(reset.words).toHaveLength(1);
    expect(reset.session).toBeNull();
    expect(reset.progress).toEqual({});
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
