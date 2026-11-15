import { openDB, type DBSchema } from 'idb';
import type { Board, Exposure, Language, Progress, Session, Settings, Snapshot, TargetLanguage, Word } from '../model';
import { MATCH_PAIRS } from '../model';
import { applyExposure, progressKey, targetLanguages } from '../learning';
import { legacySeedWords, MVT_WORD_IDS, seedWords } from '../content/words';

interface Store extends DBSchema { state: { key: string; value: Snapshot } }
type LegacyBoard = Omit<Board, 'attempts' | 'selected'>;
type LegacySession = Omit<Session, 'phase' | 'boards'> & { phase: Session['phase'] | 'recall'; boards: LegacyBoard[]; recallWordIds: string[]; recallIndex: number };
type LegacyExposure = Omit<Exposure, 'context'>;
type LegacySnapshot = Omit<Snapshot, 'schemaVersion' | 'notice' | 'session' | 'exposures'> & { schemaVersion: 2; session: LegacySession | null; exposures: LegacyExposure[] };
const DB_NAME = 'woordentuin';
const LOCK_NAME = 'woordentuin-play';
const languages: Language[] = ['nl', 'de', 'fr', 'es', 'en'];
const targets: TargetLanguage[] = ['de', 'fr', 'es', 'en'];
const invalid = (): never => { throw new Error('Ongeldige gegevens. Er is niets vervangen.'); };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const oneOf = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);

function validSettings(value: unknown): value is Settings {
  if (!object(value) || !oneOf(value.language, [...targets, 'mvt']) || !text(value.chapter) || !text(value.timezone)) return false;
  try { new Intl.DateTimeFormat('nl', { timeZone: value.timezone }); return true; } catch { return false; }
}
function validWord(value: unknown): value is Word {
  if (!object(value) || !text(value.id) || !text(value.chapter) || !oneOf(value.partOfSpeech, ['verb', 'noun', 'adjective', 'other']) || !object(value.forms) || !integer(value.revision) || value.revision < 1 || typeof value.reviewed !== 'boolean' || typeof value.enabled !== 'boolean' || !optionalText(value.context) || !optionalText(value.note)) return false;
  if (value.reviewed && !text(value.forms.nl)) return false;
  if (!Object.entries(value.forms).every(([key, form]) => languages.includes(key as Language) && text(form))) return false;
  if (!targets.some((lang) => text((value.forms as Record<string, unknown>)[lang]))) return false;
  if (value.alternatives !== undefined && (!object(value.alternatives) || !Object.entries(value.alternatives).every(([key, forms]) => languages.includes(key as Language) && strings(forms)))) return false;
  return true;
}
function validProgress(value: unknown): value is Progress {
  if (!object(value) || !text(value.key) || !text(value.wordId) || !oneOf(value.language, targets) || !oneOf(value.mode, ['match', 'recall']) || !integer(value.revision) || value.revision < 1 || !integer(value.stage) || value.stage > 4) return false;
  return ['dueAt', 'lastPracticedAt', 'successes', 'mistakes', 'hints'].every((key) => integer(value[key])) && ['lastPromotedDay', 'lastFailedDay'].every((key) => value[key] === null || (typeof value[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value[key] as string)));
}
function validExposure(value: unknown, legacy = false): boolean {
  if (!object(value) || !text(value.id) || !text(value.sessionId) || !text(value.wordId) || !(value.chosenWordId === undefined || text(value.chosenWordId)) || !oneOf(value.language, targets) || !oneOf(value.mode, ['match', 'recall']) || !oneOf(value.outcome, ['correct', 'incorrect', 'hint']) || !integer(value.choicesRemaining) || value.choicesRemaining > MATCH_PAIRS || !integer(value.at) || !integer(value.revision) || value.revision < 1) return false;
  if (legacy || value.context === null) return true;
  const context = value.context;
  if (!object(context) || value.mode !== 'match' || !integer(context.boardIndex) || context.boardIndex > 2 || !integer(context.boardSize) || context.boardSize < 1 || context.boardSize > MATCH_PAIRS || !integer(context.attempt) || context.attempt < 1 || !oneOf(context.selectionSide, ['left', 'right']) || !integer(context.selectionOrder) || context.selectionOrder < 1 || context.selectionOrder > context.boardSize || typeof context.assisted !== 'boolean' || typeof context.revisit !== 'boolean') return false;
  if (value.choicesRemaining < 1 || value.choicesRemaining > context.boardSize || ((context.attempt > 1 || value.outcome === 'hint') && !context.assisted)) return false;
  if (value.outcome === 'incorrect' ? context.matchOrder !== null : !integer(context.matchOrder) || context.matchOrder < 1 || context.matchOrder > context.boardSize || context.matchOrder !== context.boardSize - value.choicesRemaining + 1) return false;
  return ['selectionMs', 'responseMs'].every((key) => context[key] === null || (typeof context[key] === 'number' && Number.isFinite(context[key]) && context[key] >= 0));
}
function validBoard(value: unknown, ids: Set<string>, legacy: boolean): boolean {
  if (!object(value) || !['left', 'right', 'matched', 'failed', 'hinted'].every((key) => strings(value[key]) && (value[key] as string[]).every((id) => ids.has(id)))) return false;
  const board = value as unknown as Board;
  if (!(board.left.length > 0 && board.left.length <= MATCH_PAIRS && board.left.length === board.right.length && board.left.every((id) => board.right.includes(id)) && [...board.matched, ...board.failed, ...board.hinted].every((id) => board.left.includes(id)))) return false;
  return legacy || (object(board.attempts) && Object.entries(board.attempts).every(([id, count]) => board.left.includes(id) && integer(count) && count >= 1) && [...board.failed, ...board.hinted].every((id) => (board.attempts[id] ?? 0) >= 1) && strings(board.selected) && board.selected.every((id) => board.left.includes(id)));
}
function validSession(value: unknown, legacy: boolean): boolean {
  if (!object(value) || !text(value.id) || !integer(value.version) || !validSettings(value.settings) || !oneOf(value.phase, legacy ? ['intro', 'match', 'recall', 'results'] : ['intro', 'match', 'results']) || !Array.isArray(value.words) || !value.words.every(validWord)) return false;
  const settings = value.settings;
  const ids = new Set(value.words.map((word: Word) => word.id));
  if (!object(value.wordLanguages) || Object.keys(value.wordLanguages).length !== ids.size || !value.words.every((word: Word) => {
    const language = (value.wordLanguages as Record<string, unknown>)[word.id];
    const eligible = legacy || value.phase === 'results'
      ? (settings.language === 'mvt' ? MVT_WORD_IDS.has(word.id) && oneOf(language, targets) && text(word.forms[language as TargetLanguage]) : language === settings.language && text(word.forms[settings.language]))
      : targetLanguages(word, settings).includes(language as TargetLanguage);
    return Object.hasOwn(value.wordLanguages as object, word.id) && word.enabled && word.reviewed && text(word.forms.nl) && oneOf(language, targets) && eligible;
  })) return false;
  if (ids.size !== value.words.length || !Array.isArray(value.boards) || value.boards.length > 3 || !value.boards.every((board) => validBoard(board, ids, legacy)) || !strings(value.newWordIds) || !value.newWordIds.every((id) => ids.has(id))) return false;
  if (!['boardIndex', 'completedPairs', 'startedAt', 'correct', 'mistakes', 'hints'].every((key) => integer(value[key])) || (value.boardIndex as number) > value.boards.length || typeof value.feedback !== 'string') return false;
  if ((value.phase === 'intro' || value.phase === 'match') && (value.boardIndex as number) >= value.boards.length) return false;
  if (legacy && (!strings(value.recallWordIds) || !value.recallWordIds.every((id) => ids.has(id)) || !integer(value.recallIndex) || value.recallIndex > value.recallWordIds.length || (value.phase === 'recall' && value.recallIndex >= value.recallWordIds.length))) return false;
  if (!legacy && (Object.hasOwn(value, 'recallWordIds') || Object.hasOwn(value, 'recallIndex'))) return false;
  return value.selection === null || (object(value.selection) && oneOf(value.selection.side, ['left', 'right']) && text(value.selection.wordId) && ids.has(value.selection.wordId));
}
function validateSnapshot(value: unknown, legacy: true): asserts value is LegacySnapshot;
function validateSnapshot(value: unknown, legacy?: false): asserts value is Snapshot;
function validateSnapshot(value: unknown, legacy = false): void {
  if (!object(value) || value.schemaVersion !== (legacy ? 2 : 3) || (!legacy && value.notice !== null && !text(value.notice)) || !Array.isArray(value.words) || !value.words.every(validWord) || !object(value.progress) || !Array.isArray(value.exposures) || !value.exposures.every((event) => validExposure(event, legacy)) || !validSettings(value.settings) || !(value.session === null || validSession(value.session, legacy))) invalid();
  const snapshot = value as unknown as Snapshot | LegacySnapshot;
  const words = new Map(snapshot.words.map((word) => [word.id, word]));
  if (words.size !== snapshot.words.length || new Set(snapshot.exposures.map((event) => event.id)).size !== snapshot.exposures.length) invalid();
  for (const [key, progress] of Object.entries(snapshot.progress)) {
    if (!validProgress(progress)) invalid();
    const word = words.get(progress.wordId);
    if (!word || word.revision !== progress.revision || key !== progress.key || key !== progressKey(progress.wordId, progress.language, progress.mode) || !word.forms[progress.language]) invalid();
  }
  for (const event of snapshot.exposures) {
    const word = words.get(event.wordId);
    if (!word || word.revision !== event.revision || !word.forms[event.language] || (event.chosenWordId && !words.has(event.chosenWordId)) || (snapshot.session?.id === event.sessionId && snapshot.session.wordLanguages[event.wordId] !== event.language)) invalid();
    if (!legacy && 'context' in event && event.context && snapshot.session?.id === event.sessionId) {
      const board = snapshot.session.boards[event.context.boardIndex];
      if (!board || board.left.length !== event.context.boardSize || !board.left.includes(event.wordId) || (event.chosenWordId && !board.left.includes(event.chosenWordId))) invalid();
    }
  }
  if (snapshot.session && snapshot.session.words.some((word) => {
    const current = words.get(word.id);
    return !current || current.revision !== word.revision || material(current) !== material(word);
  })) invalid();
}
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  return a === b;
}
function normalizeSnapshot(value: unknown): Snapshot {
  if (!object(value)) return invalid();
  if (value.schemaVersion === 3) { validateSnapshot(value); return value; }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return invalid();
  let candidate = value;
  if (value.schemaVersion === 1) {
    if (!object(value.settings) || !oneOf(value.settings.language, targets)) return invalid();
    let session = value.session;
    if (session !== null) {
      if (!object(session) || !object(session.settings) || !oneOf(session.settings.language, targets) || !Array.isArray(session.words)) return invalid();
      const language = session.settings.language;
      session = { ...session, wordLanguages: Object.fromEntries(session.words.map((word: unknown) => {
        if (!object(word) || !text(word.id)) return invalid();
        return [word.id, language];
      })) };
    }
    candidate = { ...value, schemaVersion: 2, session };
  }
  // Validate against the old four-language rules before applying the MVT cutover.
  validateSnapshot(candidate, true);
  let migrated: LegacySnapshot = candidate;
  if (value.schemaVersion === 1) {
    const legacy = new Map(legacySeedWords.map((word) => [word.id, word]));
    const current = new Map(seedWords.map((word) => [word.id, word]));
    const changed = new Set<string>();
    const words = migrated.words.map((word) => {
      const old = legacy.get(word.id), replacement = current.get(word.id);
      if (!old || !replacement || !sameValue(word, old)) return word;
      const revised = material(word) !== material(replacement);
      if (revised) changed.add(word.id);
      return { ...structuredClone(replacement), revision: revised ? Math.max(word.revision + 1, replacement.revision) : word.revision };
    });
    migrated = {
      ...migrated, words,
      progress: Object.fromEntries(Object.entries(migrated.progress).filter(([, progress]) => !changed.has(progress.wordId))),
      exposures: migrated.exposures.filter((event) => !changed.has(event.wordId)),
      session: migrated.session?.words.some((word) => changed.has(word.id)) ? null : migrated.session
    };
  }
  let session: Session | null = null;
  let notice: string | null = null;
  if (migrated.session) {
    const { recallWordIds: _recallWordIds, recallIndex: _recallIndex, ...old } = migrated.session;
    if ((old.phase === 'intro' || old.phase === 'match') && old.settings.language === 'mvt' && Object.values(old.wordLanguages).includes('en')) {
      notice = 'MVT oefent nu Frans, Duits en Spaans. Er start een nieuwe ronde; je opgeslagen voortgang blijft bewaard.';
    } else {
      if (old.phase === 'recall') notice = 'Je eerdere ronde is afgerond. Terugvragen is vervallen; je opgeslagen voortgang blijft bewaard.';
      session = {
        ...old, phase: old.phase === 'recall' ? 'results' : old.phase, selection: null,
        boards: old.boards.map((board) => ({
          ...board, attempts: Object.fromEntries([...new Set([...board.failed, ...board.hinted])].map((id) => [id, 1])), selected: []
        }))
      };
    }
  }
  const result: Snapshot = { ...migrated, schemaVersion: 3, notice, session, exposures: migrated.exposures.map((event) => ({ ...event, context: null })) };
  validateSnapshot(result);
  return result;
}
function db() { return openDB<Store>(DB_NAME, 1, { upgrade(database) { database.createObjectStore('state'); } }); }
function initial(): Snapshot {
  let timezone = 'Europe/Amsterdam';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch { /* use fallback */ }
  return { schemaVersion: 3, notice: null, words: structuredClone(seedWords), progress: {}, exposures: [], settings: { language: 'mvt', chapter: 'all', timezone }, session: null };
}
async function mutate(fn: (snapshot: Snapshot) => Snapshot): Promise<Snapshot> {
  const database = await db();
  const tx = database.transaction('state', 'readwrite');
  try {
    const current = normalizeSnapshot(await tx.store.get('snapshot') ?? initial());
    const result = fn(current);
    validateSnapshot(result);
    await tx.store.put(result, 'snapshot');
    await tx.done;
    return result;
  } catch (error) { try { tx.abort(); } catch { /* transaction already ended */ } await tx.done.catch(() => {}); throw error; }
  finally { database.close(); }
}
export async function loadSnapshot(): Promise<Snapshot> { return mutate((snapshot) => snapshot); }

async function acquireLease(): Promise<() => Promise<void>> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('Deze browser ondersteunt geen veilige speelvergrendeling. Gebruik een recente browser.');
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => { unlock = resolve; });
  let ready!: (release: () => Promise<void>) => void;
  let fail!: (error: Error) => void;
  const acquired = new Promise<() => Promise<void>>((resolve, reject) => { ready = resolve; fail = reject; });
  const request = navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) { fail(new Error('Er is al een speelsessie of wijziging geopend in een ander tabblad. Sluit die eerst.')); return; }
    ready(async () => { unlock(); await request; });
    await held;
  });
  request.catch((error: unknown) => fail(error instanceof Error ? error : new Error('De speelvergrendeling is niet beschikbaar.')));
  return acquired;
}
export async function acquirePlayLock(): Promise<() => void> { return acquireLease(); }
async function exclusive<T>(work: () => Promise<T>): Promise<T> { const release = await acquireLease(); try { return await work(); } finally { await release(); } }
export async function saveSettings(settings: Settings): Promise<void> { await exclusive(async () => { await mutate((s) => ({ ...s, settings })); }); }
export async function saveSession(session: Session, exposures: Exposure[] = []): Promise<Snapshot> {
  return mutate((s) => {
    const old = s.session;
    if (old?.id === session.id) {
      if (session.version !== old.version + 1) throw new Error('Deze speelsessie is verouderd. Herlaad de pagina.');
    } else if ((old && old.phase !== 'results') || session.version > 1) throw new Error('Een andere speelsessie is al bezig.');
    const known = new Map(s.exposures.map((event) => [event.id, event]));
    const progress = { ...s.progress };
    const events = [...s.exposures];
    for (const event of exposures) {
      if (!validExposure(event) || event.sessionId !== session.id || event.language !== session.wordLanguages[event.wordId] || !session.words.some((word) => word.id === event.wordId && word.revision === event.revision) || (event.chosenWordId && !session.words.some((word) => word.id === event.chosenWordId))) invalid();
      const existing = known.get(event.id);
      if (existing) { if (JSON.stringify(existing) !== JSON.stringify(event)) invalid(); continue; }
      const key = progressKey(event.wordId, event.language, event.mode);
      progress[key] = applyExposure(progress[key], event, session.settings.timezone);
      known.set(event.id, event); events.push(event);
    }
    return { ...s, notice: null, session: { ...session, selection: null }, progress, exposures: events };
  });
}
export async function clearSession(): Promise<void> { await mutate((s) => ({ ...s, session: null })); }
function material(word: Word): string { return JSON.stringify([word.forms, word.alternatives ?? {}, word.partOfSpeech, word.context ?? '']); }
export async function saveWords(words: Word[]): Promise<Snapshot> {
  return exclusive(() => mutate((s) => {
    if (!Array.isArray(words) || !words.every(validWord) || new Set(words.map((word) => word.id)).size !== words.length) invalid();
    const previous = new Map(s.words.map((word) => [word.id, word]));
    const changed = new Set<string>();
    const updated = words.map((word) => {
      const old = previous.get(word.id);
      if (old && material(old) !== material(word)) { changed.add(word.id); return { ...word, revision: old.revision + 1 }; }
      return { ...word, revision: old?.revision ?? 1 };
    });
    const ids = new Set(updated.map((word) => word.id));
    const progress = Object.fromEntries(Object.entries(s.progress).filter(([, p]) => ids.has(p.wordId) && !changed.has(p.wordId)));
    const exposures = s.exposures.filter((e) => ids.has(e.wordId) && !changed.has(e.wordId) && (!e.chosenWordId || ids.has(e.chosenWordId)));
    const invalidateSession = s.session?.words.some((word) => !ids.has(word.id) || changed.has(word.id) || !updated.find((item) => item.id === word.id)?.enabled || !updated.find((item) => item.id === word.id)?.reviewed);
    return { ...s, words: updated, progress, exposures, session: invalidateSession ? null : s.session };
  }));
}
export async function exportBackup(): Promise<string> { return JSON.stringify(await loadSnapshot(), null, 2); }
export async function importBackup(json: string): Promise<Snapshot> {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return invalid(); }
  const snapshot = normalizeSnapshot(data);
  return exclusive(() => mutate(() => snapshot));
}
export async function resetProgress(): Promise<Snapshot> { return exclusive(() => mutate((s) => ({ ...s, notice: null, progress: {}, exposures: [], session: null }))); }
