import type { Board, Exposure, Language, PracticeLanguage, Progress, Session, Settings, TargetLanguage, Word } from '../model';
import { MATCH_PAIRS } from '../model';
import { MVT_WORD_IDS } from '../content/words';

export const LANGUAGES: Record<TargetLanguage, string> = { de: 'Duits', fr: 'Frans', es: 'Spaans', en: 'Engels' };
export const PRACTICE_MODES: Record<PracticeLanguage, string> = { ...LANGUAGES, mvt: 'MVT · alle talen' };
const targets: TargetLanguage[] = ['en', 'fr', 'de', 'es'];
const sessionPairLimit = MATCH_PAIRS * 3;
export type Action = { type: 'begin' } | { type: 'select'; side: 'left' | 'right'; wordId: string } | { type: 'hint' } | { type: 'next-board' } | { type: 'recall'; known: boolean } | { type: 'skip-recall' };
export const progressKey = (wordId: string, language: TargetLanguage, mode: 'match' | 'recall'): string => JSON.stringify([wordId, language, mode]);
const day = (at: number, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const DAY = 86_400_000;
const intervals = [1, 3, 7, 14, 30];
let idCounter = 0;
function uniqueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export function targetLanguages(word: Word, settings: Settings): TargetLanguage[] {
  if (settings.language === 'mvt') return MVT_WORD_IDS.has(word.id) ? targets.filter((language) => !!word.forms[language]?.trim()) : [];
  return word.forms[settings.language]?.trim() ? [settings.language] : [];
}
export function eligibleWords(words: Word[], settings: Settings): Word[] {
  return words.filter((w) => w.enabled && w.reviewed && (settings.chapter === 'all' || settings.chapter === w.chapter) && !!w.forms.nl?.trim() && targetLanguages(w, settings).length > 0);
}
export function applyExposure(previous: Progress | undefined, exposure: Exposure, timezone: string): Progress {
  const same = previous?.revision === exposure.revision && previous.wordId === exposure.wordId && previous.language === exposure.language && previous.mode === exposure.mode;
  const p: Progress = same ? { ...previous } : { key: progressKey(exposure.wordId, exposure.language, exposure.mode), wordId: exposure.wordId, language: exposure.language, mode: exposure.mode, revision: exposure.revision, stage: 0, dueAt: exposure.at + DAY, lastPracticedAt: exposure.at, lastPromotedDay: null, lastFailedDay: null, successes: 0, mistakes: 0, hints: 0 };
  const today = day(exposure.at, timezone);
  if (exposure.outcome === 'incorrect' || exposure.outcome === 'hint') {
    p.stage = 0; p.dueAt = exposure.at + DAY; p.lastFailedDay = today;
    if (exposure.outcome === 'incorrect') p.mistakes++; else p.hints++;
  } else {
    const strong = exposure.mode === 'recall' || exposure.choicesRemaining >= 3;
    if (strong) p.successes++;
    if (same && strong && exposure.at >= p.dueAt && day(p.lastPracticedAt, timezone) < today && p.lastPromotedDay !== today && p.lastFailedDay !== today) {
      p.stage = Math.min(p.stage + 1, intervals.length - 1);
      p.dueAt = exposure.at + intervals[p.stage] * DAY;
      p.lastPromotedDay = today;
    }
  }
  p.lastPracticedAt = exposure.at;
  return p;
}
function normalized(value: string): string { return value.normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function variants(word: Word, language: Language): Set<string> {
  const value = word.forms[language] ?? '';
  return new Set([value, ...value.split(/,\s*|\//), ...(word.alternatives?.[language] ?? [])].map(normalized).filter(Boolean));
}
function conflicts(a: Word, aLanguage: TargetLanguage, b: Word, bLanguage: TargetLanguage): boolean {
  const overlap = (av: Set<string>, bv: Set<string>) => [...av].some((v) => bv.has(v));
  return overlap(variants(a, 'nl'), variants(b, 'nl')) || overlap(variants(a, aLanguage), variants(b, bLanguage));
}
function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.max(0, Math.min(i, Math.floor(rng() * (i + 1)))); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
type Pair = { word: Word; language: TargetLanguage };
function makeBoard(pairs: Pair[], rng: () => number): Board {
  const chosen: Pair[] = [];
  for (const pair of pairs) if (chosen.length < MATCH_PAIRS && chosen.every((other) => !conflicts(pair.word, pair.language, other.word, other.language))) chosen.push(pair);
  const ids = chosen.map(({ word }) => word.id);
  return { left: shuffle(ids, rng), right: shuffle(ids, rng), matched: [], failed: [], hinted: [] };
}
export function createSession(words: Word[], progress: Record<string, Progress>, settings: Settings, now = Date.now(), rng: () => number = Math.random): Session {
  const eligible = eligibleWords(words, settings);
  const pairs = eligible.flatMap((word) => targetLanguages(word, settings).map((language) => ({ word, language })));
  const prior = ({ word, language }: Pair, mode: 'match' | 'recall' = 'match') => {
    const p = progress[progressKey(word.id, language, mode)];
    return p?.revision === word.revision ? p : undefined;
  };
  const trouble = (p: Progress) => p.lastFailedDay && (!p.lastPromotedDay || p.lastFailedDay >= p.lastPromotedDay) ? 1 : 0;
  const due = pairs.filter((pair) => { const p = prior(pair); return p && p.dueAt <= now; }).sort((a, b) => {
    const pa = prior(a)!, pb = prior(b)!;
    return trouble(pb) - trouble(pa) || pa.dueAt - pb.dueAt;
  });
  const fresh = shuffle(pairs.filter((pair) => !prior(pair)), rng);
  const support = shuffle(pairs.filter((pair) => { const p = prior(pair); return p && p.dueAt > now; }), rng);
  const selected: Pair[] = [];
  const assigned = new Set<string>();
  const counts: Record<TargetLanguage, number> = { en: 0, fr: 0, de: 0, es: 0 };
  const add = (pair: Pair) => { selected.push(pair); assigned.add(pair.word.id); counts[pair.language]++; };
  const dueLimit = settings.language === 'mvt' && fresh.length ? sessionPairLimit - MATCH_PAIRS : sessionPairLimit;
  for (const pair of due) if (!assigned.has(pair.word.id) && selected.length < dueLimit) add(pair);
  const newLimit = Math.min(MATCH_PAIRS, sessionPairLimit - selected.length);
  const newPairs: Pair[] = [];
  while (newPairs.length < newLimit) {
    const available = fresh.filter((pair) => !assigned.has(pair.word.id));
    if (!available.length) break;
    available.sort((a, b) => {
      const aConflicts = newPairs.some((other) => conflicts(a.word, a.language, other.word, other.language));
      const bConflicts = newPairs.some((other) => conflicts(b.word, b.language, other.word, other.language));
      return Number(aConflicts) - Number(bConflicts) || counts[a.language] - counts[b.language];
    });
    const pair = available[0]; add(pair); newPairs.push(pair);
  }
  for (const pair of due) if (!assigned.has(pair.word.id) && selected.length < sessionPairLimit) add(pair);
  for (const pair of support) if (!assigned.has(pair.word.id)) add(pair);
  const boards: Board[] = [];
  for (let i = 0; i < 3 && selected.length; i++) {
    const offset = i * MATCH_PAIRS;
    const board = makeBoard([...selected.slice(offset), ...selected.slice(0, offset)], rng);
    if (board.left.length) boards.push(board);
  }
  const used = new Set(boards.flatMap((b) => b.left));
  const newWordIds = newPairs.filter(({ word }) => used.has(word.id)).map(({ word }) => word.id);
  const byId = new Map(selected.map((pair) => [pair.word.id, pair]));
  const dueRecall = pairs.filter((pair) => {
    const p = prior(pair, 'recall');
    const assignedPair = used.has(pair.word.id) ? byId.get(pair.word.id) : undefined;
    return prior(pair) && p && p.dueAt <= now && (!assignedPair || assignedPair.language === pair.language);
  }).sort((a, b) => {
    const pa = prior(a, 'recall')!, pb = prior(b, 'recall')!;
    return trouble(pb) - trouble(pa) || pa.dueAt - pb.dueAt;
  });
  const recallWordIds: string[] = [];
  for (const pair of [...dueRecall, ...boards.flatMap((board) => board.left.map((id) => byId.get(id)!))]) {
    if (recallWordIds.length >= 3) break;
    if (recallWordIds.includes(pair.word.id)) continue;
    recallWordIds.push(pair.word.id); used.add(pair.word.id); byId.set(pair.word.id, pair);
  }
  const frozen = eligible.filter((w) => used.has(w.id)).map((w) => ({ ...w, forms: { ...w.forms }, ...(w.alternatives ? { alternatives: Object.fromEntries(Object.entries(w.alternatives).map(([k, v]) => [k, [...v]])) } : {}) }));
  const wordLanguages = Object.fromEntries(frozen.map((word) => [word.id, byId.get(word.id)!.language]));
  return { id: uniqueId(), version: 0, settings: { ...settings }, phase: boards.length ? (newWordIds.length ? 'intro' : 'match') : 'results', words: frozen, wordLanguages, newWordIds, boards, boardIndex: 0, recallWordIds, recallIndex: 0, completedPairs: 0, startedAt: now, correct: 0, mistakes: 0, hints: 0, selection: null, feedback: '' };
}
function queueRetry(session: Session, wordId: string): void {
  const current = session.boards[session.boardIndex];
  let intervening = current.left.filter((id) => id !== wordId && !current.matched.includes(id)).length;
  const word = session.words.find((w) => w.id === wordId)!;
  for (let i = session.boardIndex + 1; i < session.boards.length; i++) {
    const board = session.boards[i];
    if (intervening >= 3) {
      if (board.left.includes(wordId)) return;
      const conflictsWithRetry = new Set(board.left.filter((id) => conflicts(word, session.wordLanguages[wordId], session.words.find((w) => w.id === id)!, session.wordLanguages[id])));
      board.left = board.left.filter((id) => !conflictsWithRetry.has(id));
      board.right = board.right.filter((id) => !conflictsWithRetry.has(id));
      if (board.left.length >= MATCH_PAIRS) { const removed = board.left[board.left.length - 1]; board.left = board.left.filter((id) => id !== removed); board.right = board.right.filter((id) => id !== removed); }
      board.left = [wordId, ...board.left]; board.right = [...board.right, wordId];
      // Keep six choices when another already-introduced word can replace a collision.
      for (const candidate of session.words) {
        if (board.left.length >= MATCH_PAIRS) break;
        if (board.left.includes(candidate.id) || board.left.some((id) => conflicts(candidate, session.wordLanguages[candidate.id], session.words.find((w) => w.id === id)!, session.wordLanguages[id]))) continue;
        board.left.push(candidate.id);
        board.right.unshift(candidate.id);
      }
      return;
    }
    intervening += board.left.filter((id) => id !== wordId).length;
  }
}
export function transition(input: Session, action: Action, now = Date.now()): { session: Session; exposures: Exposure[] } {
  const session: Session = { ...input, boards: input.boards.map((b) => ({ left: [...b.left], right: [...b.right], matched: [...b.matched], failed: [...b.failed], hinted: [...b.hinted] })), selection: input.selection ? { ...input.selection } : null };
  const exposures: Exposure[] = [];
  const emit = (wordId: string, outcome: Exposure['outcome'], choicesRemaining: number, mode: Exposure['mode'], chosenWordId?: string) => {
    const word = session.words.find((w) => w.id === wordId)!;
    exposures.push({ id: `${session.id}:${session.version + 1}:${exposures.length}`, sessionId: session.id, wordId, ...(chosenWordId ? { chosenWordId } : {}), language: session.wordLanguages[wordId], mode, outcome, choicesRemaining, at: now, revision: word.revision });
  };
  let persistent = false;
  if (action.type === 'begin' && session.phase === 'intro') { session.phase = 'match'; session.feedback = ''; persistent = true; }
  else if (action.type === 'select' && session.phase === 'match') {
    const board = session.boards[session.boardIndex];
    if (!board || !board[action.side].includes(action.wordId) || board.matched.includes(action.wordId) || board.matched.length === board.left.length) return { session: input, exposures };
    const selected = session.selection;
    if (!selected || selected.side === action.side) session.selection = selected?.wordId === action.wordId ? null : { side: action.side, wordId: action.wordId };
    else {
      const anchor = selected.wordId, chosen = action.wordId, remaining = board.left.length - board.matched.length;
      if (anchor === chosen) {
        const assisted = session.boards.slice(0, session.boardIndex + 1).some((earlier) => earlier.failed.includes(anchor) || earlier.hinted.includes(anchor));
        emit(anchor, 'correct', assisted ? 0 : remaining, 'match', chosen);
        board.matched.push(anchor); session.completedPairs++; session.correct++; session.selection = null;
        session.feedback = assisted ? 'Goed geprobeerd!' : 'Goed gedaan!';
        if (remaining < 3 && !assisted) queueRetry(session, anchor);
      } else {
        emit(anchor, 'incorrect', remaining, 'match', chosen); if (!board.failed.includes(anchor)) board.failed.push(anchor);
        session.mistakes++; session.feedback = 'Bijna! Probeer nog eens.'; queueRetry(session, anchor);
      }
      persistent = true;
    }
  } else if (action.type === 'hint' && session.phase === 'match' && session.selection) {
    const board = session.boards[session.boardIndex], id = session.selection.wordId;
    if (board && !board.matched.includes(id)) {
      emit(id, 'hint', board.left.length - board.matched.length, 'match');
      if (!board.hinted.includes(id)) board.hinted.push(id);
      board.matched.push(id); session.completedPairs++; session.hints++; session.selection = null;
      session.feedback = 'Samen gevonden!'; queueRetry(session, id); persistent = true;
    }
  } else if (action.type === 'next-board' && session.phase === 'match') {
    const board = session.boards[session.boardIndex];
    if (board && board.matched.length === board.left.length) {
      session.selection = null; session.feedback = ''; session.boardIndex++;
      if (session.boardIndex >= session.boards.length) session.phase = session.recallWordIds.length ? 'recall' : 'results';
      persistent = true;
    }
  } else if (action.type === 'recall' && session.phase === 'recall') {
    const id = session.recallWordIds[session.recallIndex];
    if (id) { emit(id, action.known ? 'correct' : 'incorrect', 0, 'recall'); session.recallIndex++; if (session.recallIndex >= session.recallWordIds.length) session.phase = 'results'; session.feedback = ''; persistent = true; }
  } else if (action.type === 'skip-recall' && session.phase === 'recall') { session.phase = 'results'; session.feedback = ''; persistent = true; }
  if (persistent) session.version++;
  return { session, exposures };
}
